// RealChain: the game on Bitcoin Cash (chipnet or mainnet) through @evermore/sdk.
// Every read comes from public Fulcrum nodes; every write is a transaction the sdk builds and
// the covenants check. Receipts always carry the real txid and an explorer link.
//
// Runs in the browser and in Node 24 (type stripping), so imports carry explicit .ts paths and
// nothing here touches the DOM: storage, the Satchel and the home wallet are passed in.
import * as E from '../../../sdk/src/index.ts';
import type { Built, Draft, Utxo, WalletKey, Deployment, NetworkName } from '../../../sdk/src/index.ts';
import { binToHex } from '@bitauth/libauth';
import type {
  ClassId, Fees, ForgeResult, GameChain, GearView, GhostView, HeroView, Listing, Receipt, SatchelView, Ticket,
} from './types.ts';

/** Key/value storage (localStorage in the browser, a Map in tests). */
export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/**
 * The player's own wallet (Selene / Cashonize through WizardConnect, or a test key).
 * `keys` lists the addresses we know about (derived from the shared xpubs); `sign` is present
 * only while a live session can sign. A remembered wallet without a session can still be read
 * (heroes at home) and receive heroes sent home.
 */
export interface HomeWallet {
  readonly name: string;
  readonly net: NetworkName;
  keys(): WalletKey[];
  /** where heroes sent home go (receive 0) */
  receiveLock(): Uint8Array;
  /** where the wallet's change goes */
  changeLock(): Uint8Array;
  /** sign the wallet inputs of `built` and return the full signed hex; absent when not connected live */
  sign?: (built: Built, prompt: string) => Promise<string>;
}

export type RealChainOptions = {
  deployment: Deployment & { authhead?: { txid: string; vout: number } };
  net: NetworkName;
  satchel: E.Satchel;
  storage: KV;
  wallet?: HomeWallet | null;
  /** public labels for house heroes (wardens), id -> name; the player's own names win */
  labels?: Record<string, string>;
  /** USD per BCH for showing amounts; null keeps the last known value */
  price?: () => Promise<number | null>;
  /** test hook: log every broadcast */
  onBroadcast?: (kind: string, txid: string, link: string) => void;
};

const CACHE_MS = 4000;
const short = (a: string) => { const s = a.replace(/^[a-z]+:/, ''); return `${s.slice(0, 4)}…${s.slice(-3)}`; };
const hex = (b: Uint8Array) => binToHex(b);
const CLASS = ['Knight', 'Rogue', 'Mage'];

export class RealChain implements GameChain {
  readonly mode: 'chipnet' | 'mainnet';
  readonly net: NetworkName;
  readonly game: E.Game;
  readonly chain: E.Chain;
  readonly satchelKey: E.Satchel;
  wallet: HomeWallet | null;
  private kv: KV;
  private labels: Record<string, string>;
  private authhead: { txid: string; vout: number } | null;
  private usd = 0;
  private price?: RealChainOptions['price'];
  private onBroadcast?: RealChainOptions['onBroadcast'];
  private cache = new Map<string, { at: number; v: Promise<unknown> }>();
  private queue: Promise<unknown> = Promise.resolve();
  /** tickets made in this session, by heroId:ghostId:seed (0 conf chaining before Fulcrum indexes them) */
  private tickets = new Map<string, Utxo>();

  constructor(o: RealChainOptions) {
    this.net = o.net;
    this.mode = o.net;
    if (o.deployment.network !== o.net) throw new Error(`deployment is for ${o.deployment.network}, not ${o.net}`);
    this.game = E.gameFromDeployment(o.deployment);
    this.chain = new E.Chain(o.net);
    this.satchelKey = o.satchel;
    this.kv = o.storage;
    this.labels = o.labels ?? {};
    this.authhead = o.deployment.authhead ?? null;
    this.wallet = o.wallet ?? null;
    this.price = o.price;
    this.onBroadcast = o.onBroadcast;
    const saved = Number(this.kv.getItem('evermore.usdPerBch') ?? '0');
    if (saved > 0) this.usd = saved;
    void this.refreshPrice();
  }

  async refreshPrice() {
    try {
      const p = await this.price?.();
      if (p && p > 0) { this.usd = p; this.kv.setItem('evermore.usdPerBch', String(p)); }
    } catch { /* keep last */ }
  }

