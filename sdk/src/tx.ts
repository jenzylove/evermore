// Transaction builders for every Evermore verb, plus fee and coin selection.
//
// Every builder returns a Draft (fixed inputs and pinned outputs). `finalize` appends
// funding inputs (largest first) and one change output, signs every input it can (Satchel
// keys with ALL|FORKID, covenants with their function), leaves wallet inputs empty for
// WizardConnect, and returns the encoded transaction. Covenant rules are mirrored here so a
// draft that the covenant would reject throws before anything is signed.
import {
  binToHex, hexToBin, hash256, encodeTransaction, decodeTransaction, createVirtualMachineBch2026,
} from '@bitauth/libauth';
import type { Contract } from 'cashscript';
import { SignatureTemplate } from 'cashscript';
import {
  encodeLane, decodeLane, encodeHero, decodeHero, encodeGhost, decodeGhost, encodeTicket, decodeTicket,
  encodeCounter, decodeCounter, encodeGear, ticketFor, WALLET_MAX_COMMITMENT,
} from './codec.ts';
import { starterHero, ghostOf, forgeOutcome, packMoves, bump } from './rules.ts';
import type { ForgeResult } from './rules.ts';
import { TOKEN_SATS, DUST, p2pkhLock, isP2pkh, pkhOfLock } from './game.ts';
import type { Game, Currency } from './game.ts';

// ------------------------------------------------------------------ types
export type Capability = 'none' | 'mutable' | 'minting';
/** libauth shape: category in display (txid) order bytes. */
export type Token = { category: Uint8Array; amount: bigint; nft?: { capability: Capability; commitment: Uint8Array } };
export type Utxo = { txid: string; vout: number; satoshis: bigint; lockingBytecode: Uint8Array; token?: Token; height?: number };
export type Output = { lockingBytecode: Uint8Array; valueSatoshis: bigint; token?: Token };

/** WizardConnect path of a wallet coin: [pathName, addressIndex]. */
export type WalletPath = { path: string; index: number };
export type Unlock =
  | { type: 'key'; privateKey: Uint8Array }
  | { type: 'contract'; contract: Contract; fn: string; args: unknown[] }
  | { type: 'wallet'; walletPath: WalletPath };
export type Input = { utxo: Utxo; unlock: Unlock };
export type Draft = { kind: string; inputs: Input[]; outputs: Output[] };

export type Built = {
  kind: string;
  transaction: ReturnType<typeof decodeTx>;
  sourceOutputs: SourceOutput[];
  hex: string;
  txid: string;
  size: number;
  fee: bigint;
  inputs: Input[];
  outputs: Output[];
  /** indices of inputs a connected wallet still has to sign */
  walletInputs: number[];
};
export type SourceOutput = {
  outpointTransactionHash: Uint8Array; outpointIndex: number; sequenceNumber: number; unlockingBytecode: Uint8Array;
  lockingBytecode: Uint8Array; valueSatoshis: bigint; token?: Token;
};

export class InsufficientFunds extends Error {
  needed: bigint;
  constructor(needed: bigint) { super(`not enough BCH: short by ${needed} sats`); this.needed = needed; }
}

const decodeTx = (b: Uint8Array) => { const t = decodeTransaction(b); if (typeof t === 'string') throw new Error(t); return t; };
const nft = (cat: Uint8Array, capability: Capability, commitment: Uint8Array): Token => ({ category: cat, amount: 0n, nft: { capability, commitment } });
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const commitmentOf = (u: Utxo) => { if (!u.token?.nft) throw new Error(`utxo ${u.txid}:${u.vout} holds no NFT`); return u.token.nft.commitment; };
const isGame = (game: Game, u: Utxo) => u.token !== undefined && eq(u.token.category, game.categoryBin);
/** P2PKH unlocking with a Schnorr signature: push 65 + push 33. Used as the wallet placeholder size. */
const P2PKH_UNLOCK_SIZE = 100;

