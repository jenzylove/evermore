// Bazaar run against the deployed game: list a hero, have a second key buy it (hero and money
// swap in one tx), sync so the hero's ghost pays its new holder, then list a second hero and
// cancel the listing. Txids go to deployments/bazaar-<net>.json for /proof.
//
//   node scripts/bazaar.mjs [--net chipnet|mainnet] [--dry]   (mainnet needs --broadcast-mainnet)
import fs from 'node:fs';
import path from 'node:path';
import { E, NET, DRY, link, loadKey, setup, root } from './lib.mjs';

const me = loadKey('deployer');
const { game, chain, coins, send, laneTx } = setup(me);
const other = DRY ? E.Satchel.generate() : loadKey('test-buyer');
const PRICE = 20000n;

async function main() {
  console.log(`connected ${await chain.connect()}; ${NET}; seller ${me.address(NET)}; buyer ${other.address(NET)}`);
  const rec = { network: NET };
  const raise = async (cls) => {
    const r = await laneTx('raise', (lane) => E.raiseDraft(game, lane, cls, me.lock).draft);
    return E.decodeHero(r.built.outputs[1].token.nft.commitment).id;
  };
  const heroUtxo = async (id, lock = me.lock) => (await chain.holdings(game, lock)).heroes.find((x) => x.hero.id === id).utxo;

  // 1. fresh heroes to trade, so no Warden or player hero is touched
  const a = await raise(1), b = await raise(2);
  // 2. the buyer gets a little BCH to pay with
  const fund = E.finalize(E.payDraft(other.lock, PRICE + 30000n), { funding: me.inputs(await coins()), changeLock: me.lock });
  rec.fund = await send(fund); console.log(`fund       ${link(rec.fund)}`);
  // 3. list hero a
  const { draft } = E.listDraft(game, me.inputs([await heroUtxo(a)])[0], me.pkh, PRICE);
  const lb = E.finalize(draft, { funding: me.inputs(await coins()), changeLock: me.lock });
  rec.list = await send(lb); console.log(`list       ${link(rec.list)} (hero #${a} for ${PRICE} sats)`);
  // 4. the buyer finds it through the bazaar beacon and buys it
  let l = typeof chain.listings === 'function' ? null : { utxo: E.utxoOf({ txid: rec.list, outputs: lb.outputs }, 0), sellerPkh: me.pkh, price: PRICE };
  for (let i = 0; i < 10 && !l; i++) { l = (await chain.listings(game)).find((x) => x.hero?.id === a) ?? null; if (!l) await new Promise((r) => setTimeout(r, DRY ? 0 : 3000)); }
  if (!l) throw new Error('listing not found through the bazaar');
  const bb = E.finalize(E.buyDraft(game, [l], other.lock), { funding: other.inputs(await coins(other.lock)), changeLock: other.lock });
  rec.buy = await send(bb); console.log(`buy        ${link(rec.buy)} (seller paid ${PRICE} sats in the same tx)`);
  // 5. the ghost's fees follow the hero to the buyer
  const s = await laneTx('sync', async (lane) => E.syncDraft(game, {
    lane, hero: other.inputs([E.utxoOf({ txid: rec.buy, outputs: bb.outputs }, 1)])[0],
    ownGhost: (await chain.ghost(game, a)).utxo, toLock: other.lock,
  }).draft, other);
  rec.sync = s.txid;
  // 6. list hero b and take it back
  const l2 = E.listDraft(game, me.inputs([await heroUtxo(b)])[0], me.pkh, PRICE);
  const l2b = E.finalize(l2.draft, { funding: me.inputs(await coins()), changeLock: me.lock });
  rec.list2 = await send(l2b); console.log(`list       ${link(rec.list2)} (hero #${b})`);
  await new Promise((r) => setTimeout(r, DRY ? 0 : 4000)); // let the server see the list tx spend its coins
  const listing2 = { utxo: E.utxoOf({ txid: rec.list2, outputs: l2b.outputs }, 0), sellerPkh: me.pkh, price: PRICE };
  const cb = E.finalize(E.cancelDraft(game, listing2, me.privateKey, me.publicKey, me.lock), { funding: me.inputs(await coins()), changeLock: me.lock });
  rec.cancel = await send(cb); console.log(`cancel     ${link(rec.cancel)} (hero #${b} back with the seller)`);
  rec.heroSold = a; rec.heroCancelled = b;
  if (!DRY) fs.writeFileSync(path.join(root, 'deployments', `bazaar-${NET}.json`), JSON.stringify(rec, null, 2) + '\n');
  await chain.disconnect();
}
main().catch(async (e) => { console.error(e.message ?? e); await chain.disconnect().catch(() => {}); process.exit(1); });
