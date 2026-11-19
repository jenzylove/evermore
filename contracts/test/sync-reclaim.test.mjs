// Sync (fees follow the owner) and ticket reclaim, in the 2026 VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, game, nft, A, B, X, lanes, U, run, raise, challenge, valid, rejected, signed, ghostU, counterU } from './helpers.mjs';

const O = (lockingBytecode, v, token) => ({ lockingBytecode, valueSatoshis: BigInt(v), ...(token ? { token } : {}) });
const rA = raise(lanes[2], 0, A);   // hero 2, owned by A
const rB = raise(lanes[7], 1, B);   // hero 7, owned by B
// A sells / gives hero 2 to B: the hero now sits at B, its ghost still pays A
const heroAtB = U(B.lock, 1000, rA.heroUtxo.token);
const syncB = (opts = {}) => E.syncDraft(game, { lane: lanes[4], hero: signed(opts.hero ?? heroAtB, opts.signer ?? B), ownGhost: opts.ghost ?? rA.ghostUtxo, toLock: opts.toLock });

test('sync: new holder points the ghost at itself (owner A -> B, stats and counters kept)', () => {
  const r = run(syncB().draft, B);
  valid(r);
  const g = E.decodeGhost(r.built.outputs[2].token.nft.commitment);
  const before = E.decodeGhost(rA.ghostUtxo.token.nft.commitment);
  assert.deepEqual(g.ownerPkh, B.pkh);
  assert.deepEqual({ ...g, ownerPkh: null }, { ...before, ownerPkh: null });
  assert.deepEqual(r.built.outputs[1].token.nft.commitment, rA.heroUtxo.token.nft.commitment);
  assert.ok(r.metrics[0].op / r.metrics[0].budget < 0.2, `sync op cost ${r.metrics[0].op}/${r.metrics[0].budget}`);
});

test('sync: Send home in one tx (Satchel A signs, hero and ghost owner move to X)', () => {
  const r = run(E.syncDraft(game, { lane: lanes[4], hero: signed(rA.heroUtxo, A), ownGhost: rA.ghostUtxo, toLock: X.lock }).draft, A);
  valid(r);
  assert.deepEqual(r.built.outputs[1].lockingBytecode, X.lock);
  assert.deepEqual(E.decodeGhost(r.built.outputs[2].token.nft.commitment).ownerPkh, X.pkh);
});

test('sync: the old owner cannot sign for a hero it no longer holds (P2PKH signature fails)', () => {
  const r = run(syncB({ signer: A }).draft, A);
  assert.equal(r.ok, false);
  assert.match(r.err, /input index 1/);
});

test('sync then challenge: the fee now goes to the new owner', () => {
  const s = run(syncB().draft, B);
  const c = challenge(lanes[9], E.utxoOf(s.built, 2), 7, B);
  valid(c);
  assert.deepEqual(c.built.outputs[2].lockingBytecode, B.lock);
});

