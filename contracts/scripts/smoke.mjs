// Chipnet smoke run against the deployed game: raise two heroes, challenge one hero's ghost
// with the other (paying again until the style is winnable), forge the win. Every step reads
// the chain through the sdk (Fulcrum), builds with the sdk, and broadcasts with conflict retry.
//
//   node scripts/smoke.mjs        (after genesis.mjs run; uses the deployer key as the Satchel)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '@evermore/sdk';

const NET = 'chipnet';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dep = JSON.parse(fs.readFileSync(path.join(root, 'deployments', `${NET}.json`), 'utf8'));
const KEY_FILE = process.env.EVERMORE_KEY_FILE ?? 'C:\\Users\\LENOVO\\relic-launch\\keys\\evermore-chipnet-deployer.wif';
const me = process.env.EVERMORE_DEPLOYER_WIF ? E.Satchel.fromWif(process.env.EVERMORE_DEPLOYER_WIF) : E.Satchel.fromWif(fs.readFileSync(KEY_FILE, 'utf8').trim());
const game = E.gameFromDeployment(dep);
const chain = new E.Chain(NET);
const link = (t) => E.network(NET).explorerTx(t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAuthhead = (c) => c.txid === dep.authhead?.txid && c.vout === dep.authhead?.vout;
const coins = async () => (await chain.coins(me.lock)).filter((c) => !isAuthhead(c));

async function laneTx(label, make) {
  const avoid = [];
  const r = await chain.submit(async () => {
    const lanes = await chain.lanes(game);
    const l = E.pickLane(lanes, avoid);
    avoid.push(l.lane.lane);
    const draft = await make(l.utxo);
    return E.finalize(draft, { funding: me.inputs(await coins()), changeLock: me.lock });
  });
  console.log(`${label.padEnd(10)} ${link(r.txid)}${r.attempts > 1 ? ` (${r.attempts} attempts)` : ''}`);
  await sleep(1500);
  return r;
}

async function main() {
  console.log(`connected ${await chain.connect()}; player ${me.address(NET)}`);
  const r1 = await laneTx('raise', (lane) => E.raiseDraft(game, lane, 0, me.lock).draft);
  const r2 = await laneTx('raise', (lane) => E.raiseDraft(game, lane, 2, me.lock).draft);
  const hero = E.decodeHero(r1.built.outputs[1].token.nft.commitment);
  const foe = E.decodeHero(r2.built.outputs[1].token.nft.commitment);
  console.log(`heroes    #${hero.id} Knight, #${foe.id} Mage`);

  let ticketUtxo = null, moves = null;
  for (let t = 0; t < 12 && !moves; t++) {
    const c = await laneTx('challenge', async (lane) => E.challengeDraft(game, lane, (await chain.ghost(game, foe.id)).utxo, hero.id, me.lock).draft);
    const ticket = E.decodeTicket(c.built.outputs[3].token.nft.commitment);
    moves = E.solve(hero, ticket, E.seedOf(E.ticketSeedHash(ticket)));
    ticketUtxo = E.utxoOf({ txid: c.txid, outputs: c.built.outputs }, 3);
    if (!moves) console.log('           style not winnable; challenging again (every reroll is a paid challenge)');
  }
  if (!moves) throw new Error('no winnable style after 12 challenges');
  const f = await laneTx('forge', async (lane) => {
    const h = (await chain.holdings(game, me.lock)).heroes.find((x) => x.hero.id === hero.id);
    const g = await chain.ghost(game, foe.id);
    const own = await chain.ghost(game, hero.id);
    const counter = await chain.counter(game);
    return E.forgeDraft(game, { lane, hero: me.inputs([h.utxo])[0], ghost: g.utxo, ticket: me.inputs([ticketUtxo])[0], moves, ownGhost: own?.utxo, counter: counter?.utxo }).draft;
  });
  const after = E.decodeHero(f.built.outputs[1].token.nft.commitment);
  console.log(`hero #${hero.id}: L${hero.level} -> L${after.level}, xp ${after.xp}, wins ${after.wins}`);
  await chain.disconnect();
}
main().catch(async (e) => { console.error(e.message ?? e); await chain.disconnect().catch(() => {}); process.exit(1); });
