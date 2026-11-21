// Chain reads and broadcast over Fulcrum (Electrum protocol, secure WebSocket).
// No server of ours: everything the game shows is read from public Fulcrum nodes.
import { ElectrumClient } from '@electrum-cash/network';
import { binToHex, hexToBin, decodeTransaction } from '@bitauth/libauth';
import { network } from './network.ts';
import type { NetworkName, ElectrumServer } from './network.ts';
import { decodeGhost, decodeHero, decodeGear, decodeLane, decodeCounter, decodeTicket, TAG } from './codec.ts';
import type { Ghost, Hero, Gear, Ticket } from './codec.ts';
import { p2pkhLock, lockToAddress } from './game.ts';
import type { Game } from './game.ts';
import { decodeListingTag } from './tx.ts';
import type { Utxo, Token, Built, Listing } from './tx.ts';

type RawUtxo = {
  tx_hash: string; tx_pos: number; value: number; height: number;
  token_data?: { amount: string; category: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
};

export const tokenFromElectrum = (t: RawUtxo['token_data']): Token | undefined => t && ({
  category: hexToBin(t.category), amount: BigInt(t.amount),
  ...(t.nft ? { nft: { capability: t.nft.capability, commitment: hexToBin(t.nft.commitment) } } : {}),
});

/** Errors that mean "someone spent that lane / ghost / counter first": rebuild and retry. */
export const CONFLICT = /txn-mempool-conflict|missing ?inputs|missingorspent|inputs.?spent|double.?spend|already.?spent|conflict/i;

export class Chain {
  readonly net: NetworkName;
  private client: ElectrumClient<any> | null = null;
  private servers: ElectrumServer[];
  constructor(net: NetworkName, servers?: ElectrumServer[]) {
    this.net = net;
    this.servers = servers ?? network(net).electrum;
  }

  /** Connect to the first reachable server. */
  async connect(): Promise<string> {
    let last: unknown;
    for (const s of this.servers) {
      const c = new ElectrumClient('evermore', '1.5', s.host, { port: s.port, encrypted: true, timeoutInMilliSeconds: 15000 });
      try {
        await c.connect();
        this.client = c;
        return `${s.host}:${s.port}`;
      } catch (e) { last = e; try { await c.disconnect(true); } catch { /* ignore */ } }
    }
    throw new Error(`no Fulcrum server reachable for ${this.net}: ${String(last)}`);
  }
  async disconnect() { if (this.client) await this.client.disconnect(true); this.client = null; }

  async request<T>(method: string, ...params: (string | number | boolean)[]): Promise<T> {
    if (!this.client) await this.connect();
    let r: unknown;
    try {
      r = await this.client!.request(method, ...params);
      if (r instanceof Error) throw r;
    } catch (e) {
      // a dropped socket (servers close idle or long sessions): reconnect once and retry reads.
      // Broadcasts are not retried here; submit() re-reads the chain and rebuilds instead.
      if (method === 'blockchain.transaction.broadcast' || !/disconnect|not connected|closed|lost|timed? ?out|ECONNRESET|socket/i.test(String((e as Error)?.message ?? e))) throw e;
      try { await this.client?.disconnect(true); } catch { /* already gone */ }
      this.client = null;
      await this.connect();
      r = await this.client!.request(method, ...params);
      if (r instanceof Error) throw r;
    }
    if (r && typeof r === 'object' && 'code' in (r as any) && 'message' in (r as any)) throw new Error((r as any).message);
    return r as T;
  }

  address(lock: Uint8Array) { return lockToAddress(lock, network(this.net).prefix); }

  /** All UTXOs (confirmed and mempool) at a locking bytecode, token data included. */
  async utxos(lock: Uint8Array): Promise<Utxo[]> {
    const raw = await this.request<RawUtxo[]>('blockchain.address.listunspent', this.address(lock), 'include_tokens');
    return raw.map((u) => ({
      txid: u.tx_hash, vout: u.tx_pos, satoshis: BigInt(u.value), lockingBytecode: lock, height: u.height,
      ...(u.token_data ? { token: tokenFromElectrum(u.token_data) } : {}),
    }));
  }
  /** Plain BCH coins (no tokens) at a lock: what can fund a transaction. */
  async coins(lock: Uint8Array) { return (await this.utxos(lock)).filter((u) => !u.token); }
  async balance(lock: Uint8Array) { return (await this.coins(lock)).reduce((a, u) => a + u.satoshis, 0n); }
  async tip(): Promise<number> { const h = await this.request<{ height: number }>('blockchain.headers.get_tip'); return h.height; }
  async rawTx(txid: string): Promise<Uint8Array> { return hexToBin(await this.request<string>('blockchain.transaction.get', txid, false)); }
  async history(lock: Uint8Array) { return this.request<{ tx_hash: string; height: number }[]>('blockchain.address.get_history', this.address(lock)); }

  async broadcast(hex: string): Promise<string> { return this.request<string>('blockchain.transaction.broadcast', hex); }

  // ---------------------------------------------------------------- game reads
  private gameTokens(game: Game, us: Utxo[], tag: number) {
    const cat = binToHex(game.categoryBin);
    return us.filter((u) => u.token?.nft && binToHex(u.token.category) === cat && u.token.nft.commitment[0] === tag);
  }
  async lanes(game: Game) {
    return this.gameTokens(game, await this.utxos(game.laneLock), TAG.lane)
      .filter((u) => u.token!.nft!.capability === 'minting')
      .map((utxo) => ({ utxo, lane: decodeLane(utxo.token!.nft!.commitment) }));
  }
  async ghosts(game: Game): Promise<{ utxo: Utxo; ghost: Ghost }[]> {
    return this.gameTokens(game, await this.utxos(game.arenaLock), TAG.ghost).map((utxo) => ({ utxo, ghost: decodeGhost(utxo.token!.nft!.commitment) }));
  }
  async ghost(game: Game, id: number) { return (await this.ghosts(game)).find((g) => g.ghost.id === id) ?? null; }
  async counter(game: Game) {
    const c = this.gameTokens(game, await this.utxos(game.counterLock), TAG.counter)[0];
    return c ? { utxo: c, minted: decodeCounter(c.token!.nft!.commitment) } : null;
  }
  /** Heroes, gear and tickets held at a lock (a Satchel or a wallet address). */
  async holdings(game: Game, lock: Uint8Array) {
    const us = await this.utxos(lock);
    return {
      heroes: this.gameTokens(game, us, TAG.hero).map((utxo) => ({ utxo, hero: decodeHero(utxo.token!.nft!.commitment) as Hero })),
      gear: this.gameTokens(game, us, TAG.gear).map((utxo) => ({ utxo, gear: decodeGear(utxo.token!.nft!.commitment) as Gear })),
      tickets: this.gameTokens(game, us, TAG.ticket).map((utxo) => ({ utxo, ticket: decodeTicket(utxo.token!.nft!.commitment) as Ticket })),
      coins: us.filter((u) => !u.token),
    };
  }
  /**
   * Find a hero by id: its ghost names the owner pkh (refreshed at each level up), so look
   * there first, then in any extra locks the caller knows (Satchel, connected wallet).
   */
  async heroById(game: Game, id: number, extraLocks: Uint8Array[] = []) {
    const g = await this.ghost(game, id);
    const locks = [...(g ? [p2pkhLock(g.ghost.ownerPkh)] : []), ...extraLocks];
    for (const l of locks) {
      const h = (await this.holdings(game, l)).heroes.find((x) => x.hero.id === id);
      if (h) return { ...h, ghost: g };
    }
    return null;
  }
  /**
   * Open listings: every listing tx sends dust to the bazaar beacon and carries
   * OP_RETURN 'EVR1' sellerPkh price; a listing is open while its Sale UTXO is unspent.
   */
  async listings(game: Game, maxTx = 200): Promise<(Listing & { hero?: Hero; gear?: Gear })[]> {
    const hist = (await this.history(game.bazaarLock)).slice(-maxTx);
    const seen = new Set<string>();
    const out: (Listing & { hero?: Hero; gear?: Gear })[] = [];
    for (const h of hist) {
      const t = decodeTransaction(await this.rawTx(h.tx_hash));
      if (typeof t === 'string') continue;
      for (const o of t.outputs) {
        const tag = decodeListingTag(o.lockingBytecode);
        if (!tag) continue;
        const lock = hexToBin(game.sale(tag.sellerPkh, tag.price).lockingBytecode);
        const key = binToHex(lock);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const utxo of await this.utxos(lock)) {
          if (!utxo.token?.nft || binToHex(utxo.token.category) !== binToHex(game.categoryBin)) continue;
          const c = utxo.token.nft.commitment;
          const item = { utxo, sellerPkh: tag.sellerPkh, price: tag.price } as Listing & { hero?: Hero; gear?: Gear };
          if (c[0] === TAG.hero) item.hero = decodeHero(c);
          else if (c[0] === TAG.gear) item.gear = decodeGear(c);
          else continue;
          out.push(item);
        }
      }
    }
    return out;
  }

  /**
   * Broadcast with conflict retry. `build(attempt)` must refetch the contended UTXOs (lane,
   * ghost, own ghost, counter) and rebuild; on a double spend error it is called again, up
   * to `tries` times. Pick a different random lane per attempt (see pickLane).
   */
  async submit(build: (attempt: number) => Promise<Built> | Built, tries = 4): Promise<{ txid: string; built: Built; attempts: number }> {
    let last: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
      const built = await build(attempt);
      try {
        const txid = await this.broadcast(built.hex);
        return { txid, built, attempts: attempt + 1 };
      } catch (e) {
        last = e;
        if (!CONFLICT.test(String((e as Error)?.message ?? e))) throw e;
      }
    }
    throw new Error(`still conflicting after ${tries} attempts: ${String((last as Error)?.message ?? last)}`);
  }
}

/** A random lane, avoiding ones that just conflicted. */
export function pickLane<T extends { lane: { lane: number } }>(lanes: T[], avoid: number[] = [], rnd = Math.random): T {
  const pool = lanes.filter((l) => !avoid.includes(l.lane.lane));
  const from = pool.length ? pool : lanes;
  if (!from.length) throw new Error('no lanes found');
  return from[Math.floor(rnd() * from.length)];
}