const sbad = (label, mut, opts) => test(`sync rejected: ${label}`, () => {
  const { draft } = syncB(opts);
  rejected(run(draft, B, { mut }), label);
});
const ghostA = E.decodeGhost(rA.ghostUtxo.token.nft.commitment);
sbad('owner set to a third party', (d) => { d.outputs[2] = O(game.arenaLock, 1000, nft('none', E.encodeGhost({ ...ghostA, ownerPkh: X.pkh }))); });
sbad('ghost stats edited', (d) => { d.outputs[2] = O(game.arenaLock, 1000, nft('none', E.encodeGhost({ ...ghostA, ownerPkh: B.pkh, atk: 99 }))); });
sbad('ghost counters reset', (d) => { d.outputs[2] = O(game.arenaLock, 1000, nft('none', E.encodeGhost({ ...ghostA, ownerPkh: B.pkh, defences: 0, beaten: 0 }))); }, { ghost: ghostU({ ...ghostA, beaten: 5, defences: 9 }) });
sbad('ghost taken off the Arena', (d) => { d.outputs[2] = { ...d.outputs[2], lockingBytecode: B.lock }; });
sbad('hero edited (level 9)', (d) => { d.outputs[1] = O(B.lock, 1000, nft('none', E.encodeHero({ ...rA.hero, level: 9 }))); });
sbad('hero sent to a covenant', (d) => { d.outputs[1] = { ...d.outputs[1], lockingBytecode: game.arenaLock }; });
sbad('someone else\'s ghost (hero 7) rewritten', (d) => {
  const g7 = E.decodeGhost(rB.ghostUtxo.token.nft.commitment);
  d.inputs[2] = { ...d.inputs[2], utxo: rB.ghostUtxo };
  d.outputs[2] = O(game.arenaLock, 1000, nft('none', E.encodeGhost({ ...g7, ownerPkh: B.pkh })));
});
sbad('extra NFT minted into change', (d) => { d.outputs.push(O(B.lock, 1000, nft('none', E.encodeHero({ ...rA.hero, id: 99 })))); });
sbad('lane altered', (d) => { d.outputs[0] = O(game.laneLock, 1000, nft('minting', E.encodeLane({ lane: 4, ctr: 9 }))); });
sbad('ticket passed as the hero', (d) => {
  const t = U(B.lock, 1000, nft('none', E.encodeTicket(E.ticketFor(2, ghostA))));
  d.inputs[1] = signed(t, B);
  d.outputs[1] = O(B.lock, 1000, t.token);
});
sbad('counter slipped in (burn attempt)', (d) => { d.inputs.splice(3, 0, { utxo: counterU(0), unlock: { type: 'contract', contract: game.counter, fn: 'tick', args: [] } }); });

test('sync: sdk refuses a hero outside a P2PKH, a foreign ghost, a covenant target', () => {
  assert.throws(() => syncB({ hero: U(game.arenaLock, 1000, rA.heroUtxo.token) }));
  assert.throws(() => syncB({ ghost: rB.ghostUtxo }));
  assert.throws(() => syncB({ toLock: game.arenaLock }));
});

// ---------------------------------------------------------------- reclaim
const c1 = challenge(lanes[11], rB.ghostUtxo, 2, A);
test('reclaim: the holder burns a lost ticket and gets its sats back, no lane', () => {
  const b = E.finalize(E.reclaimDraft(game, [signed(c1.ticketUtxo, A)]), { changeLock: A.lock });
  assert.equal(E.verify(b), true);
  assert.equal(b.outputs.length, 1);
  assert.equal(b.outputs[0].token, undefined);
  assert.ok(b.outputs[0].valueSatoshis > 546n && b.outputs[0].valueSatoshis < 1000n);
});
test('reclaim: stale tickets ride along as funding of the next challenge (burned there)', () => {
  const { draft } = E.challengeDraft(game, lanes[12], c1.ghostUtxo, 2, A.lock);
  draft.inputs.push(signed(c1.ticketUtxo, A));
  valid(run(draft, A));
});
test('reclaim: someone else cannot burn your ticket (P2PKH signature), and only tickets are reclaimed', () => {
  const b = E.finalize(E.reclaimDraft(game, [signed(c1.ticketUtxo, X)]), { changeLock: X.lock });
  assert.notEqual(E.verify(b), true);
  assert.throws(() => E.reclaimDraft(game, [signed(rA.heroUtxo, A)]));
  assert.throws(() => E.satchelWithdraw(new E.Satchel(A.k), [], A.lock, undefined, 1, [rA.heroUtxo]));
});
test('reclaim: Satchel sweep empties coins and tickets in one tx', () => {
  const b = E.satchelWithdraw(new E.Satchel(A.k), [U(A.lock, 20000)], X.lock, undefined, 1, [c1.ticketUtxo]);
  assert.equal(E.verify(b), true);
  assert.equal(b.outputs.length, 1);
  assert.ok(b.outputs[0].valueSatoshis > 20000n);
});
