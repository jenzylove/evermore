// Evermore duel rules: the pure sim. The Lane covenant replays exactly this, move for move
// (parity tested in contracts/test). The web client imports it for play and preview.
import { hash256 } from '@bitauth/libauth';
import { le, COUNTER_MAX } from './codec.ts';
import type { Hero, Ghost, Ticket, Stats } from './codec.ts';

export const STRIKE = 0, GUARD = 1, SPECIAL = 2;
export const MOVE_NAMES = ['Strike', 'Guard', 'Special'] as const;
export const MAX_ROUNDS = 12;
export const LEVEL_CAP = 127;
export const GEAR_GAP = 3; // ghost level >= hero level + 3 drops gear

export const STARTER: readonly Stats[] = [
  { hp: 60, atk: 10, def: 8, spd: 4 }, // Knight
  { hp: 45, atk: 12, def: 5, spd: 9 }, // Rogue
  { hp: 40, atk: 15, def: 4, spd: 6 }, // Mage
];
export const GROWTH: readonly Stats[] = [
  { hp: 3, atk: 1, def: 2, spd: 0 },
  { hp: 2, atk: 2, def: 0, spd: 2 },
  { hp: 1, atk: 3, def: 1, spd: 1 },
];

export const starterHero = (id: number, cls: number): Hero => ({ id, cls, level: 1, xp: 0, ...STARTER[cls], wins: 0 });
export const ghostOf = (h: Hero, ownerPkh: Uint8Array, beaten = 0, defences = 0): Ghost =>
  ({ id: h.id, cls: h.cls, level: h.level, hp: h.hp, atk: h.atk, def: h.def, spd: h.spd, ownerPkh, beaten, defences });
export const xpToNext = (level: number) => 20 * level;
export const bump = (x: number) => Math.min(x + 1, COUNTER_MAX);

/** Style seed hash: hash256(heroId4 || ghostId4 || beaten2 || defences2), ghost read BEFORE the challenge. */
export const seedHash = (heroId: number, ghostId: number, beaten: number, defences: number): Uint8Array =>
  hash256(Uint8Array.from([...le(heroId, 4), ...le(ghostId, 4), ...le(beaten, 2), ...le(defences, 2)]));
export const ticketSeedHash = (t: Ticket) => seedHash(t.heroId, t.ghostId, t.beaten, t.defences);
/** 24 bit move seed: hash bytes 0..2 little endian. */
export const seedOf = (h: Uint8Array) => h[0] + h[1] * 256 + h[2] * 65536;
export const gearKindOf = (h: Uint8Array) => h[3] % 3;

/** The ghost's 12 moves for this hero (preview before paying; this is what a challenge locks in). */
export const ghostMoves = (seed: number): number[] => {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < MAX_ROUNDS; i++) { let m = s % 4; s = Math.floor(s / 4); if (m === 3) m = STRIKE; out.push(m); }
  return out;
};
export const previewStyle = (heroId: number, g: Ghost) => ghostMoves(seedOf(seedHash(heroId, g.id, g.beaten, g.defences)));

/** Moves packed 2 bits per round, round i in bits 2i..2i+1 (the covenant's `moves` argument). */
export const packMoves = (m: number[]): bigint => m.reduceRight((acc, x) => acc * 4n + BigInt(x), 0n);
export const unpackMoves = (packed: bigint, n: number): number[] =>
  Array.from({ length: n }, (_, i) => Number((packed >> BigInt(2 * i)) & 3n));

const tdiv = (a: number, b: number) => Math.trunc(a / b);
export const hit = (atk: number, def: number, mult: number, guards: boolean) => {
  let d = Math.max(1, atk * mult - tdiv(def, 2));
  if (guards) d = tdiv(d, 2);
  return d;
};

export type Round = { hm: number; gm: number; hDmg: number; gDmg: number; hHp: number; gHp: number; heroFirst: boolean };
export type DuelResult = { won: boolean; hHp: number; gHp: number; rounds: number; log: Round[] };

