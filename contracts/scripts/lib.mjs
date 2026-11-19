// Shared bits for smoke.mjs and wardens.mjs: network flag, deployer key, deployment, and a
// chain that is either live Fulcrum (E.Chain) or, with --dry, an in memory UTXO set seeded
// like a fresh genesis. Dry runs build every transaction with the sdk and run it through the
// 2026 VM, broadcasting nothing (how mainnet is rehearsed before it is funded).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binToHex, hash256, utf8ToBin } from '@bitauth/libauth';
import * as E from '@evermore/sdk';

export { E };
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv;
const flag = (n) => argv.includes(n);
const argNet = argv.indexOf('--net');
export const NET = argNet > 0 ? argv[argNet + 1] : (process.env.EVERMORE_NETWORK ?? 'chipnet');
if (NET !== 'chipnet' && NET !== 'mainnet') throw new Error(`unknown network ${NET}`);
export const DRY = flag('--dry');
if (NET === 'mainnet' && !DRY && !flag('--broadcast-mainnet')) {
  console.error('mainnet: pass --dry to rehearse in the VM, or --broadcast-mainnet for the real run (owner approved).');
  process.exit(1);
}
export const link = (t) => (DRY ? `(dry) ${t}` : E.network(NET).explorerTx(t));
export const sleep = (ms) => new Promise((r) => setTimeout(r, DRY ? 0 : ms));

export function loadKey(name = 'deployer') {
  if (name === 'deployer' && process.env.EVERMORE_DEPLOYER_WIF) return E.Satchel.fromWif(process.env.EVERMORE_DEPLOYER_WIF.trim());
  const f = name === 'deployer' ? (process.env.EVERMORE_KEY_FILE ?? `C:\\Users\\LENOVO\\relic-launch\\keys\\evermore-${NET}-deployer.wif`)
    : `C:\\Users\\LENOVO\\relic-launch\\keys\\evermore-${NET}-${name}.wif`;
  if (!fs.existsSync(f)) {
    if (NET === 'mainnet' || name === 'deployer') throw new Error(`key not found: ${f}`);
    const s = E.Satchel.generate(); fs.writeFileSync(f, s.toWif(NET) + '\n', { mode: 0o600 }); return s;
  }
  return E.Satchel.fromWif(fs.readFileSync(f, 'utf8').trim());
}

export const FEES = {
  raisePrice: BigInt(process.env.RAISE_PRICE ?? 119000), challengeFee: BigInt(process.env.CHALLENGE_FEE ?? 9500),
  forgeFee: BigInt(process.env.FORGE_FEE ?? 4800), gearCap: BigInt(process.env.GEAR_CAP ?? 5000),
};

/** The live deployment, or (dry, none yet) one fabricated with the genesis parameters. */
export function loadDeployment(deployer) {
  const f = path.join(root, 'deployments', `${NET}.json`);
  if (fs.existsSync(f) && !(DRY && NET === 'mainnet')) return { dep: JSON.parse(fs.readFileSync(f, 'utf8')), fabricated: false };
  if (!DRY) throw new Error(`no deployment for ${NET}; run genesis first`);
  const category = binToHex(hash256(utf8ToBin(`evermore-dry-${NET}`)));
  return { fabricated: true, dep: { network: NET, category, treasuryPkh: binToHex(deployer.pkh), ...Object.fromEntries(Object.entries(FEES).map(([k, v]) => [k, String(v)])) } };
}

