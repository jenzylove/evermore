import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/index.ts';

const pkh = new Uint8Array(20).fill(9);

test('codec: every layout round trips and has its spec size', () => {
  const h = { ...E.starterHero(77, 1), xp: 33, wins: 4 };
  assert.deepEqual(E.decodeHero(E.encodeHero(h)), h);
  const g = E.ghostOf(h, pkh, 5, 6);
  assert.deepEqual(E.decodeGhost(E.encodeGhost(g)), g);
  const t = E.ticketFor(12, g);
  assert.deepEqual(E.decodeTicket(E.encodeTicket(t)), t);
  assert.deepEqual(E.decodeLane(E.encodeLane({ lane: 7, ctr: 9 })), { lane: 7, ctr: 9 });
  assert.equal(E.decodeCounter(E.encodeCounter(41)), 41);
  assert.deepEqual(E.decodeGear(E.encodeGear({ id: 3, kind: 2, tier: 5 })), { id: 3, kind: 2, tier: 5 });
  assert.equal(E.encodeGhost(g).length, 39);
  assert.equal(E.encodeTicket(t).length, 23);
  assert.equal(E.decodeAny(E.encodeHero(h)).kind, 'hero');
  assert.equal(E.decodeAny(Uint8Array.of(0x48, 1)).kind, 'unknown');
});

test('codec: refuses out of range fields and wrong tags', () => {
  assert.throws(() => E.encodeHero({ ...E.starterHero(1, 0), level: 128 }));
  assert.throws(() => E.encodeGhost({ ...E.ghostOf(E.starterHero(1, 0), pkh), defences: 32768 }));
  assert.throws(() => E.decodeHero(E.encodeGear({ id: 1, kind: 0, tier: 3 })));
});

test('rules: starter stats and damage', () => {
  assert.deepEqual(E.STARTER[0], { hp: 60, atk: 10, def: 8, spd: 4 });
  assert.equal(E.hit(10, 8, 1, false), 6);
  assert.equal(E.hit(10, 8, 1, true), 3);
  assert.equal(E.hit(2, 50, 1, false), 1);
  assert.equal(E.hit(10, 8, 2, false), 16);
});

test('rules: special needs 2 guard charges, then resets', () => {
  const h = { hp: 100, atk: 20, def: 0, spd: 10 };
  const g = { hp: 1000, atk: 1, def: 0, spd: 1 };
  const r = E.duel(h, g, 0, [E.GUARD, E.GUARD, E.SPECIAL, E.SPECIAL]); // seed 0: ghost always strikes
  assert.deepEqual(r.log.map((x) => x.hDmg), [0, 0, 40, 20]);
});

test('rules: seed is hash256(heroId4 || ghostId4 || beaten2 || defences2) and previewable', () => {
  const g = E.ghostOf(E.starterHero(9, 2), pkh, 3, 4);
  const h = E.seedHash(1, 9, 3, 4);
  assert.deepEqual(E.ticketSeedHash(E.ticketFor(1, g)), h);
  assert.equal(E.previewStyle(1, g).length, 12);
  assert.deepEqual(E.previewStyle(1, g), E.ghostMoves(E.seedOf(h)));
  assert.notDeepEqual(E.seedHash(1, 9, 3, 5), h);
});

test('rules: solve finds a win that forgeOutcome accepts; level up applies class growth', () => {
  const h = E.starterHero(1, 0);
  const g = E.ghostOf(E.starterHero(2, 1), pkh);
  for (let d = 0; d < 50; d++) {
    const t = E.ticketFor(1, { ...g, defences: d });
    const m = E.solve(h, t, E.seedOf(E.ticketSeedHash(t)));
    if (!m) continue;
    const f = E.forgeOutcome(h, t, 0, m);
    assert.equal(f.valid, true);
    assert.equal(f.levelled, true); // L1 needs 20 xp; any win gives more
    assert.deepEqual([f.hero.level, f.hero.hp, f.hero.atk, f.hero.def], [2, 63, 11, 10]);
    assert.equal(E.forgeOutcome(h, t, 0, [...m, 0]).valid, false);
    return;
  }
  assert.fail('no winnable style in 50 tries');
});

test('rules: packMoves / unpackMoves', () => {
  const m = [2, 0, 1, 2, 2, 1];
  assert.deepEqual(E.unpackMoves(E.packMoves(m), m.length), m);
});
