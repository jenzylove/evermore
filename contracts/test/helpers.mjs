// Shared VM test harness: a mock deployment, keys, fake UTXOs, and finalize + verify through
// the sdk builders (so the tests exercise the same code the game ships).
import assert from 'node:assert/strict';
import { hash160, hash256, secp256k1, generatePrivateKey, binToHex, createVirtualMachineBch2026 } from '@bitauth/libauth';
import * as E from '@evermore/sdk';

export { E };
export const vm = createVirtualMachineBch2026(true); // standard mode

export const key = () => {
  const k = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(k);
  const pkh = hash160(pub);
  return { k, pub, pkh, lock: E.p2pkhLock(pkh) };
};
export const A = key(), A2 = key(), B = key(), T = key(), X = key(), seller = key(), buyer = key();

export const PARAMS = {
  category: binToHex(hash256(Uint8Array.of(0x45, 0x56, 0x52))), // display order
  treasuryPkh: binToHex(T.pkh),
  raisePrice: 50000n, challengeFee: 4000n, forgeFee: 2000n, gearCap: 3n,
};
export const game = E.makeGame(PARAMS, 'chipnet');
export const CAT = game.categoryBin;
export const nft = (capability, commitment) => ({ category: CAT, amount: 0n, nft: { capability, commitment } });

let nonce = 0;
export const fakeTxid = () => { nonce++; return binToHex(hash256(Uint8Array.of(nonce & 255, (nonce >> 8) & 255, 0x77))); };
export const U = (lockingBytecode, satoshis, token, txid = fakeTxid(), vout = 0) =>
  ({ txid, vout, satoshis: BigInt(satoshis), lockingBytecode, ...(token ? { token } : {}) });

export const lanes = Array.from({ length: 16 }, (_, n) => U(game.laneLock, 1000, nft('minting', E.encodeLane({ lane: n, ctr: 0 }))));
export const counterU = (minted) => U(game.counterLock, 1000, nft('none', E.encodeCounter(minted)));
export const ghostU = (g) => U(game.arenaLock, 1000, nft('none', E.encodeGhost(g)));
export const heroU = (h, owner) => U(owner.lock, 1000, nft('none', E.encodeHero(h)));
export const signed = (utxo, owner) => ({ utxo, unlock: { type: 'key', privateKey: owner.k } });
export const fund = (owner, v = 1000000) => [signed(U(owner.lock, v), owner)];

/** Finalize with the payer's coins and change, then verify in the VM; returns built + verdict + metrics. */
export function run(draft, payer, { mut, noChange } = {}) {
  const d = { ...draft, inputs: [...draft.inputs], outputs: draft.outputs.map((o) => ({ ...o })) };
  if (mut) mut(d);
  const built = E.finalize(d, { funding: fund(payer), changeLock: noChange ? undefined : payer.lock });
  const verdict = E.verify(built);
  const metrics = built.inputs.map((inp, idx) => {
    if (inp.unlock.type !== 'contract') return null;
    const st = vm.evaluate({ inputIndex: idx, sourceOutputs: built.sourceOutputs, transaction: built.transaction });
    const ul = built.transaction.inputs[idx].unlockingBytecode.length;
    return { name: `${inp.unlock.contract.name}.${inp.unlock.fn}`, op: st.metrics.operationCost, budget: (41 + ul) * 800 };
  }).filter(Boolean);
  return { built, ok: verdict === true, err: verdict === true ? '' : verdict, metrics };
}
export const valid = (r, msg = '') => assert.equal(r.ok, true, `expected valid${msg ? ` (${msg})` : ''}: ${r.err}`);
/**
 * Rejected BY A COVENANT: the failing input must be a contract input. Policy errors (dust,
 * size) or a bad P2PKH signature would mean the test is not testing the covenant.
 */
export const rejected = (r, msg = '') => {
  assert.equal(r.ok, false, `expected the VM to reject${msg ? ` (${msg})` : ''}`);
  const m = /input index (\d+)/.exec(r.err);
  assert.ok(m, `rejection was not a script failure${msg ? ` (${msg})` : ''}: ${r.err}`);
  const inp = r.built.inputs[Number(m[1])];
  assert.equal(inp.unlock.type, 'contract', `failure was on a non covenant input ${m[1]}${msg ? ` (${msg})` : ''}: ${r.err}`);
};
/** Run a function that must either throw in the sdk guard or produce a rejected tx. */
export const refused = (fn, msg = '') => {
  let r;
  try { r = fn(); } catch { return 'sdk'; }
  rejected(r, msg);
  return 'vm';
};

/** Raise a hero on a lane, returning the built tx and new UTXOs. */
export function raise(laneUtxo, cls, owner) {
  const { draft, hero, ghost } = E.raiseDraft(game, laneUtxo, cls, owner.lock);
  const r = run(draft, owner);
  return { ...r, hero, ghost, heroUtxo: E.utxoOf(r.built, 1), ghostUtxo: E.utxoOf(r.built, 2), laneUtxo: E.utxoOf(r.built, 0) };
}
export function challenge(laneUtxo, ghostUtxo, heroId, who, opts = {}) {
  const { draft, ticket } = E.challengeDraft(game, laneUtxo, ghostUtxo, heroId, who.lock);
  const r = run(draft, who, opts);
  return { ...r, ticket, ticketUtxo: E.utxoOf(r.built, 3), ghostUtxo: E.utxoOf(r.built, 1), laneUtxo: E.utxoOf(r.built, 0) };
}
/** Winning moves for hero vs the ticket's snapshot, or null. */
export const winFor = (hero, ticket) => E.solve(hero, ticket, E.seedOf(E.ticketSeedHash(ticket)));
