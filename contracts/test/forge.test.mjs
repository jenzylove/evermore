// Forge path: replay, level up with own ghost refresh, gear drop with the capped Counter,
// parallel lanes, and the new seed (no txid term). Cases from spike S3 plus the seed change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, game, nft, A, A2, B, X, lanes, U, run, raise, challenge, valid, rejected, ghostU, heroU, counterU, signed, winFor } from './helpers.mjs';

const O = (lockingBytecode, v, token) => ({ lockingBytecode, valueSatoshis: BigInt(v), ...(token ? { token } : {}) });
const arenaIn = (utxo) => ({ utxo, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } });
const setArgs = (d, args) => { d.inputs[0] = { ...d.inputs[0], unlock: { ...d.inputs[0].unlock, args } }; };

/** Challenge (paying again each time: the "reroll") until the duel is winnable and `want` holds. */
function challengeUntil(laneU, ghostUtxo, hero, who, want = () => true, max = 60) {
  let l = laneU, g = ghostUtxo;
  for (let t = 1; t <= max; t++) {
    const c = challenge(l, g, hero.id, who);
    valid(c, 'challenge');
    const moves = winFor(hero, c.ticket);
    const ghost = E.decodeGhost(c.ghostUtxo.token.nft.commitment);
    if (moves && want(E.forgeOutcome(hero, c.ticket, ghost.beaten, moves))) return { ...c, moves, tries: t };
    l = c.laneUtxo; g = c.ghostUtxo;
  }
  throw new Error('no winnable style found');
}
const forge = (a, payer, opts) => {
  const { draft, result, drop } = E.forgeDraft(game, a);
  return { ...run(draft, payer, opts), result, drop, draft };
};
/** Build the valid draft, then let the attacker rewrite it (bypasses the sdk guards). */
const forgeMut = (a, payer, mut) => forge(a, payer, { mut });

const rA = raise(lanes[3], 0, A); // hero 3, Knight, owner A
const rB = raise(lanes[9], 2, B); // hero 9, Mage, owner B
const ch = challengeUntil(lanes[5], rB.ghostUtxo, rA.hero, A, (f) => f.levelled);
const base = { lane: lanes[11], hero: signed(rA.heroUtxo, A), ghost: ch.ghostUtxo, ticket: signed(ch.ticketUtxo, A), ownGhost: rA.ghostUtxo, moves: ch.moves };
const fLv = forge(base, A);

