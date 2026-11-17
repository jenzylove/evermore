// Evermore commitment layouts. One category; byte 0 of every commitment is a type tag so one
// kind cannot pose as another. All integers little endian and below the sign bit (the VM
// reads them as script numbers). Every layout is <= 40 bytes so Selene can sign for any of
// them (it refuses longer commitments in source outputs). Must match contracts/src/Lane.cash.

export type Stats = { hp: number; atk: number; def: number; spd: number };
export type Hero = Stats & { id: number; cls: number; level: number; xp: number; wins: number };
export type Ghost = Stats & { id: number; cls: number; level: number; ownerPkh: Uint8Array; beaten: number; defences: number };
/** Ghost snapshot written into a ticket at challenge time (fight stats + seed counters). */
export type Ticket = Stats & { heroId: number; ghostId: number; cls: number; level: number; beaten: number; defences: number };
export type Gear = { id: number; kind: number; tier: number };
export type Lane = { lane: number; ctr: number };

export const TAG = { lane: 0x4c, hero: 0x48, ghost: 0x47, ticket: 0x54, counter: 0x43, gear: 0x45 } as const;
export const SIZE = { lane: 6, hero: 23, ghost: 39, ticket: 23, counter: 5, gear: 7 } as const;
/** Largest NFT commitment Selene (WizardConnect) will sign over. */
export const WALLET_MAX_COMMITMENT = 40;
/** beaten and defences are 2 bytes and saturate here (the covenant uses min(x + 1, 32767)). */
export const COUNTER_MAX = 32767;
export const CLASS_NAMES = ['Knight', 'Rogue', 'Mage'] as const;

export const le = (v: number, n: number): number[] => {
  if (!Number.isInteger(v) || v < 0 || v >= 2 ** (8 * n - 1)) throw new Error(`field out of range: ${v} in ${n} byte(s)`);
  const out: number[] = [];
  for (let i = 0; i < n; i++) { out.push(v & 0xff); v = Math.floor(v / 256); }
  return out;
};
export const rd = (b: Uint8Array, s: number, e: number): number => { let v = 0; for (let i = e - 1; i >= s; i--) v = v * 256 + b[i]; return v; };

const stats = (x: Stats) => [...le(x.hp, 2), ...le(x.atk, 2), ...le(x.def, 2), ...le(x.spd, 2)];
const need = (b: Uint8Array, tag: number, size: number, kind: string) => {
  if (b.length !== size || b[0] !== tag) throw new Error(`not a ${kind} commitment (${b.length} B, tag 0x${(b[0] ?? 0).toString(16)})`);
};

export const encodeLane = (l: Lane) => Uint8Array.from([TAG.lane, ...le(l.lane, 1), ...le(l.ctr, 4)]);
export const decodeLane = (b: Uint8Array): Lane => { need(b, TAG.lane, SIZE.lane, 'lane'); return { lane: b[1], ctr: rd(b, 2, 6) }; };

export const encodeHero = (h: Hero) => Uint8Array.from([TAG.hero, ...le(h.id, 4), ...le(h.cls, 1), ...le(h.level, 1), ...le(h.xp, 4), ...stats(h), ...le(h.wins, 4)]);
export const decodeHero = (b: Uint8Array): Hero => {
  need(b, TAG.hero, SIZE.hero, 'hero');
  return { id: rd(b, 1, 5), cls: b[5], level: b[6], xp: rd(b, 7, 11), hp: rd(b, 11, 13), atk: rd(b, 13, 15), def: rd(b, 15, 17), spd: rd(b, 17, 19), wins: rd(b, 19, 23) };
};

export const encodeGhost = (g: Ghost) => {
  if (g.ownerPkh.length !== 20) throw new Error('ghost owner must be a 20 byte pkh');
  return Uint8Array.from([TAG.ghost, ...le(g.id, 4), ...le(g.cls, 1), ...le(g.level, 1), ...stats(g), ...g.ownerPkh, ...le(g.beaten, 2), ...le(g.defences, 2)]);
};
export const decodeGhost = (b: Uint8Array): Ghost => {
  need(b, TAG.ghost, SIZE.ghost, 'ghost');
  return { id: rd(b, 1, 5), cls: b[5], level: b[6], hp: rd(b, 7, 9), atk: rd(b, 9, 11), def: rd(b, 11, 13), spd: rd(b, 13, 15), ownerPkh: b.slice(15, 35), beaten: rd(b, 35, 37), defences: rd(b, 37, 39) };
};

/** The ticket a challenge by `heroId` against ghost `g` (as read before the challenge) mints. */
export const ticketFor = (heroId: number, g: Ghost): Ticket =>
  ({ heroId, ghostId: g.id, cls: g.cls, level: g.level, hp: g.hp, atk: g.atk, def: g.def, spd: g.spd, beaten: g.beaten, defences: g.defences });
export const encodeTicket = (t: Ticket) => Uint8Array.from([TAG.ticket, ...le(t.heroId, 4), ...le(t.ghostId, 4), ...le(t.cls, 1), ...le(t.level, 1), ...stats(t), ...le(t.beaten, 2), ...le(t.defences, 2)]);
export const decodeTicket = (b: Uint8Array): Ticket => {
  need(b, TAG.ticket, SIZE.ticket, 'ticket');
  return { heroId: rd(b, 1, 5), ghostId: rd(b, 5, 9), cls: b[9], level: b[10], hp: rd(b, 11, 13), atk: rd(b, 13, 15), def: rd(b, 15, 17), spd: rd(b, 17, 19), beaten: rd(b, 19, 21), defences: rd(b, 21, 23) };
};

export const encodeCounter = (minted: number) => Uint8Array.from([TAG.counter, ...le(minted, 4)]);
export const decodeCounter = (b: Uint8Array): number => { need(b, TAG.counter, SIZE.counter, 'counter'); return rd(b, 1, 5); };

export const encodeGear = (g: Gear) => Uint8Array.from([TAG.gear, ...le(g.id, 4), ...le(g.kind, 1), ...le(g.tier, 1)]);
export const decodeGear = (b: Uint8Array): Gear => { need(b, TAG.gear, SIZE.gear, 'gear'); return { id: rd(b, 1, 5), kind: b[5], tier: b[6] }; };

export type Decoded =
  | { kind: 'lane'; value: Lane } | { kind: 'hero'; value: Hero } | { kind: 'ghost'; value: Ghost }
  | { kind: 'ticket'; value: Ticket } | { kind: 'counter'; value: number } | { kind: 'gear'; value: Gear } | { kind: 'unknown' };

/** Decode any game commitment by its tag; 'unknown' for anything malformed. */
export const decodeAny = (b: Uint8Array): Decoded => {
  try {
    switch (b[0]) {
      case TAG.lane: return { kind: 'lane', value: decodeLane(b) };
      case TAG.hero: return { kind: 'hero', value: decodeHero(b) };
      case TAG.ghost: return { kind: 'ghost', value: decodeGhost(b) };
      case TAG.ticket: return { kind: 'ticket', value: decodeTicket(b) };
      case TAG.counter: return { kind: 'counter', value: decodeCounter(b) };
      case TAG.gear: return { kind: 'gear', value: decodeGear(b) };
    }
  } catch { /* fall through */ }
  return { kind: 'unknown' };
};