// ------------------------------------------------------------------ signing + fee
function assemble(inputs: Input[], outputs: Output[], placeholders: boolean) {
  const sourceOutputs: SourceOutput[] = [];
  const txInputs = inputs.map((i) => ({
    outpointTransactionHash: hexToBin(i.utxo.txid), outpointIndex: i.utxo.vout, sequenceNumber: 0, unlockingBytecode: new Uint8Array() as Uint8Array,
  }));
  const transaction = { version: 2, locktime: 0, inputs: txInputs, outputs: outputs.map((o) => ({ ...o })) };
  inputs.forEach((i) => sourceOutputs.push({
    ...txInputs[sourceOutputs.length], lockingBytecode: i.utxo.lockingBytecode, valueSatoshis: i.utxo.satoshis, ...(i.utxo.token ? { token: i.utxo.token } : {}),
  }));
  inputs.forEach((inp, idx) => {
    const ctx = { transaction, sourceOutputs, inputIndex: idx } as any;
    const u = inp.unlock;
    if (u.type === 'key') txInputs[idx].unlockingBytecode = new SignatureTemplate(u.privateKey).unlockP2PKH().generateUnlockingBytecode(ctx);
    else if (u.type === 'contract') txInputs[idx].unlockingBytecode = (u.contract.unlock as any)[u.fn](...u.args).generateUnlockingBytecode(ctx);
    else if (placeholders) txInputs[idx].unlockingBytecode = new Uint8Array(P2PKH_UNLOCK_SIZE);
  });
  // keep source outputs in the same state as the transaction (Selene compares them byte for byte)
  sourceOutputs.forEach((s, i) => { s.unlockingBytecode = txInputs[i].unlockingBytecode; });
  return { transaction, sourceOutputs };
}

export type FinalizeOptions = {
  /** plain BCH coins to pay with, tried largest first */
  funding?: Input[];
  /** where change goes; omit to give any excess to the miner */
  changeLock?: Uint8Array;
  feeRate?: number;
};

/** Add funding + change, sign, and encode. Throws InsufficientFunds if the coins cannot cover it. */
export function finalize(draft: Draft, opts: FinalizeOptions = {}): Built {
  const feeRate = opts.feeRate ?? 1;
  const pool = [...(opts.funding ?? [])].filter((f) => !f.utxo.token).sort((a, b) => (b.utxo.satoshis > a.utxo.satoshis ? 1 : -1));
  const outSum = draft.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
  let lastShort = 0n;
  for (let k = 0; k <= pool.length; k++) {
    const inputs = [...draft.inputs, ...pool.slice(0, k)];
    const inSum = inputs.reduce((a, i) => a + i.utxo.satoshis, 0n);
    if (inSum < outSum) { lastShort = outSum - inSum; continue; }
    const tryOuts = (withChange: bigint | null) => {
      const outs = withChange === null ? draft.outputs : [...draft.outputs, { lockingBytecode: opts.changeLock!, valueSatoshis: withChange }];
      const a = assemble(inputs, outs, true);
      return { outs, size: encodeTransaction(a.transaction).length };
    };
    const est = opts.changeLock ? tryOuts(0n) : tryOuts(null);
    const fee = BigInt(Math.ceil(est.size * feeRate));
    const change = inSum - outSum - fee;
    if (change < 0n) { lastShort = -change; continue; }
    let outs = draft.outputs;
    if (opts.changeLock && change >= DUST) outs = [...draft.outputs, { lockingBytecode: opts.changeLock, valueSatoshis: change }];
    const { transaction, sourceOutputs } = assemble(inputs, outs, false);
    const enc = encodeTransaction(transaction);
    const walletInputs = inputs.map((i, n) => (i.unlock.type === 'wallet' ? n : -1)).filter((n) => n >= 0);
    const built: Built = {
      kind: draft.kind, transaction, sourceOutputs, hex: binToHex(enc), txid: binToHex(hash256(enc).reverse()),
      size: walletInputs.length ? est.size : enc.length, fee: inSum - outs.reduce((a, o) => a + o.valueSatoshis, 0n), inputs, outputs: outs, walletInputs,
    };
    if (walletInputs.length) assertWalletSignable(built);
    return built;
  }
  throw new InsufficientFunds(lastShort || 1n);
}

