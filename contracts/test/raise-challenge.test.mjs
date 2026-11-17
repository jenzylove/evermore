// Raise and challenge paths: every valid and rejected case from spike S3, on the
// production layouts (39 B ghost, 23 B ticket, no txid in the seed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, game, CAT, nft, A, B, T, X, lanes, U, run, raise, challenge, valid, rejected, refused, ghostU, counterU, signed } from './helpers.mjs';

const O = (lockingBytecode, v, token) => ({ lockingBytecode, valueSatoshis: BigInt(v), ...(token ? { token } : {}) });
const rA = raise(lanes[3], 0, A);
const rB = raise(lanes[9], 2, B);

test('raise: valid Knight on lane 3 (id 3) and Mage on lane 9 (id 9), no shared inputs', () => {
  valid(rA); valid(rB);
  assert.equal(rA.hero.id, 3); assert.equal(rB.hero.id, 9);
  const ops = (r) => new Set(r.built.inputs.map((i) => `${i.utxo.txid}:${i.utxo.vout}`));
  const a = ops(rA), b = ops(rB);
  assert.equal([...a].filter((x) => b.has(x)).length, 0);
});

test('raise: chained second raise on lane 3 gets id 19', () => {
  const r = raise(rA.laneUtxo, 1, A);
  valid(r);
  assert.equal(r.hero.id, 19);
});

test('raise: op cost and size within limits', () => {
  const m = rA.metrics[0];
  assert.ok(m.op / m.budget < 0.2, `raise uses ${m.op}/${m.budget}`);
  assert.ok(rA.built.size < 4000);
});

const bad = (label, mut, extra) => test(`raise rejected: ${label}`, () => {
  const { draft } = E.raiseDraft(game, lanes[3], 0, A.lock);
  if (extra) draft.inputs.push(...extra);
  rejected(run(draft, A, { mut }), label);
});
bad('starter HP +1', (d) => { d.outputs[1] = O(A.lock, 1000, nft('none', E.encodeHero({ ...rA.hero, hp: 61 }))); });
bad('lane counter not bumped', (d) => { d.outputs[0] = O(game.laneLock, 1000, nft('minting', E.encodeLane({ lane: 3, ctr: 0 }))); });
bad('price 1 sat short', (d) => { d.outputs[3] = O(game.treasuryLock, game.params.raisePrice - 1n); });
bad('claims another id (99)', (d) => {
  const h = { ...rA.hero, id: 99 };
  d.outputs[1] = O(A.lock, 1000, nft('none', E.encodeHero(h)));
  d.outputs[2] = O(game.arenaLock, 1000, nft('none', E.encodeGhost(E.ghostOf(h, A.pkh))));
});
bad('ghost owner is not the hero owner', (d) => { d.outputs[2] = O(game.arenaLock, 1000, nft('none', E.encodeGhost(E.ghostOf(rA.hero, X.pkh)))); });
bad('no ghost minted (ghost sent to the player)', (d) => { d.outputs[2] = { ...d.outputs[2], lockingBytecode: A.lock }; });
bad('hero to a non P2PKH lock', (d) => { d.outputs[1] = { ...d.outputs[1], lockingBytecode: game.arenaLock }; });
bad('class 3', (d) => { d.inputs[0] = { ...d.inputs[0], unlock: { ...d.inputs[0].unlock, args: [3n] } }; });
bad('extra hero NFT minted into change', (d) => { d.outputs.push(O(A.lock, 1000, nft('none', E.encodeHero({ ...rA.hero, level: 99 })))); });
bad('lane output made immutable (minting dropped)', (d) => { d.outputs[0] = O(game.laneLock, 1000, nft('none', E.encodeLane({ lane: 3, ctr: 1 }))); });
bad('hero minted mutable', (d) => { d.outputs[1] = O(A.lock, 1000, nft('mutable', E.encodeHero(rA.hero))); });
bad('victim ghost slipped in as an input (burn attempt)', undefined, [{ utxo: rB.ghostUtxo, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } }]);
bad('counter burned inside a raise', undefined, [{ utxo: counterU(0), unlock: { type: 'contract', contract: game.counter, fn: 'tick', args: [] } }]);

test('raise: sdk refuses a non P2PKH owner and class 3 before signing', () => {
  assert.throws(() => E.raiseDraft(game, lanes[3], 0, game.arenaLock));
  assert.throws(() => E.raiseDraft(game, lanes[3], 3, A.lock));
});

