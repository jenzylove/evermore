// Satchel (the in-browser play key) and WizardConnect helpers for the connected wallet.
//
// WizardConnect (hdwalletv1) facts this module follows (docs/spikes S2):
// - the only request is sign_transaction_request; the dapp finds the wallet's coins itself
//   from the shared xpubs (paths 'receive' = 0, 'change' = 1, 'defi' = 7), deriving child i
//   of each path xpub directly;
// - the wallet signs ONLY the inputs named in inputPaths, with sighash ALL|UTXOS|FORKID (0x61),
//   so sourceOutputs must be exact and in the same state as the transaction;
// - wallets never broadcast reliably: always send broadcast: false and broadcast ourselves;
// - Selene refuses any source output whose NFT commitment is over 40 bytes;
// - the network comes from the xpub version; refuse a mismatch.
import {
  binToHex, hexToBin, hash160, secp256k1, generatePrivateKey, encodePrivateKeyWif, decodePrivateKeyWif,
  decodeHdPublicKey, deriveHdPublicNodeChild, decodeTransaction,
} from '@bitauth/libauth';
import { p2pkhLock, lockToAddress } from './game.ts';
import type { NetworkName } from './network.ts';
import { assertWalletSignable, verify } from './tx.ts';
import type { Built, Input, Utxo, SourceOutput } from './tx.ts';

const prefixOf = (n: NetworkName) => (n === 'mainnet' ? 'bitcoincash' : 'bchtest') as 'bitcoincash' | 'bchtest';

// ------------------------------------------------------------------ Satchel
export class Satchel {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly pkh: Uint8Array;
  readonly lock: Uint8Array;
  constructor(privateKey: Uint8Array) {
    const pub = secp256k1.derivePublicKeyCompressed(privateKey);
    if (typeof pub === 'string') throw new Error(pub);
    this.privateKey = privateKey;
    this.publicKey = pub;
    this.pkh = hash160(pub);
    this.lock = p2pkhLock(this.pkh);
  }
  static generate() { return new Satchel(generatePrivateKey()); }
  static fromWif(wif: string) {
    const d = decodePrivateKeyWif(wif);
    if (typeof d === 'string') throw new Error(d);
    return new Satchel(d.privateKey);
  }
  toWif(net: NetworkName) { return encodePrivateKeyWif(this.privateKey, net === 'mainnet' ? 'mainnet' : 'testnet'); }
  address(net: NetworkName) { return lockToAddress(this.lock, prefixOf(net)); }
  tokenAddress(net: NetworkName) { return lockToAddress(this.lock, prefixOf(net), true); }
  /** Wrap this Satchel's UTXOs as signable inputs. */
  inputs(utxos: Utxo[]): Input[] { return utxos.map((utxo) => ({ utxo, unlock: { type: 'key', privateKey: this.privateKey } })); }
}

// ------------------------------------------------------------------ connected wallet (xpubs)
export const WALLET_PATHS = { receive: 0, change: 1, defi: 7 } as const;
export type WalletKey = { path: string; index: number; publicKey: Uint8Array; lock: Uint8Array; address: string };

/** Network of an xpub ('mainnet' or 'testnet'; chipnet wallets use testnet versions). */
export function xpubNetwork(xpub: string): 'mainnet' | 'testnet' {
  const d = decodeHdPublicKey(xpub);
  if (typeof d === 'string') throw new Error(d);
  return d.network;
}

/** Throw unless the wallet's xpubs match the game network. */
export function assertWalletNetwork(xpubs: string[], net: NetworkName) {
  const want = net === 'mainnet' ? 'mainnet' : 'testnet';
  for (const x of xpubs) {
    const got = xpubNetwork(x);
    if (got !== want) throw new Error(`wallet is on ${got}, the game runs on ${net}; switch the wallet's network and connect again`);
  }
}

/** First `count` P2PKH addresses of one WizardConnect path xpub (child i of the path node). */
export function walletKeys(path: string, xpub: string, net: NetworkName, count = 20, start = 0): WalletKey[] {
  const d = decodeHdPublicKey(xpub);
  if (typeof d === 'string') throw new Error(d);
  const out: WalletKey[] = [];
  for (let i = start; i < start + count; i++) {
    const child = deriveHdPublicNodeChild(d.node, i);
    if (typeof child === 'string') throw new Error(child);
    const lock = p2pkhLock(hash160(child.publicKey));
    out.push({ path, index: i, publicKey: child.publicKey, lock, address: lockToAddress(lock, prefixOf(net)) });
  }
  return out;
}

/** A wallet coin found at one of its derived addresses, ready to be a WizardConnect-signed input. */
export const walletInput = (utxo: Utxo, key: Pick<WalletKey, 'path' | 'index'>): Input =>
  ({ utxo, unlock: { type: 'wallet', walletPath: { path: key.path, index: key.index } } });

// ------------------------------------------------------------------ WizardConnect request / reply
/** hdwalletv1 relay JSON: bytes as hex, bigint as "<bigint: Nn>" (same as @wizardconnect/core sourceOutputToRelay). */
export function sourceOutputToRelay(so: SourceOutput) {
  const r: Record<string, unknown> = {
    outpointTransactionHash: binToHex(so.outpointTransactionHash),
    outpointIndex: so.outpointIndex,
    unlockingBytecode: binToHex(so.unlockingBytecode),
    sequenceNumber: so.sequenceNumber,
    valueSatoshis: `<bigint: ${so.valueSatoshis}n>`,
    lockingBytecode: binToHex(so.lockingBytecode),
  };
  if (so.token) {
    r.token = {
      category: binToHex(so.token.category),
      amount: `<bigint: ${so.token.amount}n>`,
      ...(so.token.nft ? { nft: { capability: so.token.nft.capability, commitment: binToHex(so.token.nft.commitment) } } : {}),
    };
  }
  return r;
}

