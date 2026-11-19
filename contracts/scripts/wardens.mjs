// Wardens: 12 labelled house heroes (classes mixed) levelled to a ladder of levels 1 to 8 by
// forging real duels among themselves, so a new player meets varied opponents and has ghosts
// 3+ levels above them (gear drops reachable). Every duel is an ordinary challenge + forge
// that the Lane covenant replays; nothing is minted at a level it did not earn.
//
//   node scripts/wardens.mjs [--net chipnet|mainnet] [--dry]
//
// The deployer key raises and holds the wardens, so challenge and forge fees go back to the
// treasury and the run costs only transaction fees and dust. Choice of each duel: every
// (warden below its target, other ghost) pair is previewed with the covenant seed and solved;
// the pair with the most XP is challenged and forged. Wardens do not take gear (no Counter
// passed): the capped supply stays for players.
//
// Progress and every txid go to deployments/wardens-<net>.json (re-run to resume). Its
// `labels` map (hero id -> name) is the same shape the client keeps in localStorage
// (evermore.names.<net>) and the client merges it, so everyone sees the wardens by name.
import fs from 'node:fs';
import path from 'node:path';
import { E, NET, DRY, link, loadKey, setup, root } from './lib.mjs';

const me = loadKey('deployer');
const { game, chain, laneTx, coins, fabricated } = setup(me);
const outFile = path.join(root, 'deployments', `wardens-${NET}${DRY ? '-dry' : ''}.json`);

const ROSTER = [
  ['Aldric', 0, 8], ['Brenna', 1, 7], ['Corvin', 2, 6], ['Dagny', 0, 5], ['Edric', 1, 4], ['Fenna', 2, 4],
  ['Garrick', 0, 3], ['Hester', 1, 3], ['Isolde', 2, 2], ['Joren', 0, 2], ['Kestra', 1, 1], ['Lucan', 2, 1],
];

const state = !DRY && fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8'))
  : { network: NET, category: game.params.category, wardens: [], labels: {}, txs: [] };
if (state.category !== game.params.category) throw new Error(`${outFile} is for another deployment (${state.category}); move it away to start over`);
const save = () => { if (!DRY) fs.writeFileSync(outFile, JSON.stringify(state, null, 2) + '\n'); };
const log = (kind, r, note = '') => { state.txs.push({ kind, txid: r.txid, ...(note ? { note } : {}) }); save(); };