/**
 * Selene refuses to sign when any source output holds an NFT commitment over 40 bytes.
 * Every Evermore layout fits, but anything foreign (or a future layout) must never reach a
 * wallet signing request.
 */
export function assertWalletSignable(b: { sourceOutputs: SourceOutput[]; outputs?: Output[] }) {
  b.sourceOutputs.forEach((s, i) => {
    const c = s.token?.nft?.commitment;
    if (c && c.length > WALLET_MAX_COMMITMENT) throw new Error(`input ${i} holds a ${c.length} byte NFT commitment; wallets (Selene) only sign up to ${WALLET_MAX_COMMITMENT}`);
  });
}

const vm = createVirtualMachineBch2026(true);
/** Run the transaction through the BCH 2026 VM (standard mode). true or the error text. */
export function verify(b: Pick<Built, 'transaction' | 'sourceOutputs'>): true | string {
  const r = vm.verify({ transaction: b.transaction as any, sourceOutputs: b.sourceOutputs as any });
  return r === true ? true : String(r);
}

// ------------------------------------------------------------------ RAISE
export function raiseDraft(game: Game, lane: Utxo, cls: number, ownerLock: Uint8Array) {
  if (!isGame(game, lane) || lane.token!.nft?.capability !== 'minting' || !eq(lane.lockingBytecode, game.laneLock)) throw new Error('not a lane UTXO');
  if (!isP2pkh(ownerLock)) throw new Error('a hero must be raised to a P2PKH address (its pkh owns the ghost)');
  if (![0, 1, 2].includes(cls)) throw new Error('class must be 0 Knight, 1 Rogue or 2 Mage');
  const l = decodeLane(commitmentOf(lane));
  const hero = starterHero(l.ctr * 16 + l.lane, cls);
  const ghost = ghostOf(hero, pkhOfLock(ownerLock));
  const cat = game.categoryBin;
  const draft: Draft = {
    kind: 'raise',
    inputs: [{ utxo: lane, unlock: { type: 'contract', contract: game.lane, fn: 'raise', args: [BigInt(cls)] } }],
    outputs: [
      { lockingBytecode: game.laneLock, valueSatoshis: lane.satoshis, token: nft(cat, 'minting', encodeLane({ lane: l.lane, ctr: l.ctr + 1 })) },
      { lockingBytecode: ownerLock, valueSatoshis: TOKEN_SATS, token: nft(cat, 'none', encodeHero(hero)) },
      { lockingBytecode: game.arenaLock, valueSatoshis: TOKEN_SATS, token: nft(cat, 'none', encodeGhost(ghost)) },
      { lockingBytecode: game.treasuryLock, valueSatoshis: game.params.raisePrice },
    ],
  };
  return { draft, hero, ghost };
}

// ------------------------------------------------------------------ CHALLENGE
export function challengeDraft(game: Game, lane: Utxo, ghostUtxo: Utxo, heroId: number, ticketLock: Uint8Array) {
  if (!isGame(game, lane) || lane.token!.nft?.capability !== 'minting') throw new Error('not a lane UTXO');
  if (!isGame(game, ghostUtxo) || !eq(ghostUtxo.lockingBytecode, game.arenaLock)) throw new Error('not a ghost at the Arena');
  const ghost = decodeGhost(commitmentOf(ghostUtxo));
  if (ghost.id === heroId) throw new Error('a hero cannot challenge its own ghost');
  const ticket = ticketFor(heroId, ghost);
  const cat = game.categoryBin;
  const draft: Draft = {
    kind: 'challenge',
    inputs: [
      { utxo: lane, unlock: { type: 'contract', contract: game.lane, fn: 'challenge', args: [BigInt(heroId)] } },
      { utxo: ghostUtxo, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } },
    ],
    outputs: [
      { lockingBytecode: lane.lockingBytecode, valueSatoshis: lane.satoshis, token: lane.token },
      { lockingBytecode: game.arenaLock, valueSatoshis: ghostUtxo.satoshis, token: nft(cat, 'none', encodeGhost({ ...ghost, defences: bump(ghost.defences) })) },
      { lockingBytecode: p2pkhLock(ghost.ownerPkh), valueSatoshis: game.params.challengeFee },
      { lockingBytecode: ticketLock, valueSatoshis: TOKEN_SATS, token: nft(cat, 'none', encodeTicket(ticket)) },
    ],
  };
  return { draft, ghost, ticket };
}