// ---------------------------------------------------------------- challenge
const cOk = challenge(lanes[5], rB.ghostUtxo, 3, A);
test('challenge: valid (fee to B, defences + 1, ticket with snapshot and counters)', () => {
  valid(cOk);
  const g = E.decodeGhost(cOk.built.outputs[1].token.nft.commitment);
  assert.equal(g.defences, 1);
  assert.deepEqual(cOk.built.outputs[2].lockingBytecode, B.lock);
  assert.equal(cOk.built.outputs[2].valueSatoshis, game.params.challengeFee);
  const t = E.decodeTicket(cOk.built.outputs[3].token.nft.commitment);
  assert.deepEqual({ h: t.heroId, g: t.ghostId, b: t.beaten, d: t.defences }, { h: 3, g: 9, b: 0, d: 0 });
});

const cbad = (label, mut, opts = {}) => test(`challenge rejected: ${label}`, () => {
  const { draft } = E.challengeDraft(game, lanes[5], opts.ghost ?? rB.ghostUtxo, opts.heroId ?? 3, A.lock);
  if (opts.extra) draft.inputs.splice(2, 0, ...opts.extra);
  rejected(run(draft, A, { mut }), label);
});
const g9 = E.decodeGhost(rB.ghostUtxo.token.nft.commitment);
cbad('fee paid to someone else', (d) => { d.outputs[2] = O(X.lock, game.params.challengeFee); });
cbad('fee 1 sat short', (d) => { d.outputs[2] = O(B.lock, game.params.challengeFee - 1n); });
cbad('defences not bumped', (d) => { d.outputs[1] = O(game.arenaLock, 1000, nft('none', E.encodeGhost(g9))); });
cbad('ticket snapshot with ghost HP lowered', (d) => { d.outputs[3] = O(A.lock, 1000, nft('none', E.encodeTicket({ ...E.ticketFor(3, g9), hp: 1 }))); });
cbad('ticket with chosen seed counters (defences 7)', (d) => { d.outputs[3] = O(A.lock, 1000, nft('none', E.encodeTicket({ ...E.ticketFor(3, g9), defences: 7 }))); });
cbad('ticket naming another hero than the one challenged', (d) => { d.outputs[3] = O(A.lock, 1000, nft('none', E.encodeTicket(E.ticketFor(4, g9)))); });
cbad('ghost kept by the challenger', (d) => { d.outputs[1] = { ...d.outputs[1], lockingBytecode: A.lock }; });
cbad('second ghost slipped in as input 2 (burn attempt)', undefined, { extra: [{ utxo: rA.ghostUtxo, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } }] });
test('challenge rejected: own ghost (hero 9 vs ghost 9)', () => {
  assert.throws(() => E.challengeDraft(game, lanes[5], rB.ghostUtxo, 9, B.lock)); // sdk guard
  const { draft } = E.challengeDraft(game, lanes[5], rB.ghostUtxo, 3, B.lock);
  draft.inputs[0] = { ...draft.inputs[0], unlock: { ...draft.inputs[0].unlock, args: [9n] } };
  draft.outputs[3] = O(B.lock, 1000, nft('none', E.encodeTicket(E.ticketFor(9, g9))));
  rejected(run(draft, B), 'own ghost');
});
test('arena rejected: ghost spent with no lane input', () => {
  rejected(run({ kind: 'x', inputs: [{ utxo: rB.ghostUtxo, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } }], outputs: [O(game.arenaLock, 1000, rB.ghostUtxo.token)] }, X));
});
test('counter rejected: spent without a lane', () => {
  const c = counterU(0);
  rejected(run({ kind: 'x', inputs: [{ utxo: c, unlock: { type: 'contract', contract: game.counter, fn: 'tick', args: [] } }], outputs: [O(game.counterLock, 1000, c.token)] }, X));
});

test('challenge: defences saturate at 32767 instead of overflowing', () => {
  const g = { ...E.ghostOf(E.starterHero(40, 1), X.pkh), defences: 32767, beaten: 32767 };
  const c = challenge(lanes[6], ghostU(g), 3, A);
  valid(c, 'saturated ghost still challengeable');
  assert.equal(E.decodeGhost(c.built.outputs[1].token.nft.commitment).defences, 32767);
});