/** In memory chain: same read/submit surface the scripts use from E.Chain. */
export class MemChain {
  constructor(game, fundLock, fundSats = 50_000_000n) {
    this.game = game; this.net = game.net; this.set = new Map(); this.n = 0;
    const cat = game.categoryBin;
    const tok = (capability, commitment) => ({ category: cat, amount: 0n, nft: { capability, commitment } });
    const seed = (lockingBytecode, satoshis, token) => { const txid = binToHex(hash256(Uint8Array.of(this.n & 255, this.n++ >> 8, 0x99))); this.add({ txid, vout: 0, satoshis, lockingBytecode, ...(token ? { token } : {}) }); };
    for (let l = 0; l < 16; l++) seed(game.laneLock, E.TOKEN_SATS, tok('minting', E.encodeLane({ lane: l, ctr: 0 })));
    seed(game.counterLock, E.TOKEN_SATS, tok('none', E.encodeCounter(0)));
    for (let i = 0; i < 8; i++) seed(fundLock, fundSats / 8n);
  }
  add(u) { this.set.set(`${u.txid}:${u.vout}`, u); }
  async connect() { return 'in memory (dry run, VM verified, nothing broadcast)'; }
  async disconnect() {}
  async utxos(lock) { const h = binToHex(lock); return [...this.set.values()].filter((u) => binToHex(u.lockingBytecode) === h); }
  async coins(lock) { return (await this.utxos(lock)).filter((u) => !u.token); }
  async balance(lock) { return (await this.coins(lock)).reduce((a, u) => a + u.satoshis, 0n); }
  async broadcastBuilt(b) {
    const v = E.verify(b); if (v !== true) throw new Error(`VM rejects ${b.kind}: ${v}`);
    for (const i of b.inputs) { const k = `${i.utxo.txid}:${i.utxo.vout}`; if (!this.set.has(k)) throw new Error(`missing inputs ${k}`); this.set.delete(k); }
    b.outputs.forEach((o, vout) => { if (o.lockingBytecode[0] !== 0x6a) this.add(E.utxoOf(b, vout)); });
    return b.txid;
  }
  async submit(build) { const built = await build(0); return { txid: await this.broadcastBuilt(built), built, attempts: 1 }; }
  async broadcast() { throw new Error('use broadcastBuilt in dry runs'); }
  gameTokens(us, tag) { const c = binToHex(this.game.categoryBin); return us.filter((u) => u.token?.nft && binToHex(u.token.category) === c && u.token.nft.commitment[0] === tag); }
  async lanes() { return this.gameTokens(await this.utxos(this.game.laneLock), E.TAG.lane).map((utxo) => ({ utxo, lane: E.decodeLane(utxo.token.nft.commitment) })); }
  async ghosts() { return this.gameTokens(await this.utxos(this.game.arenaLock), E.TAG.ghost).map((utxo) => ({ utxo, ghost: E.decodeGhost(utxo.token.nft.commitment) })); }
  async ghost(_g, id) { return (await this.ghosts()).find((g) => g.ghost.id === id) ?? null; }
  async counter() { const c = this.gameTokens(await this.utxos(this.game.counterLock), E.TAG.counter)[0]; return c ? { utxo: c, minted: E.decodeCounter(c.token.nft.commitment) } : null; }
  async holdings(_g, lock) {
    const us = await this.utxos(lock);
    return {
      heroes: this.gameTokens(us, E.TAG.hero).map((utxo) => ({ utxo, hero: E.decodeHero(utxo.token.nft.commitment) })),
      gear: this.gameTokens(us, E.TAG.gear).map((utxo) => ({ utxo, gear: E.decodeGear(utxo.token.nft.commitment) })),
      tickets: this.gameTokens(us, E.TAG.ticket).map((utxo) => ({ utxo, ticket: E.decodeTicket(utxo.token.nft.commitment) })),
      coins: us.filter((u) => !u.token),
    };
  }
}

/** Game + chain + helpers bound to one payer key. */
export function setup(me) {
  const { dep, fabricated } = loadDeployment(me);
  const game = E.gameFromDeployment(dep);
  const chain = DRY ? new MemChain(game, me.lock) : new E.Chain(NET);
  const isAuthhead = (c) => c.txid === dep.authhead?.txid && c.vout === dep.authhead?.vout;
  const coins = async (lock = me.lock) => (await chain.coins(lock)).filter((c) => !isAuthhead(c));
  const send = async (built) => (DRY ? chain.broadcastBuilt(built) : chain.broadcast(built.hex));
  /** A lane transaction with retry on conflicts (fresh random lane each attempt). */
  async function laneTx(label, make, payer = me) {
    const avoid = [];
    const r = await chain.submit(async () => {
      const lanes = await chain.lanes(game);
      const l = E.pickLane(lanes, avoid);
      avoid.push(l.lane.lane);
      const draft = await make(l.utxo);
      return E.finalize(draft, { funding: payer.inputs(await coins(payer.lock)), changeLock: payer.lock });
    }, 6);
    if (label) console.log(`${label.padEnd(10)} ${link(r.txid)}${r.attempts > 1 ? ` (${r.attempts} attempts)` : ''}`);
    await sleep(1500);
    return r;
  }
  return { dep, fabricated, game, chain, coins, send, laneTx };
}