// ------------------------------------------------------------------ FORGE
export type ForgeArgs = {
  lane: Utxo;
  hero: Input;          // hero UTXO + its owner's unlock (Satchel key or wallet)
  ghost: Utxo;          // the opponent ghost, live (its beaten counter sets XP decay)
  ticket: Input;        // the ticket from the challenge, burned here
  moves: number[];
  ownGhost?: Utxo;      // required when the forge levels the hero up
  counter?: Utxo;       // pass to claim a gear drop when eligible
  drop?: boolean;       // default: drop when eligible and a counter with room is given
};

export function forgeDraft(game: Game, a: ForgeArgs) {
  const cat = game.categoryBin;
  const hero = decodeHero(commitmentOf(a.hero.utxo));
  const ghost = decodeGhost(commitmentOf(a.ghost));
  const ticket = decodeTicket(commitmentOf(a.ticket.utxo));
  if (!isGame(game, a.hero.utxo) || !isGame(game, a.ghost) || !isGame(game, a.ticket.utxo)) throw new Error('hero, ghost and ticket must be game tokens');
  if (ticket.heroId !== hero.id) throw new Error(`ticket is for hero ${ticket.heroId}, not ${hero.id}`);
  if (ticket.ghostId !== ghost.id) throw new Error(`ticket is for ghost ${ticket.ghostId}, not ${ghost.id}`);
  const r: ForgeResult = forgeOutcome(hero, ticket, ghost.beaten, a.moves);
  if (!r.valid) throw new Error(`these moves do not win (${r.duel.won ? `won in ${r.duel.rounds} rounds but ${a.moves.length} moves given` : 'lost'}); the covenant would reject the forge`);
  const heroLock = a.hero.utxo.lockingBytecode;

  const inputs: Input[] = [
    { utxo: a.lane, unlock: { type: 'contract', contract: game.lane, fn: 'forge', args: [] } }, // args set below
    a.hero,
    { utxo: a.ghost, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } },
    a.ticket,
  ];
  const outputs: Output[] = [
    { lockingBytecode: a.lane.lockingBytecode, valueSatoshis: a.lane.satoshis, token: a.lane.token },
    { lockingBytecode: heroLock, valueSatoshis: a.hero.utxo.satoshis, token: nft(cat, 'none', encodeHero(r.hero)) },
    { lockingBytecode: game.arenaLock, valueSatoshis: a.ghost.satoshis, token: nft(cat, 'none', encodeGhost({ ...ghost, beaten: bump(ghost.beaten) })) },
    { lockingBytecode: game.treasuryLock, valueSatoshis: game.params.forgeFee },
  ];
  if (r.levelled) {
    if (!a.ownGhost) throw new Error(`this win levels hero ${hero.id} up: pass its own ghost (G${hero.id}) so the Arena copy levels too`);
    if (!isP2pkh(heroLock)) throw new Error('a hero must sit in a P2PKH address to level up');
    const own = decodeGhost(commitmentOf(a.ownGhost));
    if (own.id !== hero.id) throw new Error('ownGhost is not this hero\'s ghost');
    inputs.push({ utxo: a.ownGhost, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } });
    outputs.push({ lockingBytecode: game.arenaLock, valueSatoshis: a.ownGhost.satoshis,
      token: nft(cat, 'none', encodeGhost({ ...ghostOf(r.hero, pkhOfLock(heroLock)), beaten: own.beaten, defences: own.defences })) });
  }
  let drop = false;
  if (r.dropEligible && a.counter && a.drop !== false) {
    const minted = decodeCounter(commitmentOf(a.counter));
    if (minted < Number(game.params.gearCap)) {
      drop = true;
      inputs.push({ utxo: a.counter, unlock: { type: 'contract', contract: game.counter, fn: 'tick', args: [] } });
      outputs.push({ lockingBytecode: game.counterLock, valueSatoshis: a.counter.satoshis, token: nft(cat, 'none', encodeCounter(minted + 1)) });
      outputs.push({ lockingBytecode: heroLock, valueSatoshis: TOKEN_SATS, token: nft(cat, 'none', encodeGear({ id: minted, kind: r.gearKind, tier: r.gearTier })) });
    }
  }
  if (a.drop === true && !drop) throw new Error('gear drop requested but not possible (not eligible, no counter, or cap reached)');
  inputs[0] = { utxo: a.lane, unlock: { type: 'contract', contract: game.lane, fn: 'forge', args: [packMoves(a.moves), BigInt(a.moves.length), drop ? 1n : 0n] } };
  return { draft: { kind: 'forge', inputs, outputs } as Draft, result: r, drop };
}