test('forge: real chain raise -> challenge -> forge on another lane, L1 -> L2, own ghost refreshed', () => {
  valid(fLv);
  assert.equal(fLv.result.hero.level, 2);
  const own = E.decodeGhost(fLv.built.outputs[4].token.nft.commitment);
  assert.equal(own.level, 2);
  assert.equal(own.hp, fLv.result.hero.hp);
  assert.equal(E.decodeGhost(fLv.built.outputs[2].token.nft.commitment).beaten, 1);
  assert.equal(E.decodeHero(fLv.built.outputs[1].token.nft.commitment).wins, 1);
});
test('forge rejected: level up without the own ghost', () => {
  rejected(forgeMut(base, A, (d) => { d.inputs.splice(4, 1); d.outputs.splice(4, 1); }));
  assert.throws(() => E.forgeDraft(game, { ...base, ownGhost: undefined }));
});
test('forge rejected: level up, own ghost kept at old stats', () => rejected(forgeMut(base, A, (d) => { d.outputs[4] = O(game.arenaLock, 1000, rA.ghostUtxo.token); })));
test("forge rejected: someone else's ghost passed as own", () => {
  const other = raise(lanes[6], 1, X);
  rejected(forgeMut(base, A, (d) => { d.inputs[4] = arenaIn(other.ghostUtxo); }));
});
const heroHome = signed(U(A2.lock, 1000, rA.heroUtxo.token), A2);
const ticketHome = signed(U(A2.lock, 1000, ch.ticketUtxo.token, ch.ticketUtxo.txid, ch.ticketUtxo.vout), A2);
test('forge: level up after Send home moves the ghost fee address to the new pkh', () => {
  const r = forge({ ...base, hero: heroHome, ticket: ticketHome }, A2);
  valid(r);
  assert.deepEqual(E.decodeGhost(r.built.outputs[4].token.nft.commitment).ownerPkh, A2.pkh);
});
test('forge rejected: level up after Send home, ghost owner left stale', () => rejected(forgeMut({ ...base, hero: heroHome, ticket: ticketHome }, A2, (d) => {
  const g = E.decodeGhost(d.outputs[4].token.nft.commitment);
  d.outputs[4] = O(game.arenaLock, 1000, nft('none', E.encodeGhost({ ...g, ownerPkh: A.pkh })));
})));
test('forge rejected: ticket for another hero', () => {
  const t = signed(U(A.lock, 1000, nft('none', E.encodeTicket({ ...ch.ticket, heroId: 19 }))), A);
  rejected(forgeMut(base, A, (d) => { d.inputs[3] = t; }));
});
test('forge rejected: fabricated ticket with edited seed counters', () => {
  const t = signed(U(A.lock, 1000, nft('none', E.encodeTicket({ ...ch.ticket, defences: ch.ticket.defences + 3 }))), A);
  rejected(forgeMut(base, A, (d) => { d.inputs[3] = t; }));
});
test('forge rejected: fake move list that loses, claiming the honest result', () => {
  const lose = Array(ch.moves.length).fill(E.GUARD);
  assert.equal(E.duel(rA.hero, ch.ticket, E.seedOf(E.ticketSeedHash(ch.ticket)), lose).won, false);
  rejected(forgeMut(base, A, (d) => setArgs(d, [E.packMoves(lose), BigInt(lose.length), 0n])));
  assert.throws(() => E.forgeDraft(game, { ...base, moves: lose }));
});
test('forge rejected: winning list plus one trailing move', () => {
  const m = [...ch.moves, E.STRIKE];
  rejected(forgeMut(base, A, (d) => setArgs(d, [E.packMoves(m), BigInt(m.length), 0n])));
});
test('forge rejected: hero commitment level + 5', () => rejected(forgeMut(base, A, (d) => {
  d.outputs[1] = O(A.lock, 1000, nft('none', E.encodeHero({ ...fLv.result.hero, level: 7 })));
})));
test('forge rejected: hero sent to another owner', () => rejected(forgeMut(base, A, (d) => { d.outputs[1] = { ...d.outputs[1], lockingBytecode: X.lock }; })));
test('forge rejected: opponent ghost taken, or recreated without beaten + 1', () => {
  rejected(forgeMut(base, A, (d) => { d.outputs[2] = { ...d.outputs[2], lockingBytecode: A.lock }; }));
  rejected(forgeMut(base, A, (d) => { d.outputs[2] = O(game.arenaLock, 1000, ch.ghostUtxo.token); }));
});
test('forge rejected: treasury fee 1 sat short', () => rejected(forgeMut(base, A, (d) => { d.outputs[3] = O(game.treasuryLock, game.params.forgeFee - 1n); })));
test('forge rejected: lane returned without minting', () => rejected(forgeMut(base, A, (d) => { d.outputs[0] = O(game.laneLock, 1000, nft('none', d.outputs[0].token.nft.commitment)); })));

// no level up: a vet hero far from its next level
const vet = { ...E.starterHero(35, 0), level: 5, hp: 72, atk: 14, def: 16 };
const vetGhost = ghostU(E.ghostOf(vet, A.pkh));
const ch2 = challengeUntil(ch.laneUtxo, ch.ghostUtxo, vet, A);
const nb = { lane: lanes[12], hero: signed(heroU(vet, A), A), ghost: ch2.ghostUtxo, ticket: signed(ch2.ticketUtxo, A), moves: ch2.moves };
test('forge: valid without a level up (own ghost not needed)', () => { const r = forge(nb, A); valid(r); assert.equal(r.result.levelled, false); });
test('forge rejected: no level up, own ghost included anyway', () => rejected(forgeMut(nb, A, (d) => {
  d.inputs.splice(4, 0, arenaIn(vetGhost));
  d.outputs.splice(4, 0, O(game.arenaLock, 1000, vetGhost.token));
})));
test('forge rejected: hero xp + 1', () => rejected(forgeMut(nb, A, (d) => {
  const h = E.decodeHero(d.outputs[1].token.nft.commitment);
  d.outputs[1] = O(A.lock, 1000, nft('none', E.encodeHero({ ...h, xp: h.xp + 1 })));
})));

