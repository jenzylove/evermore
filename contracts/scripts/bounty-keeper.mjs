// Warden bounties: beat a house hero (a Warden) and the house pays you.
//
// Watches the Arena on mainnet. A forge whose beaten ghost is a Warden (owned by the treasury) is a win against
// the house; the winner (the P2PKH holding the forged hero) is paid a bounty from a separate bounty wallet, once
// per hero per Warden. Every payout carries OP_RETURN 'EVB1' heroId4 wardenId4, so the paid set is rebuilt from
// the bounty wallet's own history: no database, restart safe. The bounty wallet holds only what it pays out.
//
//   BOUNTY_WIF=<wif> node contracts/scripts/bounty-keeper.mjs        (mainnet; never commit the key)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binToHex, decodeTransaction } from '@bitauth/libauth';
import * as E from '../../sdk/src/index.ts';
import { Chain } from '../../sdk/src/chain.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dep = JSON.parse(fs.readFileSync(path.join(here, '..', 'deployments', 'mainnet.json'), 'utf8'));
const wardens = JSON.parse(fs.readFileSync(path.join(here, '..', 'deployments', 'wardens-mainnet.json'), 'utf8'));
const WARDEN_IDS = new Set(Object.keys(wardens.labels).map(Number));
const game = E.gameFromDeployment(dep);
const key = E.Satchel.fromWif((process.env.BOUNTY_WIF ?? '').trim());
const POLL_MS = Number(process.env.POLL_MS ?? 15000);

/** bounty in US cents by Warden level (the game shows the same table) */
export const bountyCents = (level) => (level <= 2 ? 5 : level <= 4 ? 7 : level <= 6 ? 10 : 15);
const TAG = [0x45, 0x56, 0x42, 0x31]; // 'EVB1'
const le4 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const tagOut = (heroId, wardenId) => ({ lockingBytecode: Uint8Array.from([0x6a, 0x04, ...TAG, 0x08, ...le4(heroId), ...le4(wardenId)]), valueSatoshis: 0n });
const readTag = (lock) => (lock.length === 15 && lock[0] === 0x6a && lock[1] === 0x04 && TAG.every((b, i) => lock[2 + i] === b) && lock[6] === 0x08)
  ? `${lock[7] | (lock[8] << 8) | (lock[9] << 16) | (lock[10] << 24)}:${lock[11] | (lock[12] << 8) | (lock[13] << 16) | (lock[14] << 24)}` : null;

let usd = 200; // BCH price, refreshed hourly
async function price() {
  try { const j = await (await fetch('https://api.coinbase.com/v2/prices/BCH-USD/spot', { signal: AbortSignal.timeout(8000) })).json(); const n = Number(j.data.amount); if (n > 0) usd = n; } catch { /* keep the last */ }
}
const sats = (cents) => BigInt(Math.round(cents / 100 / usd * 1e8));

const chain = new Chain('mainnet');
const paid = new Set();   // 'heroId:wardenId' already paid (rebuilt from the chain)
const seen = new Set();   // arena txids already looked at
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function rebuildPaid() {
  for (const h of await chain.history(key.lock)) {
    const t = decodeTransaction(await chain.rawTx(h.tx_hash));
    if (typeof t === 'string') continue;
    for (const o of t.outputs) { const k = readTag(o.lockingBytecode); if (k) paid.add(k); }
  }
}

/** a forge against a Warden, won by someone other than the house: { heroId, warden, winnerLock } */
function wardenWin(tx) {
  const [, heroOut, ghostOut] = tx.outputs;
  const h = heroOut?.token?.nft?.commitment, g = ghostOut?.token?.nft?.commitment;
  if (!h || !g || h[0] !== E.TAG.hero || g[0] !== E.TAG.ghost) return null;
  if (binToHex(heroOut.token.category) !== dep.category && binToHex([...heroOut.token.category].reverse()) !== dep.category) return null;
  const hero = E.decodeHero(h), ghost = E.decodeGhost(g);
  if (binToHex(ghost.ownerPkh) !== dep.treasuryPkh || !WARDEN_IDS.has(ghost.id)) return null;
  if (!E.isP2pkh(heroOut.lockingBytecode)) return null;
  if (binToHex(E.pkhOfLock(heroOut.lockingBytecode)) === dep.treasuryPkh) return null; // the house fighting itself
  return { heroId: hero.id, warden: ghost, winnerLock: heroOut.lockingBytecode };
}

async function pay(win, txid) {
  const k = `${win.heroId}:${win.warden.id}`;
  if (paid.has(k)) return;
  const cents = bountyCents(win.warden.level);
  const draft = E.payDraft(win.winnerLock, sats(cents), 'bounty');
  draft.outputs.push(tagOut(win.heroId, win.warden.id));
  const coins = await chain.coins(key.lock);
  try {
    const built = E.finalize(draft, { funding: key.inputs(coins), changeLock: key.lock });
    const ptx = await chain.broadcast(built.hex);
    paid.add(k);
    log(`paid ${cents}c to hero #${win.heroId} for beating Warden #${win.warden.id} (L${win.warden.level}) win ${txid.slice(0, 8)} payout ${ptx}`);
  } catch (e) { log(`cannot pay hero #${win.heroId}: ${e.message}`); }
}

async function tick() {
  const hist = await chain.history(game.arenaLock);
  for (const h of hist) {
    if (seen.has(h.tx_hash)) continue;
    seen.add(h.tx_hash);
    const t = decodeTransaction(await chain.rawTx(h.tx_hash));
    if (typeof t === 'string') continue;
    const win = wardenWin(t);
    if (win) await pay(win, h.tx_hash);
  }
}

async function main() {
  await chain.connect(); await price(); await rebuildPaid();
  log(`bounty keeper on mainnet; wallet ${key.address('mainnet')} holds ${await chain.balance(key.lock)} sats; ${paid.size} bounties already paid; BCH $${usd}`);
  // the first pass marks every past win as seen without paying wins that happened before the keeper existed
  const startAt = Number(process.env.PAY_FROM_HEIGHT ?? 0);
  for (const h of await chain.history(game.arenaLock)) if (h.height > 0 && h.height < startAt) seen.add(h.tx_hash);
  setInterval(price, 3600_000);
  for (;;) { try { await tick(); } catch (e) { log('tick failed:', e.message); } await new Promise((r) => setTimeout(r, POLL_MS)); }
}
main().catch((e) => { console.error(e); process.exit(1); });