// ------------------------------------------------------------------ SYNC
export type SyncArgs = {
  lane: Utxo;
  hero: Input;          // the hero in a P2PKH + its holder's unlock (the signature is the proof)
  ownGhost: Utxo;       // the hero's own ghost at the Arena
  toLock?: Uint8Array;  // P2PKH the hero goes to (default: back to itself); the ghost owner becomes its pkh
};
/**
 * Fees follow the owner: rewrite the hero's ghost owner to the pkh holding the hero. With
 * `toLock` this is also Send home (or any move) in the same transaction.
 */
export function syncDraft(game: Game, a: SyncArgs) {
  if (!isGame(game, a.lane) || a.lane.token!.nft?.capability !== 'minting') throw new Error('not a lane UTXO');
  if (!isGame(game, a.hero.utxo) || commitmentOf(a.hero.utxo)[0] !== 0x48) throw new Error('not a hero');
  if (!isP2pkh(a.hero.utxo.lockingBytecode)) throw new Error('only a hero held in a P2PKH can sync its ghost');
  if (!isGame(game, a.ownGhost) || !eq(a.ownGhost.lockingBytecode, game.arenaLock)) throw new Error('not a ghost at the Arena');
  const hero = decodeHero(commitmentOf(a.hero.utxo));
  const ghost = decodeGhost(commitmentOf(a.ownGhost));
  if (ghost.id !== hero.id) throw new Error('ownGhost is not this hero\'s ghost');
  const toLock = a.toLock ?? a.hero.utxo.lockingBytecode;
  if (!isP2pkh(toLock)) throw new Error('the hero must go to a P2PKH address');
  const cat = game.categoryBin;
  const draft: Draft = {
    kind: 'sync',
    inputs: [
      { utxo: a.lane, unlock: { type: 'contract', contract: game.lane, fn: 'sync', args: [] } },
      a.hero,
      { utxo: a.ownGhost, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } },
    ],
    outputs: [
      { lockingBytecode: a.lane.lockingBytecode, valueSatoshis: a.lane.satoshis, token: a.lane.token },
      { lockingBytecode: toLock, valueSatoshis: a.hero.utxo.satoshis, token: a.hero.utxo.token },
      { lockingBytecode: game.arenaLock, valueSatoshis: a.ownGhost.satoshis, token: nft(cat, 'none', encodeGhost({ ...ghost, ownerPkh: pkhOfLock(toLock) })) },
    ],
  };
  return { draft, ghost };
}
/** True when the ghost already pays the pkh of `lock` (no sync needed). */
export const ghostPays = (ghostUtxo: Utxo, lock: Uint8Array) => isP2pkh(lock) && eq(decodeGhost(commitmentOf(ghostUtxo)).ownerPkh, pkhOfLock(lock));