// ---------------------------------------------------------------- gear
const strong = { ...E.starterHero(51, 1), level: 2, hp: 80, atk: 30, def: 20, spd: 30 };
const bigG = { id: 77, cls: 0, level: 5, hp: 70, atk: 12, def: 10, spd: 5, ownerPkh: X.pkh, beaten: 20, defences: 3 };
const ch3 = challengeUntil(lanes[7], ghostU(bigG), strong, B);
const gd = { lane: lanes[13], hero: signed(heroU(strong, B), B), ghost: ch3.ghostUtxo, ticket: signed(ch3.ticketUtxo, B), moves: ch3.moves, counter: counterU(0) };
const gOk = forge(gd, B);
test('gear: L2 beats a ghost snapshotted at L5 -> gear #0 tier 3, counter 0 -> 1', () => {
  valid(gOk);
  assert.equal(gOk.drop, true);
  assert.deepEqual(E.decodeGear(gOk.built.outputs[5].token.nft.commitment), { id: 0, kind: gOk.result.gearKind, tier: 3 });
  assert.equal(E.decodeCounter(gOk.built.outputs[4].token.nft.commitment), 1);
});
test('gear: eligible but skipped (drop = 0, no counter) is valid', () => valid(forge({ ...gd, counter: undefined }, B)));
test('gear rejected: counter not incremented', () => rejected(forgeMut(gd, B, (d) => { d.outputs[4] = O(game.counterLock, 1000, nft('none', E.encodeCounter(0))); })));
test('gear rejected: tier forged (9)', () => rejected(forgeMut(gd, B, (d) => { d.outputs[5] = O(B.lock, 1000, nft('none', E.encodeGear({ id: 0, kind: gOk.result.gearKind, tier: 9 }))); })));
test('gear rejected: kind forged', () => rejected(forgeMut(gd, B, (d) => { d.outputs[5] = O(B.lock, 1000, nft('none', E.encodeGear({ id: 0, kind: (gOk.result.gearKind + 1) % 3, tier: 3 }))); })));
test('gear rejected: sent to another address', () => rejected(forgeMut(gd, B, (d) => { d.outputs[5] = { ...d.outputs[5], lockingBytecode: X.lock }; })));
test('gear rejected: cap reached (counter at 3 of 3)', () => {
  rejected(forgeMut(gd, B, (d) => {
    d.inputs[4] = { ...d.inputs[4], utxo: counterU(3) };
    d.outputs[4] = O(game.counterLock, 1000, nft('none', E.encodeCounter(4)));
    d.outputs[5] = O(B.lock, 1000, nft('none', E.encodeGear({ id: 3, kind: gOk.result.gearKind, tier: 3 })));
  }));
  assert.equal(forge({ ...gd, counter: counterU(3) }, B).drop, false, 'sdk skips the drop at the cap');
});
test('gear: last one under the cap (counter 2 -> 3) is valid', () => valid(forge({ ...gd, counter: counterU(2) }, B)));
test('gear rejected: second gear minted into change', () => rejected(forge(gd, B, { noChange: true, mut: (d) => { d.outputs.push(O(B.lock, 1000, nft('none', E.encodeGear({ id: 1, kind: 0, tier: 3 })))); } })));
test('gear rejected: drop claimed vs a ghost only 2 levels above', () => {
  const near = { ...strong, id: 52, level: 3 };
  const c = challengeUntil(lanes[8], ghostU(bigG), near, B);
  const a = { lane: lanes[13], hero: signed(heroU(near, B), B), ghost: c.ghostUtxo, ticket: signed(c.ticketUtxo, B), moves: c.moves };
  assert.throws(() => E.forgeDraft(game, { ...a, counter: counterU(0), drop: true }));
  rejected(forgeMut(a, B, (d) => {
    setArgs(d, [d.inputs[0].unlock.args[0], d.inputs[0].unlock.args[1], 1n]);
    d.inputs.push({ utxo: counterU(0), unlock: { type: 'contract', contract: game.counter, fn: 'tick', args: [] } });
    d.outputs.push(O(game.counterLock, 1000, nft('none', E.encodeCounter(1))), O(B.lock, 1000, nft('none', E.encodeGear({ id: 0, kind: 0, tier: 2 }))));
  }));
});

test('WORST CASE: 12 round win + level up + gear drop (6 in / 8 out) under 50% of the op budget', () => {
  let w = null;
  for (let k = 0; k < 40000 && !w; k++) {
    const h = { id: 900, cls: 1, level: 10, xp: 199, hp: 400, atk: 30, def: 30, spd: 20, wins: 0 };
    const g = { id: 901, cls: 0, level: 13, hp: 150 + (k % 60), atk: 25, def: 30, spd: 10, ownerPkh: X.pkh, beaten: 0, defences: k % 30000 };
    const t = E.ticketFor(900, g);
    const m = Array.from({ length: 12 }, () => Math.floor(Math.random() * 3));
    const r = E.duel(h, t, E.seedOf(E.ticketSeedHash(t)), m);
    if (r.won && r.rounds === 12) w = { h, g, t, m };
  }
  assert.ok(w, 'found a 12 round win');
  const r = forge({ lane: lanes[15], hero: signed(heroU(w.h, A), A), ghost: ghostU({ ...w.g, defences: w.g.defences + 1 }),
    ticket: signed(U(A.lock, 1000, nft('none', E.encodeTicket(w.t))), A), ownGhost: ghostU(E.ghostOf(w.h, A.pkh)), counter: counterU(1), moves: w.m }, A);
  valid(r);
  assert.equal(r.built.transaction.outputs.length, 8);
  const m = r.metrics[0];
  assert.ok(m.op / m.budget < 0.5, `worst case uses ${(100 * m.op / m.budget).toFixed(1)}%`);
  console.log(`# worst case lane op cost ${m.op}/${m.budget} (${(100 * m.op / m.budget).toFixed(1)}%), tx ${r.built.size} B`);
});

