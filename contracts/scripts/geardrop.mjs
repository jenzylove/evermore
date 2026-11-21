// Gear drop on the live game: a fresh level 1 hero challenges Wardens 3+ levels above it until
// a style it can beat comes up, then forges the win with the Counter, minting one capped gear piece.
//   node scripts/geardrop.mjs [--net chipnet|mainnet] [--dry]   (mainnet needs --broadcast-mainnet)
import fs from 'node:fs';
import path from 'node:path';
import { E, NET, DRY, link, loadKey, setup, root } from './lib.mjs';

const me = loadKey('deployer');
const { game, chain, laneTx } = setup(me);

async function main() {
  console.log(`connected ${await chain.connect()}; ${NET}`);
  const rec = { network: NET, tries: [] };
  for (const cls of [1, 2, 0]) {
    const r = await laneTx('raise', (lane) => E.raiseDraft(game, lane, cls, me.lock).draft);
    const hero = E.decodeHero(r.built.outputs[1].token.nft.commitment);
    rec.raise = r.txid;
    const targets = (await chain.ghosts(game)).map((g) => g.ghost).filter((g) => g.level >= hero.level + 3 && g.id !== hero.id).sort((a, b) => a.level - b.level);
    console.log(`hero #${hero.id} ${E.CLASS_NAMES[cls]} L1; targets ${targets.map((g) => `#${g.id} L${g.level}`).join(', ')}`);
    for (const t of targets.slice(0, 4)) {
      // preview first: the style seed is known before paying, so only pay for a winnable fight
      const g = (await chain.ghost(game, t.id)).ghost;
      const preview = E.ticketFor(hero.id, g);
      if (!E.solve(hero, preview, E.seedOf(E.ticketSeedHash(preview)))) { console.log(`  #${t.id} L${t.level}: not winnable, skip`); continue; }
      const c = await laneTx('challenge', async (lane) => {
        const d = E.challengeDraft(game, lane, (await chain.ghost(game, t.id)).utxo, hero.id, me.lock).draft;
        d.inputs.push(...me.inputs((await chain.holdings(game, me.lock)).tickets.map((x) => x.utxo)));
        return d;
      });
      const ticket = E.decodeTicket(c.built.outputs[3].token.nft.commitment);
      const moves = E.solve(hero, ticket, E.seedOf(E.ticketSeedHash(ticket)));
      if (!moves) { console.log('  style changed before the challenge landed; next'); continue; }
      const ticketUtxo = E.utxoOf({ txid: c.txid, outputs: c.built.outputs }, 3);
      const f = await laneTx('forge', async (lane) => {
        const h = (await chain.holdings(game, me.lock)).heroes.find((x) => x.hero.id === hero.id);
        return E.forgeDraft(game, { lane, hero: me.inputs([h.utxo])[0], ghost: (await chain.ghost(game, t.id)).utxo, ticket: me.inputs([ticketUtxo])[0], moves, ownGhost: (await chain.ghost(game, hero.id))?.utxo, counter: (await chain.counter(game))?.utxo, drop: true }).draft;
      });
      const gearOut = f.built.outputs.find((o) => o.token?.nft?.commitment?.[0] === 0x45);
      const gear = E.decodeGear(gearOut.token.nft.commitment);
      Object.assign(rec, { challenge: c.txid, forge: f.txid, heroId: hero.id, ghostId: t.id, ghostLevel: t.level, gear });
      console.log(`GEAR #${gear.id} kind ${gear.kind} tier ${gear.tier} minted in ${link(f.txid)}`);
      if (!DRY) fs.writeFileSync(path.join(root, 'deployments', `gear-${NET}.json`), JSON.stringify(rec, null, 2) + '\n');
      await chain.disconnect(); return;
    }
  }
  throw new Error('no winnable gear fight found');
}
main().catch(async (e) => { console.error(e.message ?? e); await chain.disconnect().catch(() => {}); process.exit(1); });