// ------------------------------------------------------------------ RECLAIM
/** True for a game ticket UTXO. */
export const isTicket = (game: Game, u: Utxo) => isGame(game, u) && u.token!.nft?.commitment[0] === 0x54;
/**
 * Reclaim tickets of lost or abandoned duels: the holder spends them from its own P2PKH and
 * the NFTs are burned (no output carries them); their sats go to `toLock` (via finalize's
 * change). No covenant is involved: a ticket only matters to a forge, which needs a win.
 */
export function reclaimDraft(game: Game, tickets: Input[]): Draft {
  if (!tickets.length) throw new Error('no tickets to reclaim');
  for (const t of tickets) if (!isTicket(game, t.utxo)) throw new Error(`${t.utxo.txid}:${t.utxo.vout} is not a ticket; only tickets are reclaimed`);
  return { kind: 'reclaim', inputs: tickets, outputs: [] };
}

// ------------------------------------------------------------------ SALE
/**
 * OP_RETURN 'EVR1' (price in sats) or 'EVR2' (price in PUSD cents) + sellerPkh20 + price8 that
 * lets clients find a listing and rebuild its address.
 */
export const encodeListingTag = (sellerPkh: Uint8Array, price: bigint, currency: Currency = 'bch') => {
  const p = new Uint8Array(8);
  let v = price; for (let i = 0; i < 8; i++) { p[i] = Number(v & 0xffn); v >>= 8n; }
  return Uint8Array.from([0x6a, 0x04, 0x45, 0x56, 0x52, currency === 'pusd' ? 0x32 : 0x31, 0x14, ...sellerPkh, 0x08, ...p]);
};
export const decodeListingTag = (lock: Uint8Array): { sellerPkh: Uint8Array; price: bigint; currency: Currency } | null => {
  if (lock.length !== 36 || lock[0] !== 0x6a || lock[1] !== 0x04 || lock[2] !== 0x45 || lock[3] !== 0x56 || lock[4] !== 0x52 || (lock[5] !== 0x31 && lock[5] !== 0x32) || lock[6] !== 0x14 || lock[27] !== 0x08) return null;
  let price = 0n; for (let i = 7; i >= 0; i--) price = price * 256n + BigInt(lock[28 + i]);
  return { sellerPkh: lock.slice(7, 27), price, currency: lock[5] === 0x32 ? 'pusd' : 'bch' };
};

/** List a hero or gear: token to Sale(sellerPkh, price), dust to the bazaar beacon, discovery tag. */
export function listDraft(game: Game, token: Input, sellerPkh: Uint8Array, price: bigint, currency: Currency = 'bch'): { draft: Draft; saleLock: Uint8Array } {
  if (!isGame(game, token.utxo)) throw new Error('only game tokens can be listed');
  const kind = commitmentOf(token.utxo)[0];
  if (kind !== 0x48 && kind !== 0x45) throw new Error('only heroes and gear can be listed');
  if (currency === 'bch' && price < DUST) throw new Error(`price must be at least ${DUST} sats`);
  if (currency === 'pusd' && price < 1n) throw new Error('price must be at least 0.01 PUSD');
  const saleLock = hexToBin(game.saleFor(sellerPkh, price, currency).lockingBytecode);
  return {
    saleLock,
    draft: {
      kind: 'list',
      inputs: [token],
      outputs: [
        { lockingBytecode: saleLock, valueSatoshis: token.utxo.satoshis, token: token.utxo.token },
        { lockingBytecode: game.bazaarLock, valueSatoshis: DUST },
        { lockingBytecode: encodeListingTag(sellerPkh, price, currency), valueSatoshis: 0n },
      ],
    },
  };
}

export type Listing = { utxo: Utxo; sellerPkh: Uint8Array; price: bigint; currency?: Currency };
/**
 * Buy one or more listings: listing i is input i and is paid at output i; tokens go to buyerLock.
 * BCH listings are paid in sats. PUSD listings are paid from `pusd` (the buyer's PUSD UTXOs,
 * signed by the caller); PUSD left over comes back to buyerLock in its own output.
 */
