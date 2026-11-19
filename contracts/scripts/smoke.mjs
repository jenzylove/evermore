// Smoke run against the deployed game: raise two heroes, challenge one hero's ghost with the
// other (each re-challenge burns the previous, lost ticket in the same tx), forge the win,
// reclaim a stale ticket on its own, and sync: move a hero to another key with its ghost's
// fees following it in the same tx. Every step reads the chain through the sdk, builds with
// the sdk, and broadcasts with conflict retry.
//
//   node scripts/smoke.mjs [--net chipnet|mainnet] [--dry]
//   (--dry: in memory chain, every tx VM verified, nothing broadcast; mainnet requires --dry
//    or --broadcast-mainnet)
import { E, NET, DRY, link, loadKey, setup } from './lib.mjs';

const me = loadKey('deployer');
const { game, chain, coins, send, laneTx, fabricated } = setup(me);
const other = DRY ? E.Satchel.generate() : loadKey('test-buyer');

async function main() {
  console.log(`connected ${await chain.connect()}; ${NET}${fabricated ? ' (fabricated deployment)' : ''}; player ${me.address(NET)}`);
  console.log(`fees      raise ${game.params.raisePrice}, challenge ${game.params.challengeFee}, forge ${game.params.forgeFee}`);
  const r1 = await laneTx('raise', (lane) => E.raiseDraft(game, lane, 0, me.lock).draft);
  const r2 = await laneTx('raise', (lane) => E.raiseDraft(game, lane, 2, me.lock).draft);
  const hero = E.decodeHero(r1.built.outputs[1].token.nft.commitment);
  const foe = E.decodeHero(r2.built.outputs[1].token.nft.commitment);
  console.log(`heroes    #${hero.id} Knight, #${foe.id} Mage`);

  let ticketUtxo = null, moves = null;
  for (let t = 0; t < 12 && !moves; t++) {
    const c = await laneTx('challenge', async (lane) => {
      const d = E.challengeDraft(game, lane, (await chain.ghost(game, foe.id)).utxo, hero.id, me.lock).draft;
      // auto sweep: the previous (lost) ticket rides along and is burned, its sats reclaimed
      d.inputs.push(...me.inputs((await chain.holdings(game, me.lock)).tickets.map((x) => x.utxo)));
      return d;
    });
    const ticket = E.decodeTicket(c.built.outputs[3].token.nft.commitment);
    moves = E.solve(hero, ticket, E.seedOf(E.ticketSeedHash(ticket)));
    ticketUtxo = E.utxoOf({ txid: c.txid, outputs: c.built.outputs }, 3);
    if (!moves) console.log('           style not winnable; challenging again (the lost ticket is burned in the next challenge)');
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

  // reclaim on its own: Mage challenges the Knight, walks away, burns the ticket
  await laneTx('challenge', async (lane) => E.challengeDraft(game, lane, (await chain.ghost(game, hero.id)).utxo, foe.id, me.lock).draft);
  const stale = (await chain.holdings(game, me.lock)).tickets.map((x) => x.utxo);
  const rc = E.finalize(E.reclaimDraft(game, me.inputs(stale)), { funding: me.inputs(await coins()), changeLock: me.lock });
  console.log(`reclaim    ${link(await send(rc))} (${stale.length} ticket(s) burned, sats back)`);

  // sync: the Mage moves to another key and its ghost's fees follow it in the same tx
  const s = await laneTx('sync', async (lane) => {
    const h = (await chain.holdings(game, me.lock)).heroes.find((x) => x.hero.id === foe.id);
    return E.syncDraft(game, { lane, hero: me.inputs([h.utxo])[0], ownGhost: (await chain.ghost(game, foe.id)).utxo, toLock: other.lock }).draft;
  });
  const g = E.decodeGhost(s.built.outputs[2].token.nft.commitment);
  console.log(`ghost #${foe.id} now pays ${E.lockToAddress(E.p2pkhLock(g.ownerPkh), game.cfg.prefix)} (the hero's new holder)`);
  await chain.disconnect();
}
main().catch(async (e) => { console.error(e.message ?? e); await chain.disconnect().catch(() => {}); process.exit(1); });
