// Relic duel sim + encoders (S3 layouts). Must match Lane.cash move for move.
import { hash256 } from '@bitauth/libauth';

export type Hero = { id: number; cls: number; level: number; xp: number; hp: number; atk: number; def: number; spd: number; wins: number };
export type Ghost = { id: number; cls: number; level: number; hp: number; atk: number; def: number; spd: number; ownerPkh: Uint8Array; beaten: number; defences: number };

export const le = (v: number, n: number): number[] => {
  if (v < 0 || v >= 2 ** (8 * n - 1)) throw new Error(`field out of range ${v} in ${n} bytes`);
  const out: number[] = [];
  for (let i = 0; i < n; i++) { out.push(v & 0xff); v = Math.floor(v / 256); }
  return out;
};
const rd = (b: Uint8Array, s: number, e: number): number => { let v = 0; for (let i = e - 1; i >= s; i--) v = v * 256 + b[i]; return v; };

export const STARTER = [
  { hp: 60, atk: 10, def: 8, spd: 4 }, // Knight
  { hp: 45, atk: 12, def: 5, spd: 9 }, // Rogue
  { hp: 40, atk: 15, def: 4, spd: 6 }, // Mage
];
export const starterHero = (id: number, cls: number): Hero => ({ id, cls, level: 1, xp: 0, ...STARTER[cls], wins: 0 });
export const ghostOf = (h: Hero, ownerPkh: Uint8Array, beaten = 0, defences = 0): Ghost =>
  ({ id: h.id, cls: h.cls, level: h.level, hp: h.hp, atk: h.atk, def: h.def, spd: h.spd, ownerPkh, beaten, defences });

const stats = (x: { hp: number; atk: number; def: number; spd: number }) => [...le(x.hp, 2), ...le(x.atk, 2), ...le(x.def, 2), ...le(x.spd, 2)];
export const encodeLane = (lane: number, ctr: number) => Uint8Array.from([0x4c, ...le(lane, 1), ...le(ctr, 4)]);
export const encodeHero = (h: Hero) => Uint8Array.from([0x48, ...le(h.id, 4), ...le(h.cls, 1), ...le(h.level, 1), ...le(h.xp, 4), ...stats(h), ...le(h.wins, 4)]);
export const decodeHero = (b: Uint8Array): Hero => ({ id: rd(b, 1, 5), cls: b[5], level: b[6], xp: rd(b, 7, 11), hp: rd(b, 11, 13), atk: rd(b, 13, 15), def: rd(b, 15, 17), spd: rd(b, 17, 19), wins: rd(b, 19, 23) });
export const encodeGhost = (g: Ghost) => Uint8Array.from([0x47, ...le(g.id, 4), ...le(g.cls, 1), ...le(g.level, 1), ...stats(g), ...g.ownerPkh, ...le(g.beaten, 4), ...le(g.defences, 4)]);
export const decodeGhost = (b: Uint8Array): Ghost => ({ id: rd(b, 1, 5), cls: b[5], level: b[6], hp: rd(b, 7, 9), atk: rd(b, 9, 11), def: rd(b, 11, 13), spd: rd(b, 13, 15), ownerPkh: b.slice(15, 35), beaten: rd(b, 35, 39), defences: rd(b, 39, 43) });
// salt = the ghost's pre challenge outpoint tx hash, internal byte order (as introspection sees it)
export const encodeTicket = (heroId: number, g: Ghost, salt: Uint8Array) => Uint8Array.from([0x54, ...le(heroId, 4), ...le(g.id, 4), ...le(g.cls, 1), ...le(g.level, 1), ...stats(g), ...salt]);
export const encodeCounter = (minted: number) => Uint8Array.from([0x43, ...le(minted, 4)]);
export const encodeGear = (id: number, kind: number, tier: number) => Uint8Array.from([0x45, ...le(id, 4), ...le(kind, 1), ...le(tier, 1)]);

export const STRIKE = 0, GUARD = 1, SPECIAL = 2;
// seed: hash256(challengeTxid internal || salt); style = first 3 bytes LE, gear kind = byte 3 % 3
export const seedHash = (challengeTxidInternal: Uint8Array, salt: Uint8Array) => hash256(Uint8Array.from([...challengeTxidInternal, ...salt]));
export const seedOf = (h: Uint8Array) => h[0] + h[1] * 256 + h[2] * 65536;
export const gearKindOf = (h: Uint8Array) => h[3] % 3;
export const packMoves = (m: number[]) => m.reduceRight((acc, x) => acc * 4n + BigInt(x), 0n);

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

// ghost = the ticket snapshot (stats at challenge time) with the live beaten counter
export function forgeHero(h: Hero, g: Ghost, hHp: number, n: number): { hero: Hero; levelled: boolean } {
  const gain = tdiv((10 + 5 * g.level + tdiv(10 * hHp, h.hp) + 12 - n) * 4, 4 + g.beaten);
  const r = { ...h, xp: h.xp + gain, wins: h.wins + 1 };
  const need = 20 * h.level;
  let levelled = false;
  if (r.xp >= need) {
    levelled = true; r.xp -= need; r.level++;
    if (h.cls === 0) { r.hp += 3; r.atk += 1; r.def += 2; }
    if (h.cls === 1) { r.hp += 2; r.atk += 2; r.spd += 2; }
    if (h.cls === 2) { r.hp += 1; r.atk += 3; r.def += 1; r.spd += 1; }
  }
  return { hero: r, levelled };
}

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
