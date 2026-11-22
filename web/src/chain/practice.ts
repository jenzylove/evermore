// PracticeChain: the whole game in the browser with the real duel rules. Nothing touches a chain,
// every receipt has txid null, and the UI labels the mode as Practice everywhere.
import type { ClassId, Fees, ForgeResult, GameChain, GearView, GhostView, HeroView, Listing, Receipt, SatchelView, Ticket } from './types';
import { duel, forgeHero, gearDrops, grown, gearKindOf, seedOf, starterHero, styleHash, type Ghost, type Hero } from '../game/sim';

const KEY = 'evermore.practice.v1';
const NONE: Receipt = { txid: null, explorer: null };
const USD_PER_BCH = 450; // practice only, for showing amounts in cents
const cents = (c: number) => Math.round((c / 100 / USD_PER_BCH) * 1e8);

type Saved = {
  nextId: number;
  purse: number;
  heroes: (Hero & { name: string; defences: number; beaten: number; earned: number; where: HeroView['where'] })[];
  gear: GearView[];
  wardens: { id: number; cls: ClassId; level: number; beaten: number; defences: number; name: string; owner: string }[];
  listings: Listing[];
  gearMinted: number;
  tickets?: string[]; // open challenge tickets; a forge spends one
};

const WARDENS: [string, ClassId, number, string][] = [
  ['Bram', 0, 1, 'qz8f…3ka'], ['Vesk', 1, 1, 'qr2m…9td'], ['Ilsa', 2, 2, 'qp7c…u4e'],
  ['Corwin', 0, 3, 'qq0n…h2w'], ['Nyx', 1, 3, 'qzy5…8lp'], ['Orrin', 2, 4, 'qrk3…m0s'],
  ['Hale', 0, 5, 'qpe9…r7v'], ['Sable', 1, 6, 'qz4d…2xq'], ['Thorn', 0, 7, 'qq6h…k5c'],
  ['Wren', 2, 8, 'qra1…f9n'], ['Mordai', 1, 10, 'qp3s…w6j'], ['Aurel', 2, 12, 'qzm8…t1g'],
];

function fresh(): Saved {
  // Records are practice sandbox numbers, seeded from the name so they stay stable.
  const rec = (s: string, k: number) => [...s].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % k;
  return {
    nextId: 2000 + Math.floor(Math.random() * 7000),
    purse: cents(500),
    heroes: [], gear: [], gearMinted: 0,
    wardens: WARDENS.map(([name, cls, level, owner], i) => ({
      id: 100 + i * 7, cls, level, name, owner,
      beaten: rec(name, 4 + level * 2), defences: rec(name + 'd', 20 + level * 9),
    })),
    listings: [
      { id: 'ph', kind: 'hero', priceSats: cents(150), seller: 'qzy5…8lp', mine: false,
        hero: { id: 777, cls: 1, level: 4, xp: 12, wins: 9, name: 'Kestrel', ...grown(1, 4), defences: 21, beaten: 3, earnedSats: cents(42), where: 'listed' } },
      { id: 'p1', kind: 'gear', gear: { id: 9001, kind: 0, tier: 1, where: 'listed' }, priceSats: cents(40), seller: 'qq6h…k5c', mine: false },
      { id: 'p2', kind: 'gear', gear: { id: 9002, kind: 2, tier: 2, where: 'listed' }, priceSats: cents(95), seller: 'qra1…f9n', mine: false },
      { id: 'p3', kind: 'gear', gear: { id: 9003, kind: 1, tier: 1, where: 'listed' }, priceSats: cents(35), seller: 'qp3s…w6j', mine: false },
    ],
  };
}

export class PracticeChain implements GameChain {
  readonly mode = 'practice' as const;
  private s: Saved;