// ---------------------------------------------------------------- lanes
test('lanes: forges on lanes 11 and 14 share no inputs; same lane conflicts; chained rebuild is valid', () => {
  const ch4 = challengeUntil(lanes[2], E.utxoOf(fLv.built, 4), rB.hero, B, (f) => f.levelled);
  const a2 = { lane: lanes[14], hero: signed(rB.heroUtxo, B), ghost: ch4.ghostUtxo, ticket: signed(ch4.ticketUtxo, B), ownGhost: rB.ghostUtxo, moves: ch4.moves };
  const f2 = forge(a2, B);
  valid(f2);
  const ops = (r) => new Set(r.built.inputs.map((i) => `${i.utxo.txid}:${i.utxo.vout}`));
  const s1 = ops(fLv), s2 = ops(f2);
  assert.equal([...s1].filter((x) => s2.has(x)).length, 0);
  const f3 = forge({ ...a2, lane: lanes[11] }, B);
  assert.equal([...ops(f3)].filter((x) => s1.has(x)).length, 1, 'same lane = one shared input (double spend)');
  valid(forge({ ...a2, lane: E.utxoOf(fLv.built, 0) }, B), "rebuilt on the lane's new outpoint");
});
test('lanes: any lane serves any player; 16 lanes x 1 raise -> 16 distinct ids', () => {
  const ids = lanes.map((l) => raise(l, 0, A).hero.id);
  assert.deepEqual(ids, Array.from({ length: 16 }, (_, i) => i));
});

// ---------------------------------------------------------------- the new seed
test('seed: no txid term; previewable before paying; different funding gives the same ticket', () => {
  const g = E.decodeGhost(rB.ghostUtxo.token.nft.commitment);
  const t = E.ticketFor(3, g);
  assert.deepEqual(E.ghostMoves(E.seedOf(E.ticketSeedHash(t))), E.previewStyle(3, g));
  const c1 = challenge(lanes[4], rB.ghostUtxo, 3, A);
  const c2 = challenge(lanes[4], rB.ghostUtxo, 3, X);
  valid(c1); valid(c2);
  assert.notEqual(c1.built.txid, c2.built.txid);
  assert.deepEqual(c1.built.outputs[3].token.nft.commitment, c2.built.outputs[3].token.nft.commitment);
});
test('seed: every reroll is a paid challenge (defences + 1 changes the next style)', () => {
  const g0 = E.decodeGhost(rB.ghostUtxo.token.nft.commitment);
  const g1 = E.decodeGhost(challenge(lanes[10], rB.ghostUtxo, 3, A).ghostUtxo.token.nft.commitment);
  assert.equal(g1.defences, g0.defences + 1);
  assert.notDeepEqual(E.ticketSeedHash(E.ticketFor(3, g0)), E.ticketSeedHash(E.ticketFor(3, g1)));
});
test('seed: a different hero sees a different style for the same ghost state', () => {
  const g = E.decodeGhost(rB.ghostUtxo.token.nft.commitment);
  assert.notDeepEqual(E.ticketSeedHash(E.ticketFor(3, g)), E.ticketSeedHash(E.ticketFor(4, g)));
});
test('seed rejected: moves solved for a different seed do not forge (covenant hashes the ticket fields itself)', () => {
  let tested = 0;
  for (let d = 1; d < 40 && tested < 3; d++) {
    const other = E.seedOf(E.ticketSeedHash({ ...ch.ticket, defences: ch.ticket.defences + d }));
    const m = E.solve(rA.hero, ch.ticket, other);
    if (!m) continue;
    const r = E.duel(rA.hero, ch.ticket, E.seedOf(E.ticketSeedHash(ch.ticket)), m);
    if (r.won && r.rounds === m.length) continue; // wins under both seeds: no signal
    rejected(forgeMut(base, A, (dd) => setArgs(dd, [E.packMoves(m), BigInt(m.length), 0n])));
    tested++;
  }
  assert.ok(tested > 0, 'found at least one move list that wins only under another seed');
});