async function main() {
  console.log(`connected ${await chain.connect()}; ${NET}${fabricated ? ' (fabricated deployment)' : ''}; deployer ${me.address(NET)}`);
  const startBal = (await coins()).reduce((a, c) => a + c.satoshis, 0n);

  // 1. raise the roster (skips ones already raised)
  for (const [name, cls, target] of ROSTER) {
    if (state.wardens.find((w) => w.name === `Warden ${name}`)) continue;
    const r = await laneTx(`raise ${name}`, (lane) => E.raiseDraft(game, lane, cls, me.lock).draft);
    const h = E.decodeHero(r.built.outputs[1].token.nft.commitment);
    state.wardens.push({ id: h.id, name: `Warden ${name}`, cls, target });
    state.labels[h.id] = `Warden ${name}`;
    log('raise', r, `#${h.id} ${name}`);
  }
  const ids = new Set(state.wardens.map((w) => w.id));

  // 2. duel until every warden stands at its target level
  for (let step = 0; step < 600; step++) {
    const held = (await chain.holdings(game, me.lock)).heroes.filter((x) => ids.has(x.hero.id));
    const ghosts = (await chain.ghosts(game)).filter((g) => ids.has(g.ghost.id));
    const below = held.filter((x) => x.hero.level < state.wardens.find((w) => w.id === x.hero.id).target);
    if (!below.length) break;
    let best = null;
    for (const x of below) for (const g of ghosts) {
      if (g.ghost.id === x.hero.id) continue;
      const t = E.ticketFor(x.hero.id, g.ghost);
      const moves = E.solve(x.hero, t, E.seedOf(E.ticketSeedHash(t)));
      if (!moves) continue;
      const o = E.forgeOutcome(x.hero, t, g.ghost.beaten, moves);
      // favour the wardens furthest from their target, then XP
      const need = state.wardens.find((w) => w.id === x.hero.id).target - x.hero.level;
      const score = o.gain + need * 4;
      if (!best || score > best.score) best = { score, x, g, moves, gain: o.gain };
    }
    if (!best) throw new Error('no winnable warden duel left; add another warden or widen the solver');
    const { x, g } = best;
    const c = await laneTx('', async (lane) => {
      const live = await chain.ghost(game, g.ghost.id);
      const d = E.challengeDraft(game, lane, live.utxo, x.hero.id, me.lock).draft;
      d.inputs.push(...me.inputs((await chain.holdings(game, me.lock)).tickets.map((y) => y.utxo))); // stale tickets, if any
      return d;
    });
    const ticket = E.decodeTicket(c.built.outputs[3].token.nft.commitment);
    log('challenge', c, `#${x.hero.id} vs #${g.ghost.id}`);
    let gain = 0, from = x.hero, f = null;
    try {
      f = await laneTx('', async (lane) => {
      // re-read and re-solve with the live hero (Fulcrum can lag a moment behind our last forge)
      const h = (await chain.holdings(game, me.lock)).heroes.find((y) => y.hero.id === x.hero.id);
      from = h.hero;
      const moves = E.solve(h.hero, ticket, E.seedOf(E.ticketSeedHash(ticket)));
      if (!moves) throw new Error('UNWINNABLE');
      gain = E.forgeOutcome(h.hero, ticket, (await chain.ghost(game, g.ghost.id)).ghost.beaten, moves).gain;
      const tk = (await chain.holdings(game, me.lock)).tickets.find((y) => y.utxo.txid === c.txid) ?? { utxo: E.utxoOf({ txid: c.txid, outputs: c.built.outputs }, 3) };
      return E.forgeDraft(game, {
        lane, hero: me.inputs([h.utxo])[0], ghost: (await chain.ghost(game, g.ghost.id)).utxo, ticket: me.inputs([tk.utxo])[0], moves,
        ownGhost: (await chain.ghost(game, x.hero.id))?.utxo, drop: false,
      }).draft;
      });
    } catch (e) {
      if (!String(e?.message).includes('UNWINNABLE')) throw e;
      console.log(`    #${x.hero.id} cannot beat this style after all; the ticket is burned in the next challenge`);
      continue;
    }
    const after = E.decodeHero(f.built.outputs[1].token.nft.commitment);
    log('forge', f, `#${x.hero.id} L${after.level} xp ${after.xp}`);
    const w = state.wardens.find((y) => y.id === x.hero.id);
    console.log(`${String(step).padStart(3)} ${w.name.padEnd(15)} beat #${String(g.ghost.id).padEnd(3)} L${g.ghost.level} +${gain} xp -> L${after.level}${after.level > from.level ? ' LEVEL UP' : ''}  ${link(f.txid)}`);
  }

  const held = (await chain.holdings(game, me.lock)).heroes.filter((x) => ids.has(x.hero.id));
  for (const w of state.wardens) w.level = held.find((x) => x.hero.id === w.id)?.hero.level ?? null;
  save();
  const endBal = (await coins()).reduce((a, c) => a + c.satoshis, 0n);
  console.log('\nladder:', state.wardens.map((w) => `${w.name} #${w.id} ${E.CLASS_NAMES[w.cls]} L${w.level}`).join(', '));
  console.log(`${state.txs.length} txs, cost ${startBal - endBal} sats (tx fees + 2,000 sats dust per warden; fees went back to the treasury)${DRY ? '' : `\nwrote ${path.relative(root, outFile)}`}`);
  await chain.disconnect();
}
main().catch(async (e) => { console.error(e.stack ?? e); save(); await chain.disconnect().catch(() => {}); process.exit(1); });
