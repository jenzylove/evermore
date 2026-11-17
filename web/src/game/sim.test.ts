// Checks: trace() agrees with duel() on every random duel; solve() finds winning lines that duel() accepts.
import { duel, trace, solve, starterHero, ghostOf, grown, styleHash, seedOf, ghostMoves } from './sim.ts';
let n = 0, bad = 0;
const rnd = (k: number) => Math.floor(Math.random() * k);
for (let i = 0; i < 3000; i++) {
  const h = { ...starterHero(rnd(1e6), rnd(3)) };
  const gc = rnd(3), gl = 1 + rnd(8);
  const g = ghostOf({ ...starterHero(rnd(1e6), gc), level: gl, ...grown(gc, gl) }, new Uint8Array(20), rnd(9), rnd(50));
  const seed = seedOf(styleHash(h.id, g));
  const moves = Array.from({ length: 1 + rnd(12) }, () => rnd(3));
  const d = duel(h, g, seed, moves), t = trace(h, g, seed, moves);
  const last = t[t.length - 1];
  n++;
  if (t.length !== d.rounds || last.hHp !== d.hHp || last.gHp !== d.gHp) bad++;
  t.forEach((r, k) => { if (r.ghostMove !== ghostMoves(seed)[k]) bad++; });
  const s = i < 40 && gl < 4 ? solve(h, g, seed, 8) : null;
  if (s) { const r = duel(h, g, seed, s); if (!r.won || r.rounds !== s.length) bad++; }
}
console.log(`${n} duels, ${bad} mismatches`);
if (bad) throw new Error("sim mismatch");
