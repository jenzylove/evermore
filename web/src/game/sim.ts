// Evermore duel rules. Copied from contracts/spike-ref/sim.ts (must match Lane.cash move for move)
// with the SPEC seed change: seed = hash256(heroId4 || ghostId4 || beaten4 || defences4), read before the challenge.
import { sha256 } from '@noble/hashes/sha2';

export type Hero = { id: number; cls: number; level: number; xp: number; hp: number; atk: number; def: number; spd: number; wins: number };
export type Ghost = { id: number; cls: number; level: number; hp: number; atk: number; def: number; spd: number; ownerPkh: Uint8Array; beaten: number; defences: number };

export const KNIGHT = 0, ROGUE = 1, MAGE = 2;
export const CLASS_NAMES = ['Knight', 'Rogue', 'Mage'] as const;

export const le = (v: number, n: number): number[] => {
  if (v < 0 || v >= 2 ** (8 * n - 1)) throw new Error(`field out of range ${v} in ${n} bytes`);
  const out: number[] = [];
  for (let i = 0; i < n; i++) { out.push(v & 0xff); v = Math.floor(v / 256); }
  return out;
};

export const STARTER = [
  { hp: 60, atk: 10, def: 8, spd: 4 }, // Knight
  { hp: 45, atk: 12, def: 5, spd: 9 }, // Rogue
  { hp: 40, atk: 15, def: 4, spd: 6 }, // Mage
];
export const starterHero = (id: number, cls: number): Hero => ({ id, cls, level: 1, xp: 0, ...STARTER[cls], wins: 0 });
export const ghostOf = (h: Hero, ownerPkh: Uint8Array, beaten = 0, defences = 0): Ghost =>
  ({ id: h.id, cls: h.cls, level: h.level, hp: h.hp, atk: h.atk, def: h.def, spd: h.spd, ownerPkh, beaten, defences });

export const STRIKE = 0, GUARD = 1, SPECIAL = 2;
export type Move = 0 | 1 | 2;

export const hash256 = (b: Uint8Array) => sha256(sha256(b));
/** SPEC seed: no txid term, so the style is knowable before paying; every new try is a paid challenge. */
export const styleHash = (heroId: number, g: { id: number; beaten: number; defences: number }) =>
  hash256(Uint8Array.from([...le(heroId, 4), ...le(g.id, 4), ...le(g.beaten, 4), ...le(g.defences, 4)]));
export const seedOf = (h: Uint8Array) => h[0] + h[1] * 256 + h[2] * 65536;
export const gearKindOf = (h: Uint8Array) => h[3] % 3;
export const packMoves = (m: number[]) => m.reduceRight((acc, x) => acc * 4n + BigInt(x), 0n);

/** The ghost's 12 moves for a given seed (2 bits each, 3 reads as Strike). */
export const ghostMoves = (seed: number): Move[] => {
  const out: Move[] = []; let s = seed;
  for (let i = 0; i < 12; i++) { let gm = s % 4; s = Math.floor(s / 4); if (gm === 3) gm = STRIKE; out.push(gm as Move); }
  return out;
};

const tdiv = (a: number, b: number) => Math.trunc(a / b);
const hit = (atk: number, def: number, mult: number, guards: boolean) => {
  let d = Math.max(1, atk * mult - tdiv(def, 2));
  if (guards) d = tdiv(d, 2);
  return d;
};

export function duel(h: Hero, g: Ghost, seed: number, moves: number[]) {
  let hHp = h.hp, gHp = g.hp, hCh = 0, gCh = 0, s = seed, rounds = 0;
  for (const hm of moves) {
    if (hHp <= 0 || gHp <= 0) break;
    let gm = s % 4; s = Math.floor(s / 4); if (gm === 3) gm = STRIKE;
    const hG = hm === GUARD, gG = gm === GUARD;
    if (hG) hCh++;
    if (gG) gCh++;
    let hD = 0, gD = 0;
    if (hm === STRIKE) hD = hit(h.atk, g.def, 1, gG);
    if (hm === SPECIAL) { if (hCh >= 2) { hD = hit(h.atk, g.def, 2, gG); hCh = 0; } else hD = hit(h.atk, g.def, 1, gG); }
    if (gm === STRIKE) gD = hit(g.atk, h.def, 1, hG);
    if (gm === SPECIAL) { if (gCh >= 2) { gD = hit(g.atk, h.def, 2, hG); gCh = 0; } else gD = hit(g.atk, h.def, 1, hG); }
    if (h.spd >= g.spd) { gHp -= hD; if (gHp > 0) hHp -= gD; }
    else { hHp -= gD; if (hHp > 0) gHp -= hD; }
    rounds++;
  }
  return { won: gHp <= 0 && hHp > 0, hHp, gHp, rounds };
}

/** One acted beat in a round, for the animation. Derived from the same arithmetic as duel(). */
export type Beat = { who: 'hero' | 'ghost'; move: Move; special: boolean; dmg: number; blocked: boolean; targetHp: number };
export type RoundTrace = {
  round: number; heroMove: Move; ghostMove: Move; beats: Beat[];
  hHp: number; gHp: number; hCharge: number; gCharge: number;
};

