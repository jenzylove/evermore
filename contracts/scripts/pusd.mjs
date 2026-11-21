// PUSD bazaar on the live game.
//   node scripts/pusd.mjs list [--net mainnet --broadcast-mainnet]   raise a hero and list it for $1.00 PUSD
//   node scripts/pusd.mjs buy  [--net mainnet --broadcast-mainnet]   the second key buys that listing with its PUSD
// Txids go to deployments/pusd-<net>.json for /proof.
import fs from 'node:fs';
import path from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { E, NET, DRY, link, loadKey, setup, root } from './lib.mjs';

const mode = process.argv[2];
const me = loadKey('deployer');
const { game, chain, coins, send, laneTx } = setup(me);
const other = DRY ? E.Satchel.generate() : loadKey('test-buyer');
const PRICE = 100n; // $1.00
const f = path.join(root, 'deployments', `pusd-${NET}.json`);
const rec = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { network: NET };
const save = () => { if (!DRY) fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n'); };

async function main() {
  console.log(`connected ${await chain.connect()}; ${NET}; PUSD ${game.pusdCategory}`);
  if (mode === 'list') {
    const r = await laneTx('raise', (lane) => E.raiseDraft(game, lane, 0, me.lock).draft);
    const hero = E.decodeHero(r.built.outputs[1].token.nft.commitment);
    const { draft } = E.listDraft(game, me.inputs([E.utxoOf({ txid: r.txid, outputs: r.built.outputs }, 1)])[0], me.pkh, PRICE, 'pusd');
    await new Promise((res) => setTimeout(res, DRY ? 0 : 4000));
    const b = E.finalize(draft, { funding: me.inputs(await coins()), changeLock: me.lock });
    rec.list = await send(b); rec.heroId = hero.id;
    console.log(`list       ${link(rec.list)} (hero #${hero.id} for ${E.fmtPusd(PRICE)} PUSD)`);
    save();
  } else if (mode === 'buy') {
    const l = (await chain.listings(game)).find((x) => x.currency === 'pusd' && x.hero?.id === rec.heroId);
    if (!l) throw new Error(`PUSD listing for hero #${rec.heroId} not found`);
    const us = await chain.utxos(other.lock);
    const pusd = us.filter((u) => u.token && !u.token.nft && binToHex(u.token.category) === game.pusdCategory);
    const bch = us.filter((u) => !u.token);
    console.log(`buyer ${other.address(NET)} holds ${E.fmtPusd(pusd.reduce((a, u) => a + u.token.amount, 0n))} PUSD, ${bch.reduce((a, u) => a + u.satoshis, 0n)} sats`);
    const b = E.finalize(E.buyDraft(game, [l], other.lock, other.inputs(pusd)), { funding: other.inputs(bch), changeLock: other.lock });
    rec.buy = await send(b);
    console.log(`buy        ${link(rec.buy)} (seller paid ${E.fmtPusd(PRICE)} PUSD in the same tx)`);
    save();
  } else throw new Error('mode: list | buy');
  await chain.disconnect();
}
main().catch(async (e) => { console.error(e.message ?? e); await chain.disconnect().catch(() => {}); process.exit(1); });
