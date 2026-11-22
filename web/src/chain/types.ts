// The one seam between the game client and Bitcoin Cash.
// `sdk/` implements GameChain for chipnet and mainnet; PracticeChain implements it in the browser.
// The client never builds transactions itself, and never invents a txid.

export type Mode = 'practice' | 'chipnet' | 'mainnet';
export type ClassId = 0 | 1 | 2; // Knight, Rogue, Mage

export type Stats = { hp: number; atk: number; def: number; spd: number };

/** A hero token in one of the player's wallets (decoded from its 23 byte commitment). */
export type HeroView = Stats & {
  id: number;
  cls: ClassId;
  level: number;
  xp: number;
  wins: number;
  name: string;            // display name (BCMR / local label); not in the commitment
  /** read from the hero's own ghost */
  defences: number;
  beaten: number;
  /** total challenge fees this hero's ghost has earned, in sats */
  earnedSats: number;
  where: 'satchel' | 'home' | 'listed';
};

/** A hero standing in the Arena (decoded from its 43 byte ghost commitment). */
export type GhostView = Stats & {
  /** practice only: the training echo a new player meets first */
  trainee?: boolean;
  id: number;
  cls: ClassId;
  level: number;
  beaten: number;
  defences: number;
  name: string;
  owner: string;           // short owner label, e.g. "qz8f…3ka"
  mine: boolean;
  /** house heroes (Wardens) on a real chain: the bounty the house pays for your first win against it, in US cents */
  bounty?: number;
};

export type GearView = { id: number; kind: 0 | 1 | 2; tier: number; where: 'satchel' | 'home' | 'listed' };

/** A transaction the chain accepted. txid and explorer are null only in practice. */
export type Receipt = { txid: string | null; explorer: string | null };

/** Snapshot made by a challenge; the forge replays moves against exactly this. */
export type Ticket = {
  heroId: number;
  ghost: GhostView;        // stats, beaten and defences as read before the challenge
  seed: number;            // first 3 bytes LE of hash256(heroId4 || ghostId4 || beaten4 || defences4)
  receipt: Receipt;
};

export type ForgeResult = {
  receipt: Receipt;
  hero: HeroView;          // hero after the forge
  xpGain: number;
  levelled: boolean;
  gear: GearView | null;   // drop when ghost level >= hero level + 3 and the cap allows
};

export type Listing = {
  id: string;
  kind: 'hero' | 'gear';
  hero?: HeroView;
  gear?: GearView;
  priceSats: number;
  /** set when the listing is priced in PUSD (dollar cents); priceSats is then 0 */
  pusdCents?: number;
  seller: string;
  mine: boolean;
};

export type SatchelView = {
  sats: number;            // spendable in the play key
  address: string | null;  // null in practice
  connected: string | null; // short label of the connected home wallet (Selene / Cashonize), if any
  /** PUSD held in the play key, in cents (real chains with PUSD) */
  pusdCents?: number;
  /** token aware address to send PUSD to */
  tokenAddress?: string | null;
};

export type Fees = { raiseSats: number; challengeSats: number; forgeSats: number; usdPerBch: number };

export interface GameChain {
  readonly mode: Mode;
  fees(): Fees;
  /** names live in this browser, not on chain: renaming is free */
  rename(heroId: number, name: string): void;
  /** real chains: send the Satchel's coins to the connected wallet */
  withdrawAll?(): Promise<Receipt>;

  listGhosts(): Promise<GhostView[]>;
  myHeroes(): Promise<HeroView[]>;
  getHero(id: number): Promise<HeroView | null>;
  myGear(): Promise<GearView[]>;

  raise(cls: ClassId, name: string): Promise<{ hero: HeroView; receipt: Receipt }>;
  /** pays the challenge fee to the ghost's owner and records the snapshot */
  challenge(heroId: number, ghostId: number): Promise<Ticket>;
  /** submits the move list; the covenant replays it. Only call with a winning list. */
  forge(ticket: Ticket, moves: number[]): Promise<ForgeResult>;

  listings(): Promise<Listing[]>;
  /** price in sats, or with `pusdCents` a dollar price paid in PUSD */
  list(kind: 'hero' | 'gear', id: number, priceSats: number, pusdCents?: number): Promise<Receipt>;
  /** true when listings can be priced in PUSD on this chain */
  hasPusd?(): boolean;
  buy(listingId: string): Promise<Receipt>;
  cancel(listingId: string): Promise<Receipt>;
  sendHome(heroId: number): Promise<Receipt>;

  satchel(): Promise<SatchelView>;
  fund(sats: number): Promise<Receipt>;
  /** play key WIF for export; null in practice */
  exportKey(): Promise<string | null>;
  /**
   * The ghost's move seed for this hero, exactly as the covenant derives it (real chains only;
   * practice uses the sim's own styleHash). Lets the Arena preview the real style before paying.
   */
  styleSeed?(heroId: number, ghost: { id: number; beaten: number; defences: number }): number;
}