export type SignRequest = {
  transaction: { transaction: string; sourceOutputs: Record<string, unknown>[]; broadcast: false; userPrompt: string };
  inputPaths: [number, string, number][];
};

/**
 * The argument for DappConnectionManager.signTransaction(). Asserts every source output is
 * wallet signable (commitments <= 40 bytes) and that there is something for the wallet to sign.
 */
export function toSignRequest(b: Built, userPrompt: string): SignRequest {
  if (!b.walletInputs.length) throw new Error('nothing for the wallet to sign');
  assertWalletSignable(b);
  return {
    transaction: { transaction: b.hex, sourceOutputs: b.sourceOutputs.map(sourceOutputToRelay), broadcast: false, userPrompt },
    inputPaths: b.walletInputs.map((i) => {
      const u = b.inputs[i].unlock;
      if (u.type !== 'wallet') throw new Error('internal: not a wallet input');
      return [i, u.walletPath.path, u.walletPath.index];
    }),
  };
}

/**
 * Check the wallet's signed hex: same outputs, same outpoints, only the wallet inputs changed,
 * and the whole transaction passes the 2026 VM. Returns the hex to broadcast.
 */
export function acceptWalletSignature(b: Built, signed: string | Uint8Array): { hex: string } {
  const bin = typeof signed === 'string' ? hexToBin(signed) : signed;
  const t = decodeTransaction(bin);
  if (typeof t === 'string') throw new Error(`wallet returned an undecodable transaction: ${t}`);
  if (t.inputs.length !== b.transaction.inputs.length || t.outputs.length !== b.transaction.outputs.length) throw new Error('wallet changed the transaction shape');
  t.outputs.forEach((o, i) => {
    const w = b.transaction.outputs[i];
    if (o.valueSatoshis !== w.valueSatoshis || binToHex(o.lockingBytecode) !== binToHex(w.lockingBytecode)) throw new Error(`wallet changed output ${i}`);
  });
  t.inputs.forEach((inp, i) => {
    const w = b.transaction.inputs[i];
    if (binToHex(inp.outpointTransactionHash) !== binToHex(w.outpointTransactionHash) || inp.outpointIndex !== w.outpointIndex) throw new Error(`wallet changed input ${i}`);
    if (!b.walletInputs.includes(i) && binToHex(inp.unlockingBytecode) !== binToHex(w.unlockingBytecode)) throw new Error(`wallet touched input ${i}, which is not its own`);
  });
  const sourceOutputs = b.sourceOutputs.map((s, i) => ({ ...s, unlockingBytecode: t.inputs[i].unlockingBytecode }));
  const ok = verify({ transaction: t as any, sourceOutputs });
  if (ok !== true) throw new Error(`signed transaction fails the VM: ${ok}`);
  return { hex: binToHex(bin) };
}

// ------------------------------------------------------------------ wallet flows
import { finalize, payDraft, sendDraft } from './tx.ts';

/**
 * Wallet funds the Satchel: wallet coins in, `amount` to the Satchel, change back to the
 * wallet. Returns the unsigned build and the WizardConnect request to send.
 */
export function fundSatchelRequest(walletCoins: Input[], satchel: Satchel, amount: bigint, walletChangeLock: Uint8Array, feeRate = 1,
  prompt = `Evermore: move ${amount} sats into your play Satchel`) {
  const built = finalize(payDraft(satchel.lock, amount, 'fund-satchel'), { funding: walletCoins, changeLock: walletChangeLock, feeRate });
  return { built, request: toSignRequest(built, prompt) };
}

/** Satchel pays BCH back to the wallet (no wallet prompt). Sends everything when amount is omitted. */
export function satchelWithdraw(satchel: Satchel, coins: Utxo[], toLock: Uint8Array, amount?: bigint, feeRate = 1): Built {
  if (amount === undefined) {
    // sweep: one output, fee off the top
    const inputs = satchel.inputs(coins.filter((c) => !c.token));
    const total = inputs.reduce((a, i) => a + i.utxo.satoshis, 0n);
    const probe = finalize({ kind: 'withdraw', inputs, outputs: [{ lockingBytecode: toLock, valueSatoshis: 0n }] }, { feeRate });
    return finalize({ kind: 'withdraw', inputs, outputs: [{ lockingBytecode: toLock, valueSatoshis: total - BigInt(probe.size * feeRate) - 2n }] }, { feeRate });
  }
  return finalize(payDraft(toLock, amount, 'withdraw'), { funding: satchel.inputs(coins), changeLock: satchel.lock, feeRate });
}

/** Send home: Satchel moves heroes / gear to the connected wallet. Satchel signs and pays the fee. */
export function sendHome(satchel: Satchel, tokens: Utxo[], coins: Utxo[], walletLock: Uint8Array, feeRate = 1): Built {
  const b = finalize(sendDraft(satchel.inputs(tokens), walletLock, 'send-home'), { funding: satchel.inputs(coins), changeLock: satchel.lock, feeRate });
  assertWalletSignable(b); // the wallet will later spend these; keep them signable
  return b;
}

/** Bring back: the wallet moves heroes / gear into the Satchel to play. Wallet signs (WizardConnect). */
export function bringBackRequest(walletTokens: Input[], walletCoins: Input[], satchel: Satchel, walletChangeLock: Uint8Array, feeRate = 1,
  prompt = 'Evermore: bring your hero into your play Satchel') {
  const built = finalize(sendDraft(walletTokens, satchel.lock, 'bring-back'), { funding: walletCoins, changeLock: walletChangeLock, feeRate });
  return { built, request: toSignRequest(built, prompt) };
}
