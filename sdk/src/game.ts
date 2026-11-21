// A deployed Evermore game: the category, the parameters fixed at genesis, and the four
// covenants instantiated from them. Pure (no network access).
import { Contract } from 'cashscript';
import { binToHex, hexToBin, hash160, encodeCashAddress, CashAddressType } from '@bitauth/libauth';
import LaneArtifact from './artifacts/Lane.ts';
import ArenaArtifact from './artifacts/Arena.ts';
import CounterArtifact from './artifacts/Counter.ts';
import SaleArtifact from './artifacts/Sale.ts';
import SaleTokenArtifact from './artifacts/SaleToken.ts';
import { network } from './network.ts';
import type { NetworkName } from './network.ts';

export type GameParams = {
  /** override the network's PUSD category (tests use a stand in on chipnet) */
  pusdCategory?: string;
  /** Category id, display (txid) order hex, as wallets and explorers show it. */
  category: string;
  treasuryPkh: string; // hex
  raisePrice: bigint;
  challengeFee: bigint;
  forgeFee: bigint;
  gearCap: bigint;
};

/** What genesis writes to contracts/deployments/<network>.json (bigints as strings). */
export type Deployment = {
  network: NetworkName;
  category: string;
  treasuryPkh: string;
  raisePrice: string;
  challengeFee: string;
  forgeFee: string;
  gearCap: string;
  genesisTxid?: string;
  authbaseTxid?: string;
  bazaarAddress?: string;
  addresses?: { lane: string; arena: string; counter: string };
  bcmr?: { url: string; sha256: string } | null;
  createdAt?: string;
};

/** Value (sats) every game token output carries. Ghost dust is locked forever. */
export const TOKEN_SATS = 1000n;
export const DUST = 546n;

const stubProvider = (net: NetworkName) => ({ network: net }) as any;
export const reverseHex = (hex: string) => binToHex(hexToBin(hex).reverse());

export type Game = ReturnType<typeof makeGame>;

export type Currency = 'bch' | 'pusd';

export function makeGame(params: GameParams, net: NetworkName) {
  const cfg = network(net);
  const opt = { provider: stubProvider(net), addressType: 'p2sh32' as const };
  // Covenants take the category in internal byte order (as introspection sees it).
  const catInternal = reverseHex(params.category);
  const arena = new Contract(ArenaArtifact as any, [catInternal], opt);
  const counter = new Contract(CounterArtifact as any, [catInternal], opt);
  const lane = new Contract(LaneArtifact as any, [params.treasuryPkh, arena.lockingBytecode, counter.lockingBytecode,
    params.raisePrice, params.challengeFee, params.forgeFee, params.gearCap], opt);
  const saleCache = new Map<string, Contract>();
  const sale = (sellerPkh: Uint8Array | string, price: bigint) => {
    const pkh = typeof sellerPkh === 'string' ? sellerPkh : binToHex(sellerPkh);
    const key = `${pkh}:${price}`;
    let c = saleCache.get(key);
    if (!c) { c = new Contract(SaleArtifact as any, [pkh, price], opt); saleCache.set(key, c); }
    return c;
  };
  // ParyonUSD (PUSD), a fungible CashToken with 2 decimals (150 = $1.50); mainnet only
  const pusdCategory = params.pusdCategory ?? cfg.pusdCategory ?? null;
  const saleTokenCache = new Map<string, Contract>();
  const saleToken = (sellerPkh: Uint8Array | string, price: bigint) => {
    if (!pusdCategory) throw new Error(`PUSD is not available on ${net}`);
    const pkh = typeof sellerPkh === 'string' ? sellerPkh : binToHex(sellerPkh);
    const key = `${pkh}:${price}`;
    let c = saleTokenCache.get(key);
    if (!c) { c = new Contract(SaleTokenArtifact as any, [pkh, price, reverseHex(pusdCategory)], opt); saleTokenCache.set(key, c); }
    return c;
  };
  /** the sale contract for a listing in either currency */
  const saleFor = (sellerPkh: Uint8Array | string, price: bigint, currency: Currency = 'bch') => (currency === 'pusd' ? saleToken(sellerPkh, price) : sale(sellerPkh, price));
  return {
    net, cfg, params, saleToken, saleFor,
    /** PUSD category in display order (wallet and explorer order), or null where PUSD does not exist */
    pusdCategory,
    /** category bytes in display order, the way libauth token objects hold it */
    categoryBin: hexToBin(params.category),
    lane, arena, counter, sale,
    laneLock: hexToBin(lane.lockingBytecode),
    arenaLock: hexToBin(arena.lockingBytecode),
    counterLock: hexToBin(counter.lockingBytecode),
    treasuryLock: p2pkhLock(hexToBin(params.treasuryPkh)),
    /** Listings send DUST here with their OP_RETURN so clients can find them by address history. */
    bazaarLock: p2pkhLock(BAZAAR_PKH),
    address: (lock: Uint8Array) => lockToAddress(lock, cfg.prefix),
    tokenAddress: (lock: Uint8Array) => lockToAddress(lock, cfg.prefix, true),
  };
}

export const paramsFromDeployment = (d: Deployment): GameParams => ({
  category: d.category, treasuryPkh: d.treasuryPkh,
  raisePrice: BigInt(d.raisePrice), challengeFee: BigInt(d.challengeFee), forgeFee: BigInt(d.forgeFee), gearCap: BigInt(d.gearCap),
});
export const gameFromDeployment = (d: Deployment) => makeGame(paramsFromDeployment(d), d.network);

// ---- locking bytecode helpers
export const p2pkhLock = (pkh: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
export const isP2pkh = (l: Uint8Array) => l.length === 25 && l[0] === 0x76 && l[1] === 0xa9 && l[2] === 0x14 && l[23] === 0x88 && l[24] === 0xac;
export const pkhOfLock = (l: Uint8Array) => { if (!isP2pkh(l)) throw new Error('not a P2PKH lock'); return l.slice(3, 23); };

/**
 * The bazaar beacon: P2PKH of hash160("evermore-bazaar-v1"). No key hashes to it, so the
 * dust sent there is burned; its address history is the public index of listings.
 */
export const BAZAAR_PKH = hash160(new TextEncoder().encode('evermore-bazaar-v1'));

export function lockToAddress(lock: Uint8Array, prefix: 'bchtest' | 'bitcoincash', tokenAware = false): string {
  if (isP2pkh(lock)) {
    return encodeCashAddress({ prefix, type: tokenAware ? CashAddressType.p2pkhWithTokens : CashAddressType.p2pkh, payload: lock.slice(3, 23) }).address;
  }
  if (lock.length === 35 && lock[0] === 0xaa && lock[1] === 0x20 && lock[34] === 0x87) {
    return encodeCashAddress({ prefix, type: tokenAware ? CashAddressType.p2shWithTokens : CashAddressType.p2sh, payload: lock.slice(2, 34) }).address;
  }
  if (lock.length === 23 && lock[0] === 0xa9 && lock[1] === 0x14 && lock[22] === 0x87) {
    return encodeCashAddress({ prefix, type: tokenAware ? CashAddressType.p2shWithTokens : CashAddressType.p2sh, payload: lock.slice(2, 22) }).address;
  }
  throw new Error('no address for this locking bytecode');
}