  // ------------------------------------------------------------------ names (kept in this browser)
  private names(): Record<string, string> {
    try { return { ...this.labels, ...JSON.parse(this.kv.getItem(`evermore.names.${this.net}`) ?? '{}') }; } catch { return { ...this.labels }; }
  }
  private setName(id: number, name: string) {
    let n: Record<string, string> = {};
    try { n = JSON.parse(this.kv.getItem(`evermore.names.${this.net}`) ?? '{}'); } catch { /* start fresh */ }
    n[id] = name; this.kv.setItem(`evermore.names.${this.net}`, JSON.stringify(n));
  }
  /** Names are a local label only (the commitment has no room for one); others see the class and id. */
  nameOf(id: number, cls: number) { return this.names()[id] ?? `${CLASS[cls] ?? 'Hero'} #${id}`; }

  // ------------------------------------------------------------------ reads (short cache)
  private cached<T>(key: string, f: () => Promise<T>, ms = CACHE_MS): Promise<T> {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < ms) return c.v as Promise<T>;
    const v = f();
    this.cache.set(key, { at: Date.now(), v });
    v.catch(() => this.cache.delete(key));
    return v;
  }
  private invalidate() { this.cache.clear(); }
  private ghostsRaw() { return this.cached('ghosts', () => this.chain.ghosts(this.game)); }
  private holdings(lock: Uint8Array) { return this.cached(`h:${hex(lock)}`, () => this.chain.holdings(this.game, lock)); }
  private listingsRaw() { return this.cached('listings', () => this.chain.listings(this.game), 15000); }
  /** Plain coins in the Satchel. */
  private async satchelCoins() { return (await this.chain.coins(this.satchelKey.lock)).filter((c) => !this.isAuthhead(c)); }
  private isAuthhead(c: Utxo) { const a = this.authhead; return !!a && c.txid === a.txid && c.vout === a.vout; }

  private homeLocks(): Uint8Array[] {
    if (!this.wallet) return [];
    const seen = new Set<string>(); const out: Uint8Array[] = [];
    for (const k of this.wallet.keys()) { const h = hex(k.lock); if (!seen.has(h)) { seen.add(h); out.push(k.lock); } }
    return out;
  }
  private async homeHoldings() {
    const locks = this.homeLocks();
    if (!locks.length) return [];
    return this.cached('home', async () => Promise.all(locks.map(async (lock) => ({ lock, h: await this.chain.holdings(this.game, lock) }))), 20000);
  }
  private myPkhs(): Set<string> {
    return new Set([hex(this.satchelKey.pkh), ...this.homeLocks().map((l) => hex(l.slice(3, 23)))]);
  }

  fees(): Fees {
    const p = this.game.params;
    return {
      // what leaves the Satchel to raise: the price plus the 1,000 sats each of hero and ghost carry
      raiseSats: Number(p.raisePrice + 2n * E.TOKEN_SATS),
      challengeSats: Number(p.challengeFee),
      forgeSats: Number(p.forgeFee),
      usdPerBch: this.usd,
    };
  }

  private ghostView(g: E.Ghost, mineIds: Set<number>): GhostView {
    const ownerAddr = E.lockToAddress(E.p2pkhLock(g.ownerPkh), this.game.cfg.prefix);
    const mine = mineIds.has(g.id) || this.myPkhs().has(hex(g.ownerPkh));
    return {
      id: g.id, cls: g.cls as ClassId, level: g.level, hp: g.hp, atk: g.atk, def: g.def, spd: g.spd,
      beaten: g.beaten, defences: g.defences, name: this.nameOf(g.id, g.cls), owner: mine ? 'you' : short(ownerAddr), mine,
    };
  }
  private heroView(h: E.Hero, where: HeroView['where'], ghost: E.Ghost | undefined): HeroView {
    // earnings: each defence paid exactly challengeFee to the ghost's owner (the covenant enforces it);
    // only counted when that owner is one of this player's keys
    const ownGhost = ghost && this.myPkhs().has(hex(ghost.ownerPkh));
    return {
      id: h.id, cls: h.cls as ClassId, level: h.level, xp: h.xp, wins: h.wins, hp: h.hp, atk: h.atk, def: h.def, spd: h.spd,
      name: this.nameOf(h.id, h.cls), defences: ghost?.defences ?? 0, beaten: ghost?.beaten ?? 0,
      earnedSats: ownGhost ? ghost!.defences * Number(this.game.params.challengeFee) : 0, where,
    };
  }

  async listGhosts(): Promise<GhostView[]> {
    const [gs, mine] = await Promise.all([this.ghostsRaw(), this.myHeroIds()]);
    return gs.map((x) => this.ghostView(x.ghost, mine)).sort((a, b) => a.level - b.level || a.id - b.id);
  }
  private async myHeroIds() {
    const s = await this.holdings(this.satchelKey.lock);
    const ids = new Set(s.heroes.map((x) => x.hero.id));
    for (const x of await this.homeHoldings()) x.h.heroes.forEach((y) => ids.add(y.hero.id));
    return ids;
  }

  /** Heroes in the Satchel and at home (listed heroes show in the Bazaar). */
  async myHeroes(): Promise<HeroView[]> {
    const [s, home, gs] = await Promise.all([this.holdings(this.satchelKey.lock), this.homeHoldings(), this.ghostsRaw()]);
    const ghost = (id: number) => gs.find((g) => g.ghost.id === id)?.ghost;
    return [
      ...s.heroes.map((x) => this.heroView(x.hero, 'satchel', ghost(x.hero.id))),
      ...home.flatMap((w) => w.h.heroes.map((x) => this.heroView(x.hero, 'home', ghost(x.hero.id)))),
    ];
  }
  async getHero(id: number): Promise<HeroView | null> {
    const mine = (await this.myHeroes()).find((h) => h.id === id);
    if (mine) return mine;
    const l = (await this.listings()).find((x) => x.hero?.id === id);
    if (l?.hero) return l.hero;
    const found = await this.chain.heroById(this.game, id);
    return found ? this.heroView(found.hero, 'home', found.ghost?.ghost) : null;
  }
  async myGear(): Promise<GearView[]> {
    const [s, home] = await Promise.all([this.holdings(this.satchelKey.lock), this.homeHoldings()]);
    const v = (g: E.Gear, where: GearView['where']): GearView => ({ id: g.id, kind: g.kind as 0 | 1 | 2, tier: g.tier, where });
    return [...s.gear.map((x) => v(x.gear, 'satchel')), ...home.flatMap((w) => w.h.gear.map((x) => v(x.gear, 'home')))];
  }

  // ------------------------------------------------------------------ writes
  /** One write at a time: they share the Satchel's coins. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f, f);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private receipt(txid: string): Receipt { return { txid, explorer: this.game.cfg.explorerTx(txid) }; }
  private done(kind: string, txid: string) {
    this.invalidate();
    this.onBroadcast?.(kind, txid, this.game.cfg.explorerTx(txid));
  }
  private async fundAndFinalize(draft: Draft): Promise<Built> {
    try {
      return E.finalize(draft, { funding: this.satchelKey.inputs(await this.satchelCoins()), changeLock: this.satchelKey.lock, feeRate: this.game.cfg.feeRate });
    } catch (e) {
      if (e instanceof E.InsufficientFunds) throw new Error(`Your Satchel is short by ${e.needed} sats. Add funds from your wallet.`);
      throw e;
    }
  }
  /** Lane transaction with retry on a lane / ghost / counter conflict (a fresh random lane each try). */
  private async laneTx(kind: string, make: (lane: Utxo) => Promise<Draft>) {
    const avoid: number[] = [];
    const r = await this.chain.submit(async () => {
      const lanes = await this.chain.lanes(this.game);
      const l = E.pickLane(lanes, avoid);
      avoid.push(l.lane.lane);
      this.invalidate();
      return this.fundAndFinalize(await make(l.utxo));
    });
    this.done(kind, r.txid);
    return r;
  }
  private async satchelHero(id: number) {
    const x = (await this.chain.holdings(this.game, this.satchelKey.lock)).heroes.find((y) => y.hero.id === id);
    if (!x) throw new Error('That hero is not in your Satchel.');
    return x;
  }

  raise(cls: ClassId, name: string) {
    return this.serial(async () => {
      const r = await this.laneTx('raise', async (lane) => E.raiseDraft(this.game, lane, cls, this.satchelKey.lock).draft);
      const hero = E.decodeHero(r.built.outputs[1].token!.nft!.commitment);
      const nm = name.trim().slice(0, 24);
      if (nm) this.setName(hero.id, nm);
      const ghost = E.decodeGhost(r.built.outputs[2].token!.nft!.commitment);
      return { hero: this.heroView(hero, 'satchel', ghost), receipt: this.receipt(r.txid) };
    });
  }

  challenge(heroId: number, ghostId: number): Promise<Ticket> {
    return this.serial(async () => {
      await this.satchelHero(heroId);
      const r = await this.laneTx('challenge', async (lane) => {
        const g = await this.chain.ghost(this.game, ghostId);
        if (!g) throw new Error('That ghost has left the Arena.');
        const d = E.challengeDraft(this.game, lane, g.utxo, heroId, this.satchelKey.lock).draft;
        // auto sweep: a new challenge means every older ticket is from a lost or abandoned duel
        // (the client plays one duel at a time); burn them here and get their sats back
        d.inputs.push(...this.satchelKey.inputs(await this.staleTickets()));
        return d;
      });
      const t = E.decodeTicket(r.built.outputs[3].token!.nft!.commitment);
      const seed = E.seedOf(E.ticketSeedHash(t));
      this.tickets.clear(); // older tickets were burned in this challenge
      this.tickets.set(`${heroId}:${ghostId}:${seed}`, E.utxoOf({ txid: r.txid, outputs: r.built.outputs }, 3));
      const snap = E.decodeGhost(r.built.inputs[1].utxo.token!.nft!.commitment); // the ghost as read before the challenge
      return { heroId, ghost: this.ghostView(snap, new Set()), seed, receipt: this.receipt(r.txid) };
    });
  }

  /** Tickets in the Satchel (all of them are stale once a new challenge starts). */
  private async staleTickets(): Promise<Utxo[]> {
    return (await this.chain.holdings(this.game, this.satchelKey.lock)).tickets.map((x) => x.utxo);
  }
  /** Burn every ticket in the Satchel (lost or abandoned duels) and keep their sats. Null when there are none. */
  reclaimTickets(): Promise<Receipt | null> {
    return this.serial(async () => {
      const ts = await this.staleTickets();
      if (!ts.length) return null;
      const built = await this.fundAndFinalize(E.reclaimDraft(this.game, this.satchelKey.inputs(ts)));
      const txid = await this.chain.broadcast(built.hex);
      this.tickets.clear();
      this.done('reclaim', txid);
      return this.receipt(txid);
    });
  }
  /**
   * Fees follow the owner: point hero `heroId`'s ghost at the P2PKH now holding it (Satchel
   * signed). Skipped when the ghost already pays there. Best effort after a buy or bring back:
   * the move itself already succeeded, so a failure here is logged, not thrown.
   */
  private async syncNow(heroId: number, heroUtxo?: Utxo): Promise<string | null> {
    try {
      const h = heroUtxo ?? (await this.satchelHero(heroId)).utxo;
      const first = await this.chain.ghost(this.game, heroId);
      if (!first || E.ghostPays(first.utxo, h.lockingBytecode)) return null;
      const r = await this.laneTx('sync', async (lane) => {
        const g = await this.chain.ghost(this.game, heroId);
        if (!g) throw new Error('ghost not found');
        return E.syncDraft(this.game, { lane, hero: this.satchelKey.inputs([h])[0], ownGhost: g.utxo }).draft;
      });
      return r.txid;
    } catch (e) {
      console.warn(`sync of hero ${heroId} failed (fees still go to the previous owner until the next level up): ${String((e as Error)?.message ?? e)}`);
      return null;
    }
  }

  private async findTicket(t: Ticket): Promise<Utxo> {
    const key = `${t.heroId}:${t.ghost.id}:${t.seed}`;
    const s = await this.chain.holdings(this.game, this.satchelKey.lock);
    const onChain = s.tickets.find((x) => x.ticket.heroId === t.heroId && x.ticket.ghostId === t.ghost.id
      && E.seedOf(E.ticketSeedHash(x.ticket)) === t.seed);
    if (onChain) return onChain.utxo;
    const mem = this.tickets.get(key);
    if (mem) return mem;
    throw new Error('That challenge ticket is not in your Satchel (already forged?).');
  }

  forge(ticket: Ticket, moves: number[]): Promise<ForgeResult> {
    return this.serial(async () => {
      let res!: ReturnType<typeof E.forgeDraft>;
      let before!: E.Hero;
      const r = await this.laneTx('forge', async (lane) => {
        const h = await this.satchelHero(ticket.heroId);
        before = h.hero;
        const [g, own, counter, tk] = await Promise.all([
          this.chain.ghost(this.game, ticket.ghost.id), this.chain.ghost(this.game, ticket.heroId), this.chain.counter(this.game), this.findTicket(ticket),
        ]);
        if (!g) throw new Error('That ghost has left the Arena.');
        res = E.forgeDraft(this.game, {
          lane, hero: this.satchelKey.inputs([h.utxo])[0], ghost: g.utxo, ticket: this.satchelKey.inputs([tk])[0], moves,
          ownGhost: own?.utxo, counter: counter?.utxo,
        });
        return res.draft;
      });
      this.tickets.delete(`${ticket.heroId}:${ticket.ghost.id}:${ticket.seed}`);
      const out = r.built.outputs;
      const hero = E.decodeHero(out[1].token!.nft!.commitment);
      const oppGhostAfter = E.decodeGhost(out[2].token!.nft!.commitment);
      void oppGhostAfter;
      let gear: GearView | null = null;
      if (res.drop) {
        const gOut = out.find((o) => o.token?.nft?.commitment[0] === E.TAG.gear)!;
        const g = E.decodeGear(gOut.token!.nft!.commitment);
        gear = { id: g.id, kind: g.kind as 0 | 1 | 2, tier: g.tier, where: 'satchel' };
      }
      const ownGhost = (await this.ghostsRaw()).find((x) => x.ghost.id === hero.id)?.ghost;
      return { receipt: this.receipt(r.txid), hero: this.heroView(hero, 'satchel', ownGhost), xpGain: res.result.gain, levelled: res.result.levelled && hero.level > before.level, gear };
    });
  }

  // ------------------------------------------------------------------ bazaar
  private listingId(u: Utxo) { return `${u.txid}:${u.vout}`; }
  async listings(): Promise<Listing[]> {
    const [ls, gs] = await Promise.all([this.listingsRaw(), this.ghostsRaw()]);
    const me = hex(this.satchelKey.pkh);
    return ls.map((l) => {
      const mine = hex(l.sellerPkh) === me;
      const seller = mine ? 'you' : short(E.lockToAddress(E.p2pkhLock(l.sellerPkh), this.game.cfg.prefix));
      const base = l.currency === 'pusd'
        ? { id: this.listingId(l.utxo), priceSats: 0, pusdCents: Number(l.price), seller, mine }
        : { id: this.listingId(l.utxo), priceSats: Number(l.price), seller, mine };
      if (l.hero) return { ...base, kind: 'hero' as const, hero: this.heroView(l.hero, 'listed', gs.find((g) => g.ghost.id === l.hero!.id)?.ghost) };
      return { ...base, kind: 'gear' as const, gear: { id: l.gear!.id, kind: l.gear!.kind as 0 | 1 | 2, tier: l.gear!.tier, where: 'listed' as const } };
    });
  }
  private async rawListing(id: string) {
    this.cache.delete('listings');
    const l = (await this.listingsRaw()).find((x) => this.listingId(x.utxo) === id);
    if (!l) throw new Error('That listing is gone (sold or cancelled).');
    return l;
  }

  hasPusd() { return !!this.game.pusdCategory; }
  /** plain PUSD in the play key */
  private async satchelPusd() {
    const cat = this.game.pusdCategory;
    if (!cat) return [];
    return (await this.chain.utxos(this.satchelKey.lock)).filter((u) => u.token && !u.token.nft && hex(u.token.category) === cat);
  }
  list(kind: 'hero' | 'gear', id: number, priceSats: number, pusdCents?: number): Promise<Receipt> {
    return this.serial(async () => {
      const s = await this.chain.holdings(this.game, this.satchelKey.lock);
      const u = kind === 'hero' ? s.heroes.find((x) => x.hero.id === id)?.utxo : s.gear.find((x) => x.gear.id === id)?.utxo;
      if (!u) throw new Error(`That ${kind} is not in your Satchel.`);
      const { draft } = pusdCents
        ? E.listDraft(this.game, this.satchelKey.inputs([u])[0], this.satchelKey.pkh, BigInt(Math.round(pusdCents)), 'pusd')
        : E.listDraft(this.game, this.satchelKey.inputs([u])[0], this.satchelKey.pkh, BigInt(Math.round(priceSats)));
      const built = await this.fundAndFinalize(draft);
      const txid = await this.chain.broadcast(built.hex);
      this.done('list', txid);
      return this.receipt(txid);
    });
  }
  buy(listingId: string): Promise<Receipt> {
    return this.serial(async () => {
      const l = await this.rawListing(listingId);
      if (hex(l.sellerPkh) === hex(this.satchelKey.pkh)) return this.cancelNow(l);
      let pusd: E.Input[] = [];
      if (l.currency === 'pusd') {
        const have = await this.satchelPusd();
        const sum = have.reduce((a, u) => a + (u.token!.amount ?? 0n), 0n);
        if (sum < l.price) throw new Error(`This one costs ${E.fmtPusd(l.price)} in PUSD and your Satchel holds ${E.fmtPusd(sum)}. Send PUSD from Selene (stablecoin mode) to your Satchel: ${this.game.tokenAddress(this.satchelKey.lock)}`);
        pusd = this.satchelKey.inputs(have);
      }
      const built = await this.fundAndFinalize(E.buyDraft(this.game, [l], this.satchelKey.lock, pusd));
      const txid = await this.chain.broadcast(built.hex);
      this.done('buy', txid);
      if (l.hero) await this.syncNow(l.hero.id, E.utxoOf({ txid, outputs: built.outputs }, 1));
      return this.receipt(txid);
    });
  }
  cancel(listingId: string): Promise<Receipt> {
    return this.serial(async () => this.cancelNow(await this.rawListing(listingId)));
  }
  private async cancelNow(l: E.Listing) {
    if (hex(l.sellerPkh) !== hex(this.satchelKey.pkh)) throw new Error('Not your listing.');
    const draft = E.cancelDraft(this.game, l, this.satchelKey.privateKey, this.satchelKey.publicKey, this.satchelKey.lock);
    const built = await this.fundAndFinalize(draft);
    const txid = await this.chain.broadcast(built.hex);
    this.done('cancel', txid);
    return this.receipt(txid);
  }

  // ------------------------------------------------------------------ satchel <-> home wallet
  /** Satchel hero -> home wallet; a hero at home comes back through a wallet signature. */
  sendHome(heroId: number): Promise<Receipt> {
    return this.serial(async () => {
      const s = await this.chain.holdings(this.game, this.satchelKey.lock);
      const inSatchel = s.heroes.find((x) => x.hero.id === heroId);
      if (inSatchel) {
        if (!this.wallet) throw new Error('Connect your wallet first so your hero has a home to go to.');
        const home = this.wallet.receiveLock();
        const own = await this.chain.ghost(this.game, heroId);
        if (own && !E.ghostPays(own.utxo, home)) {
          // Send home and sync in one Satchel signed tx: the ghost's fees follow the hero home
          const r = await this.laneTx('send-home', async (lane) => {
            const g = await this.chain.ghost(this.game, heroId);
            const h = await this.satchelHero(heroId);
            if (!g) throw new Error("That hero's ghost has left the Arena.");
            const d = E.syncDraft(this.game, { lane, hero: this.satchelKey.inputs([h.utxo])[0], ownGhost: g.utxo, toLock: home }).draft;
            return d;
          });
          return this.receipt(r.txid);
        }
        const built = E.sendHome(this.satchelKey, [inSatchel.utxo], await this.satchelCoins(), home, this.game.cfg.feeRate);
        const txid = await this.chain.broadcast(built.hex);
        this.done('send-home', txid);
        return this.receipt(txid);
      }
      return this.bringBackNow(heroId);
    });
  }
  private async walletCoins() {
    const w = this.wallet!;
    const keys = w.keys();
    const found = await Promise.all(keys.map(async (k) => ({ k, us: (await this.chain.utxos(k.lock)).filter((u) => !this.isAuthhead(u)) })));
    return found;
  }
  private async bringBackNow(heroId: number) {
    const w = this.wallet;
    if (!w) throw new Error('Connect your wallet to bring a hero back.');
    if (!w.sign) throw new Error('Your wallet is remembered but not connected. Connect it again to sign.');
    const all = await this.walletCoins();
    const at = all.find((x) => x.us.some((u) => this.isHero(u, heroId)));
    if (!at) throw new Error('That hero is not in your wallet.');
    const tok = at.us.find((u) => this.isHero(u, heroId))!;
    const coins = all.flatMap((x) => x.us.filter((u) => !u.token).map((u) => E.walletInput(u, x.k)));
    const { built } = E.bringBackRequest([E.walletInput(tok, at.k)], coins, this.satchelKey, w.changeLock(), this.game.cfg.feeRate);
    const signed = await w.sign(built, 'Evermore: bring your hero into your play Satchel');
    const { hex: h } = E.acceptWalletSignature(built, signed);
    const txid = await this.chain.broadcast(h);
    this.done('bring-back', txid);
    // the hero is back in the Satchel: its ghost's fees follow it here (Satchel signed, no popup)
    await this.syncNow(heroId, E.utxoOf({ txid, outputs: built.outputs }, 0));
    return this.receipt(txid);
  }
  private isHero(u: Utxo, id: number) {
    const c = u.token?.nft?.commitment;
    return !!c && hex(u.token!.category) === hex(this.game.categoryBin) && c[0] === E.TAG.hero && E.decodeHero(c).id === id;
  }

  async satchel(): Promise<SatchelView> {
    const coins = await this.cached('sc', () => this.satchelCoins());
    const pusd = await this.cached('sp', () => this.satchelPusd());
    return {
      sats: Number(coins.reduce((a, c) => a + c.satoshis, 0n)), address: this.satchelKey.address(this.net), connected: this.wallet?.name ?? null,
      pusdCents: Number(pusd.reduce((a, u) => a + (u.token!.amount ?? 0n), 0n)), tokenAddress: this.game.pusdCategory ? this.game.tokenAddress(this.satchelKey.lock) : null,
    };
  }

  /** The connected wallet pays `sats` into the Satchel (one wallet signature). */
  fund(sats: number): Promise<Receipt> {
    return this.serial(async () => {
      const w = this.wallet;
      if (!w?.sign) throw new Error('Connect your wallet to add funds.');
      const all = await this.walletCoins();
      const coins = all.flatMap((x) => x.us.filter((u) => !u.token).map((u) => E.walletInput(u, x.k)));
      if (!coins.length) throw new Error(`No ${this.net === 'chipnet' ? 'chipnet ' : ''}BCH found in your wallet's first addresses.`);
      let req;
      try { req = E.fundSatchelRequest(coins, this.satchelKey, BigInt(Math.round(sats)), w.changeLock(), this.game.cfg.feeRate); }
      catch (e) { if (e instanceof E.InsufficientFunds) throw new Error(`Your wallet is short by ${e.needed} sats.`); throw e; }
      const signed = await w.sign(req.built, `Evermore: move ${Math.round(sats)} sats into your play Satchel`);
      const { hex: h } = E.acceptWalletSignature(req.built, signed);
      const txid = await this.chain.broadcast(h);
      this.done('fund', txid);
      return this.receipt(txid);
    });
  }

  /** Satchel pays everything back to the home wallet (no wallet prompt). */
  withdrawAll(): Promise<Receipt> {
    return this.serial(async () => {
      if (!this.wallet) throw new Error('Connect your wallet first.');
      // auto sweep: coins plus every stale ticket (burned, sats reclaimed)
      const built = E.satchelWithdraw(this.satchelKey, await this.satchelCoins(), this.wallet.receiveLock(), undefined, this.game.cfg.feeRate, await this.staleTickets());
      this.tickets.clear();
      const txid = await this.chain.broadcast(built.hex);
      this.done('withdraw', txid);
      return this.receipt(txid);
    });
  }

  async exportKey() { return this.satchelKey.toWif(this.net); }

  /** Covenant seed: hash256(heroId4 || ghostId4 || beaten2 || defences2), first 3 bytes LE. */
  styleSeed(heroId: number, g: { id: number; beaten: number; defences: number }) { return E.seedOf(E.seedHash(heroId, g.id, g.beaten, g.defences)); }

  /** Real earnings line: what this player's ghosts have earned from challenges, read from the Arena. */
  async earnings(): Promise<{ defences: number; sats: number }> {
    const pkhs = this.myPkhs();
    const gs = (await this.ghostsRaw()).filter((g) => pkhs.has(hex(g.ghost.ownerPkh)));
    const defences = gs.reduce((a, g) => a + g.ghost.defences, 0);
    return { defences, sats: defences * Number(this.game.params.challengeFee) };
  }

  async close() { await this.chain.disconnect().catch(() => undefined); }
}
