// Parity: the sdk duel sim (what the browser plays) and the Lane covenant (what the chain
// enforces) agree on 100 random full forges, byte for byte. The draft is built by hand from
// the sim's prediction, NOT through forgeDraft, so the sdk's guards cannot hide a mismatch:
// wins must be valid with exactly the sim's commitment (and rejected with xp + 1); losses,
// claiming what a win would have paid, must be rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, game, nft, A, X, lanes, U, run, ghostU, heroU, counterU, signed } from './helpers.mjs';

const N = Number(process.env.PARITY_N ?? 100);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const O = (lockingBytecode, v, token) => ({ lockingBytecode, valueSatoshis: BigInt(v), ...(token ? { token } : {}) });
const tdiv = (a, b) => Math.trunc(a / b);

/** What a player would claim for these moves, computed as if they had won. */
function claimed(h, t, beaten, hHp, n) {
  const gain = tdiv((10 + 5 * t.level + tdiv(10 * Math.max(1, hHp), h.hp) + 12 - n) * 4, 4 + beaten);
  const r = { ...h, xp: h.xp + gain, wins: h.wins + 1 };
  let levelled = false;
  if (r.xp >= 20 * h.level) {
    levelled = true; r.xp -= 20 * h.level; r.level++;
    const g = E.GROWTH[h.cls]; r.hp += g.hp; r.atk += g.atk; r.def += g.def; r.spd += g.spd;
  }
  return { hero: r, levelled };
}

function draftFor({ h, g, t, moves, heroOut, levelled, drop, minted, kind, lane }) {
  const hU = heroU(h, A), gU = ghostU(g), tU = U(A.lock, 1000, nft('none', E.encodeTicket(t)));
  const inputs = [
    { utxo: lane, unlock: { type: 'contract', contract: game.lane, fn: 'forge', args: [E.packMoves(moves), BigInt(moves.length), drop ? 1n : 0n] } },
    signed(hU, A),
    { utxo: gU, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } },
    signed(tU, A),
  ];
  const outputs = [
    O(lane.lockingBytecode, lane.satoshis, lane.token),
    O(A.lock, 1000, nft('none', E.encodeHero(heroOut))),
    O(game.arenaLock, 1000, nft('none', E.encodeGhost({ ...g, beaten: E.bump(g.beaten) }))),
    O(game.treasuryLock, game.params.forgeFee),
  ];
  if (levelled) {
    const own = ghostU(E.ghostOf(h, A.pkh, 1, 2));
    inputs.push({ utxo: own, unlock: { type: 'contract', contract: game.arena, fn: 'fight', args: [] } });
    outputs.push(O(game.arenaLock, 1000, nft('none', E.encodeGhost({ ...E.ghostOf(heroOut, A.pkh), beaten: 1, defences: 2 }))));
  }
  if (drop) {
    inputs.push({ utxo: counterU(minted), unlock: { type: 'contract', contract: game.counter, fn: 'tick', args: [] } });
    outputs.push(O(game.counterLock, 1000, nft('none', E.encodeCounter(minted + 1))));
    outputs.push(O(A.lock, 1000, nft('none', E.encodeGear({ id: minted, kind, tier: t.level - h.level }))));
  }
  return { kind: 'forge', inputs, outputs };
}

test(`parity: sim and covenant agree on ${N} random full forges`, () => {
  let agree = 0, wins = 0, lv = 0, drops = 0, maxPct = 0;
  const diffs = [];
  for (let k = 0; k < N; k++) {
    const h = { id: rnd(1, 1e6), cls: rnd(0, 2), level: rnd(1, 20), xp: 0, hp: rnd(30, 300), atk: rnd(5, 60), def: rnd(2, 50), spd: rnd(1, 40), wins: rnd(0, 1000) };
    h.xp = rnd(0, 20 * h.level - 1);
    const pre = { id: h.id + 1, cls: rnd(0, 2), level: rnd(1, 30), hp: rnd(30, 300), atk: rnd(5, 60), def: rnd(2, 50), spd: rnd(1, 40), ownerPkh: X.pkh, beaten: rnd(0, 40), defences: rnd(0, 999) };
    const t = E.ticketFor(h.id, pre);
    const g = { ...pre, defences: pre.defences + 1, beaten: pre.beaten + rnd(0, 2) }; // live ghost after the challenge (maybe beaten since)
    const sh = E.ticketSeedHash(t), seed = E.seedOf(sh);
    let moves = k % 2 === 0 ? E.solve(h, t, seed) : null;
    if (!moves) moves = Array.from({ length: rnd(1, 12) }, () => rnd(0, 2));
    const d = E.duel(h, t, seed, moves);
    moves = moves.slice(0, Math.max(1, d.rounds));
    const sim = E.forgeOutcome(h, t, g.beaten, moves);
    const c = sim.valid ? { hero: sim.hero, levelled: sim.levelled } : claimed(h, t, g.beaten, d.hHp, moves.length);
    const drop = t.level >= h.level + 3;
    const minted = rnd(0, 2);
    const args = { h, g, t, moves, heroOut: c.hero, levelled: c.levelled, drop, minted, kind: E.gearKindOf(sh), lane: lanes[k % 16] };
    const res = run(draftFor(args), A);
    let strict = true;
    if (sim.valid) {
      wins++; if (sim.levelled) lv++; if (drop) drops++;
      strict = !run(draftFor({ ...args, heroOut: { ...c.hero, xp: c.hero.xp + 1 } }), A).ok;
      maxPct = Math.max(maxPct, 100 * res.metrics[0].op / res.metrics[0].budget);
    }
    // a loss must fail in the lane's replay (input 0), not for some incidental reason
    const laneFail = sim.valid || /input index 0:/.test(res.err);
    if (res.ok === sim.valid && strict && laneFail) agree++;
    else diffs.push(`duel ${k}: sim ${sim.valid} covenant ${res.ok} strict ${strict} ${res.err.slice(0, 100)}`);
  }
  console.log(`# parity ${agree}/${N} (${wins} wins: ${lv} level ups, ${drops} gear drops; ${N - wins} losses rejected); max lane budget ${maxPct.toFixed(1)}%`);
  assert.deepEqual(diffs, []);
  assert.ok(wins >= N / 4, `enough wins exercised (${wins})`);
});