  constructor() {
    let s: Saved | null = null;
    try { const raw = localStorage.getItem(KEY); if (raw) s = JSON.parse(raw); } catch { /* storage blocked */ }
    this.s = s ?? fresh();
  }

  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* storage blocked */ } }
  // practice is free: nothing is ever deducted, so it never runs out
  private spend(_sats: number) { /* free */ }

  fees(): Fees { return { raiseSats: cents(25), challengeSats: cents(2), forgeSats: cents(1), usdPerBch: USD_PER_BCH }; }

  private heroView(h: Saved['heroes'][number]): HeroView {
    return { id: h.id, cls: h.cls as ClassId, level: h.level, xp: h.xp, wins: h.wins, hp: h.hp, atk: h.atk, def: h.def, spd: h.spd,
      name: h.name, defences: h.defences, beaten: h.beaten, earnedSats: h.earned, where: h.where };
  }

  async listGhosts(): Promise<GhostView[]> {
    const w: GhostView[] = this.s.wardens.map(x => ({ ...x, ...grown(x.cls, x.level), mine: false }));
    const mine: GhostView[] = this.s.heroes.map(h => ({ id: h.id, cls: h.cls as ClassId, level: h.level, hp: h.hp, atk: h.atk, def: h.def, spd: h.spd,
      beaten: h.beaten, defences: h.defences, name: h.name, owner: 'you', mine: true }));
    return [...w, ...mine].sort((a, b) => a.level - b.level);
  }
  async myHeroes() { return this.s.heroes.filter(h => h.where !== 'listed').map(h => this.heroView(h)); }
  async getHero(id: number) { const h = this.s.heroes.find(x => x.id === id); return h ? this.heroView(h) : null; }
  async myGear() { return this.s.gear.filter(g => g.where !== 'listed'); }

  async raise(cls: ClassId, name: string) {
    this.spend(this.fees().raiseSats);
    const h = { ...starterHero(this.s.nextId++, cls), name: name.trim() || 'Nameless', defences: 0, beaten: 0, earned: 0, where: 'satchel' as const };
    this.s.heroes.push(h); this.save();
    return { hero: this.heroView(h), receipt: NONE };
  }

  async challenge(heroId: number, ghostId: number): Promise<Ticket> {
    const g = (await this.listGhosts()).find(x => x.id === ghostId);
    if (!g) throw new Error('That ghost has left the arena.');
    if (g.mine) throw new Error('You cannot challenge your own hero.');
    this.spend(this.fees().challengeSats);
    const seed = seedOf(styleHash(heroId, g));
    const w = this.s.wardens.find(x => x.id === ghostId);
    if (w) w.defences++;
    (this.s.tickets ??= []).push(`${heroId}:${ghostId}:${seed}`);
    this.save();
    return { heroId, ghost: g, seed, receipt: NONE };
  }

  async forge(t: Ticket, moves: number[]): Promise<ForgeResult> {
    const h = this.s.heroes.find(x => x.id === t.heroId);
    if (!h) throw new Error('Hero not found.');
    const tk = `${t.heroId}:${t.ghost.id}:${t.seed}`;
    if (!this.s.tickets?.includes(tk)) throw new Error('That challenge was already forged.');
    const g: Ghost = { ...t.ghost, ownerPkh: new Uint8Array(20) };
    const r = duel(h, g, t.seed, moves);
    // Same check the covenant makes: the duel must be won, ending exactly on the last move.
    if (!r.won || r.rounds !== moves.length) throw new Error('That duel was not a win; the forge refuses it.');
    this.spend(this.fees().forgeSats);
    const w = this.s.wardens.find(x => x.id === t.ghost.id);
    const live = { ...g, beaten: w ? w.beaten : g.beaten };
    const { hero, levelled, gain } = forgeHero(h, live, r.hHp, r.rounds);
    Object.assign(h, hero);
    if (w) w.beaten++;
    this.s.tickets = this.s.tickets!.filter(x => x !== tk);
    let gear: GearView | null = null;
    if (gearDrops(h.level - (levelled ? 1 : 0), t.ghost.level) && this.s.gearMinted < 5000) {
      const kind = gearKindOf(styleHash(t.heroId, { id: t.ghost.id, beaten: t.ghost.beaten + 1, defences: t.ghost.defences })) as 0 | 1 | 2;
      gear = { id: 1 + this.s.gearMinted++, kind, tier: 1 + Math.min(2, Math.floor(t.ghost.level / 5)), where: 'satchel' };
      this.s.gear.push(gear);
    }
    this.save();
    return { receipt: NONE, hero: this.heroView(h), xpGain: gain, levelled, gear };
  }

  async listings() { return this.s.listings; }
  hasPusd() { return true; }
  async list(kind: 'hero' | 'gear', id: number, priceSats: number, pusdCents?: number): Promise<Receipt> {
    if (kind === 'hero') {
      const h = this.s.heroes.find(x => x.id === id); if (!h) throw new Error('Hero not found.');
      h.where = 'listed';
      this.s.listings.push({ id: 'm' + id, kind, hero: this.heroView(h), priceSats, pusdCents, seller: 'you', mine: true });
    } else {
      const g = this.s.gear.find(x => x.id === id); if (!g) throw new Error('Gear not found.');
      g.where = 'listed';
      this.s.listings.push({ id: 'g' + id, kind, gear: g, priceSats, pusdCents, seller: 'you', mine: true });
    }
    this.save(); return NONE;
  }
  async buy(listingId: string): Promise<Receipt> {
    const l = this.s.listings.find(x => x.id === listingId); if (!l) throw new Error('Already sold.');
    if (l.mine) return this.cancel(listingId);
    this.spend(l.priceSats);
    if (l.hero) this.s.heroes.push({ ...l.hero, earned: l.hero.earnedSats, where: 'satchel' });
    if (l.gear) this.s.gear.push({ ...l.gear, where: 'satchel' });
    this.s.listings = this.s.listings.filter(x => x !== l); this.save(); return NONE;
  }
  async cancel(listingId: string): Promise<Receipt> {
    const l = this.s.listings.find(x => x.id === listingId); if (!l || !l.mine) throw new Error('Not your listing.');
    if (l.hero) { const h = this.s.heroes.find(x => x.id === l.hero!.id); if (h) h.where = 'satchel'; }
    if (l.gear) { const g = this.s.gear.find(x => x.id === l.gear!.id); if (g) g.where = 'satchel'; }
    this.s.listings = this.s.listings.filter(x => x !== l); this.save(); return NONE;
  }
  async sendHome(heroId: number): Promise<Receipt> {
    const h = this.s.heroes.find(x => x.id === heroId); if (!h) throw new Error('Hero not found.');
    h.where = h.where === 'home' ? 'satchel' : 'home'; this.save(); return NONE;
  }
  async satchel(): Promise<SatchelView> { return { sats: this.s.purse, address: null, connected: null }; }
  async fund(sats: number): Promise<Receipt> { this.s.purse += sats; this.save(); return NONE; }
  async exportKey() { return null; }

  reset() { this.s = fresh(); this.save(); }
}