/** Replays the whole move list and returns per round detail. Final hp always equals duel(). */
export function trace(h: Hero, g: Ghost, seed: number, moves: number[]): RoundTrace[] {
  let hHp = h.hp, gHp = g.hp, hCh = 0, gCh = 0, s = seed;
  const out: RoundTrace[] = [];
  for (const hm of moves) {
    if (hHp <= 0 || gHp <= 0) break;
    let gm = s % 4; s = Math.floor(s / 4); if (gm === 3) gm = STRIKE;
    const hG = hm === GUARD, gG = gm === GUARD;
    if (hG) hCh++;
    if (gG) gCh++;
    let hD = 0, gD = 0, hSp = false, gSp = false;
    if (hm === STRIKE) hD = hit(h.atk, g.def, 1, gG);
    if (hm === SPECIAL) { if (hCh >= 2) { hD = hit(h.atk, g.def, 2, gG); hCh = 0; hSp = true; } else hD = hit(h.atk, g.def, 1, gG); }
    if (gm === STRIKE) gD = hit(g.atk, h.def, 1, hG);
    if (gm === SPECIAL) { if (gCh >= 2) { gD = hit(g.atk, h.def, 2, hG); gCh = 0; gSp = true; } else gD = hit(g.atk, h.def, 1, hG); }
    const beats: Beat[] = [];
    const heroBeat = () => { if (hm !== GUARD) { gHp -= hD; beats.push({ who: 'hero', move: hm as Move, special: hSp, dmg: hD, blocked: gG, targetHp: gHp }); } };
    const ghostBeat = () => { if (gm !== GUARD) { hHp -= gD; beats.push({ who: 'ghost', move: gm as Move, special: gSp, dmg: gD, blocked: hG, targetHp: hHp }); } };
    if (h.spd >= g.spd) { heroBeat(); if (gHp > 0) ghostBeat(); }
    else { ghostBeat(); if (hHp > 0) heroBeat(); }
    out.push({ round: out.length + 1, heroMove: hm as Move, ghostMove: gm as Move, beats, hHp, gHp, hCharge: hCh, gCharge: gCh });
  }
  return out;
}

export const xpNeed = (level: number) => 20 * level;

/** ghost = the ticket snapshot (stats at challenge time) with the live beaten counter */
export function forgeHero(h: Hero, g: Ghost, hHp: number, n: number): { hero: Hero; levelled: boolean; gain: number } {
  const gain = tdiv((10 + 5 * g.level + tdiv(10 * hHp, h.hp) + 12 - n) * 4, 4 + g.beaten);
  const r = { ...h, xp: h.xp + gain, wins: h.wins + 1 };
  const need = xpNeed(h.level);
  let levelled = false;
  if (r.xp >= need && h.level < 127) {
    levelled = true; r.xp -= need; r.level++;
    if (h.cls === 0) { r.hp += 3; r.atk += 1; r.def += 2; }
    if (h.cls === 1) { r.hp += 2; r.atk += 2; r.spd += 2; }
    if (h.cls === 2) { r.hp += 1; r.atk += 3; r.def += 1; r.spd += 1; }
  }
  return { hero: r, levelled, gain };
}

/** Level a starter up n times by class growth (for practice wardens). */
export function grown(cls: number, level: number) {
  const s = { ...STARTER[cls] };
  for (let i = 1; i < level; i++) {
    if (cls === 0) { s.hp += 3; s.atk += 1; s.def += 2; }
    if (cls === 1) { s.hp += 2; s.atk += 2; s.spd += 2; }
    if (cls === 2) { s.hp += 1; s.atk += 3; s.def += 1; s.spd += 1; }
  }
  return s;
}

export const gearDrops = (heroLevel: number, ghostLevel: number) => ghostLevel >= heroLevel + 3;

export function solve(h: Hero, g: Ghost, seed: number, maxRounds = 12): number[] | null {
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

/**
 * Can a sensible player win this fight? Plays two plain styles a person would use, reading the echo's NEXT move:
 * "careful" (guard its strikes and charged Powers, strike its guards, Power when full) and "bold" (strike, Power when
 * full). Used to mark an echo Beatable and to pick opponents: an honest promise, unlike "some perfect line exists".
 */
export function humanWins(h: Hero, g: Ghost, seed: number): boolean {
  for (const careful of [true, false]) {
    const moves: number[] = [];
    let hCh = 0, gCh = 0, s = seed;
    for (let r = 0; r < 12; r++) {
      let gm = s % 4; s = Math.floor(s / 4); if (gm === 3) gm = STRIKE;
      const theirPower = gm === SPECIAL && gCh >= 2;
      let m: number;
      if (hCh >= 2 && !(careful && theirPower)) m = SPECIAL;
      else if (careful && (gm === STRIKE || gm === SPECIAL)) m = GUARD;
      else m = STRIKE;
      moves.push(m);
      if (m === GUARD) hCh++; if (m === SPECIAL && hCh >= 2) hCh = 0;
      if (gm === GUARD) gCh++; if (gm === SPECIAL && gCh >= 2) gCh = 0;
    }
    if (duel(h, g, seed, moves).won) return true;
  }
  return false;
}