export function buyDraft(game: Game, listings: Listing[], buyerLock: Uint8Array, pusd: Input[] = []): Draft {
  if (!listings.length) throw new Error('nothing to buy');
  const inputs: Input[] = listings.map((l) => {
    const c = game.saleFor(l.sellerPkh, l.price, l.currency ?? 'bch');
    if (!eq(hexToBin(c.lockingBytecode), l.utxo.lockingBytecode)) throw new Error('listing UTXO is not at its Sale contract');
    return { utxo: l.utxo, unlock: { type: 'contract', contract: c, fn: 'buy', args: [] } };
  });
  const outputs: Output[] = listings.map((l) => (l.currency === 'pusd'
    ? { lockingBytecode: p2pkhLock(l.sellerPkh), valueSatoshis: TOKEN_SATS, token: { category: hexToBin(game.pusdCategory!), amount: l.price } }
    : { lockingBytecode: p2pkhLock(l.sellerPkh), valueSatoshis: l.price }));
  listings.forEach((l) => outputs.push({ lockingBytecode: buyerLock, valueSatoshis: l.utxo.satoshis, token: l.utxo.token }));
  const owed = listings.filter((l) => l.currency === 'pusd').reduce((x, l) => x + l.price, 0n);
  if (owed > 0n) {
    const cat = game.pusdCategory!;
    const have = pusd.reduce((x, i) => {
      const t = i.utxo.token;
      if (!t || binToHex(t.category) !== cat || t.nft) throw new Error('only plain PUSD can pay for a PUSD listing');
      return x + (t.amount ?? 0n);
    }, 0n);
    if (have < owed) throw new Error(`not enough PUSD: need ${fmtPusd(owed)}, have ${fmtPusd(have)}`);
    inputs.push(...pusd);
    if (have > owed) outputs.push({ lockingBytecode: buyerLock, valueSatoshis: TOKEN_SATS, token: { category: hexToBin(cat), amount: have - owed } });
  }
  return { kind: 'buy', inputs, outputs };
}
/** 150n -> "$1.50" */
export const fmtPusd = (cents: bigint) => `$${(Number(cents) / 100).toFixed(2)}`;

/** Seller takes a listing back (signs with the Satchel key; a wallet seller would use a Satchel step). */
export function cancelDraft(game: Game, l: Listing, sellerKey: Uint8Array, sellerPub: Uint8Array, toLock: Uint8Array): Draft {
  const c = game.saleFor(l.sellerPkh, l.price, l.currency ?? 'bch');
  return {
    kind: 'cancel',
    inputs: [{ utxo: l.utxo, unlock: { type: 'contract', contract: c, fn: 'cancel', args: [sellerPub, new SignatureTemplate(sellerKey)] } }],
    outputs: [{ lockingBytecode: toLock, valueSatoshis: l.utxo.satoshis, token: l.utxo.token }],
  };
}

// ------------------------------------------------------------------ plain moves
/** Send home / bring back / gift: move token UTXOs to another P2PKH, unchanged. */
export function sendDraft(tokens: Input[], toLock: Uint8Array, kind = 'send'): Draft {
  if (!tokens.length) throw new Error('nothing to send');
  return { kind, inputs: tokens, outputs: tokens.map((t) => ({ lockingBytecode: toLock, valueSatoshis: t.utxo.satoshis, token: t.utxo.token })) };
}

/** Pay plain BCH (wallet funds the Satchel, or the Satchel pays back). */
export function payDraft(toLock: Uint8Array, amount: bigint, kind = 'pay'): Draft {
  if (amount < DUST) throw new Error(`amount must be at least ${DUST} sats`);
  return { kind, inputs: [], outputs: [{ lockingBytecode: toLock, valueSatoshis: amount }] };
}

// ------------------------------------------------------------------ outputs -> new UTXOs
/** The UTXO a built transaction creates at output `vout` (for 0 conf chaining). */
export const utxoOf = (b: Pick<Built, 'txid' | 'outputs'>, vout: number): Utxo => ({
  txid: b.txid, vout, satoshis: b.outputs[vout].valueSatoshis, lockingBytecode: b.outputs[vout].lockingBytecode,
  ...(b.outputs[vout].token ? { token: b.outputs[vout].token } : {}),
});