/** Play a duel. Stops at the first round that ends with either side at <= 0 HP. */
export function duel(h: Stats, g: Stats, seed: number, moves: number[]): DuelResult {
  let hHp = h.hp, gHp = g.hp, hCh = 0, gCh = 0, s = seed, rounds = 0;
  const log: Round[] = [];
  for (const hm of moves) {
    if (hHp <= 0 || gHp <= 0) break;
    if (hm !== STRIKE && hm !== GUARD && hm !== SPECIAL) throw new Error(`bad move ${hm}`);
    let gm = s % 4; s = Math.floor(s / 4); if (gm === 3) gm = STRIKE;
    const hG = hm === GUARD, gG = gm === GUARD;
    if (hG) hCh++;
    if (gG) gCh++;
    let hD = 0, gD = 0;
    if (hm === STRIKE) hD = hit(h.atk, g.def, 1, gG);
    if (hm === SPECIAL) { if (hCh >= 2) { hD = hit(h.atk, g.def, 2, gG); hCh = 0; } else hD = hit(h.atk, g.def, 1, gG); }
    if (gm === STRIKE) gD = hit(g.atk, h.def, 1, hG);
    if (gm === SPECIAL) { if (gCh >= 2) { gD = hit(g.atk, h.def, 2, hG); gCh = 0; } else gD = hit(g.atk, h.def, 1, hG); }
    const heroFirst = h.spd >= g.spd;
    let dealtH = 0, dealtG = 0;
    if (heroFirst) { gHp -= hD; dealtH = hD; if (gHp > 0) { hHp -= gD; dealtG = gD; } }
    else { hHp -= gD; dealtG = gD; if (hHp > 0) { gHp -= hD; dealtH = hD; } }
    rounds++;
    log.push({ hm, gm, hDmg: dealtH, gDmg: dealtG, hHp, gHp, heroFirst });
  }
  return { won: gHp <= 0 && hHp > 0, hHp, gHp, rounds, log };
}

export type ForgeResult = {
  valid: boolean;          // the covenant would accept these moves (won exactly at the last move, 1..12 rounds)
  duel: DuelResult;
  hero: Hero;              // the hero commitment the forge must write
  gain: number;
  levelled: boolean;
  dropEligible: boolean;   // ticket ghost level >= hero level + 3
  gearKind: number;
  gearTier: number;
};

/** Everything the forge path will compute, from the hero, the ticket and the LIVE ghost beaten counter. */
export function forgeOutcome(h: Hero, t: Ticket, liveBeaten: number, moves: number[]): ForgeResult {
  const sh = ticketSeedHash(t);
  const d = duel(h, t, seedOf(sh), moves);
  const valid = d.won && d.rounds === moves.length && moves.length >= 1 && moves.length <= MAX_ROUNDS;
  const n = moves.length;
  const gain = valid ? tdiv((10 + 5 * t.level + tdiv(10 * d.hHp, h.hp) + 12 - n) * 4, 4 + liveBeaten) : 0;
  const hero: Hero = { ...h, xp: h.xp + gain, wins: h.wins + (valid ? 1 : 0) };
  let levelled = false;
  if (valid && hero.xp >= xpToNext(h.level)) {
    levelled = true;
    hero.xp -= xpToNext(h.level);
    hero.level++;
    const gr = GROWTH[h.cls];
    hero.hp += gr.hp; hero.atk += gr.atk; hero.def += gr.def; hero.spd += gr.spd;
  }
  const ok = valid && hero.level <= LEVEL_CAP;
  return { valid: ok, duel: d, hero, gain, levelled, dropEligible: t.level >= h.level + GEAR_GAP, gearKind: gearKindOf(sh), gearTier: t.level - h.level };
}

/**
 * Find a shortest winning move list (or null). Depth first over Strike, Special, Guard,
 * pruning lines where the hero dies. Used by bots, tests and the "hint" button.
 */
export function solve(h: Stats, g: Stats, seed: number, maxRounds = MAX_ROUNDS): number[] | null {
  for (let len = 1; len <= maxRounds; len++) {
    const cur: number[] = [];
    const dfs = (): number[] | null => {
      if (cur.length === len) { const r = duel(h, g, seed, cur); return r.won && r.rounds === len ? [...cur] : null; }
      for (const m of [STRIKE, SPECIAL, GUARD]) {
        cur.push(m);
        const r = duel(h, g, seed, cur);
        if (r.rounds === cur.length && r.hHp > 0 && (r.gHp > 0 || cur.length === len)) { const x = dfs(); if (x) return x; }
        cur.pop();
      }
      return null;
    };
    const x = dfs(); if (x) return x;
  }
  return null;
}
