// /proof: reads the whole game state live from Bitcoin Cash in the visitor's browser and lists
// every claim with its receipt (a transaction or the contract line that enforces it).
import { Chain } from '../../sdk/src/chain.ts';
import { CLASS_NAMES, gameFromDeployment, lockToAddress, network, p2pkhLock } from '../../sdk/src/index.ts';
import type { Deployment, NetworkName } from '../../sdk/src/index.ts';

type Wardens = { category: string; labels: Record<string, string>; wardens: { id: number; name: string; level: number }[]; txs: { kind: string; txid: string; note: string }[] };
type Bazaar = { list?: string; buy?: string; sync?: string; cancel?: string };
type Smoke = { network: string; raise?: string; challenge?: string; forge?: string; reclaim?: string; sync?: string; heroId?: number };

const deployments = import.meta.glob('../../contracts/deployments/{chipnet,mainnet}.json', { eager: true, import: 'default' }) as Record<string, Deployment>;
const wardenFiles = import.meta.glob('../../contracts/deployments/wardens-{chipnet,mainnet}.json', { eager: true, import: 'default' }) as Record<string, Wardens>;
const smokeFiles = import.meta.glob('../../contracts/deployments/smoke-{chipnet,mainnet}.json', { eager: true, import: 'default' }) as Record<string, Smoke>;

const REPO = 'https://github.com/jenzylove/evermore/blob/main/';
const net: NetworkName = new URLSearchParams(location.search).get('net') === 'chipnet' ? 'chipnet' : 'mainnet';
const pick = <T>(m: Record<string, T>, name: string) => Object.entries(m).find(([p]) => p.endsWith(`/${name}.json`))?.[1];
const dep = pick(deployments, net)!;
const game = gameFromDeployment(dep);
const cfg = network(net);
const tx = (t: string) => cfg.explorerTx(t);
const wardens = pick(wardenFiles, `wardens-${net}`);
const W = wardens && wardens.category === dep.category ? wardens : null;
const smoke = pick(smokeFiles, `smoke-${net}`);
const bazaarFiles = import.meta.glob('../../contracts/deployments/bazaar-{chipnet,mainnet}.json', { eager: true, import: 'default' }) as Record<string, Bazaar>;
const bazaar = pick(bazaarFiles, `bazaar-${net}`);

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const bch = (sats: bigint | number) => (Number(sats) / 1e8).toLocaleString('en', { maximumFractionDigits: 6 });
const set = (id: string, v: string) => { const el = $(id); el.textContent = v; el.classList.remove('skel'); };

// ---------------------------------------------------------------- claims and receipts
type Link = { label: string; href: string; code?: boolean };
const claims: { title: string; body: string; links: Link[] }[] = [];
const code = (label: string, file: string): Link => ({ label, href: REPO + file, code: true });

claims.push({
  title: 'The game lives on Bitcoin Cash',
  body: `One genesis transaction created the Evermore token category, 16 forge lanes, the gear counter and the treasury rules. Category ${dep.category.slice(0, 12)}…`,
  links: [{ label: 'Genesis tx', href: tx(dep.genesisTxid ?? dep.category) }, code('Contracts', 'contracts/src/Lane.cash')],
});
const forges = W?.txs.filter((t) => t.kind === 'forge') ?? [];
const top = W ? [...W.wardens].sort((a, b) => b.level - a.level)[0] : null;
const topForge = top ? [...forges].reverse().find((t) => t.note.startsWith(`#${top.id} `)) : forges.at(-1);
claims.push({
  title: 'Every level is earned in a fight',
  body: 'Before a hero can level up, the forge contract replays the whole duel from both heroes’ stats and the moves played. A fake move list, or a lost fight claimed as a win, is rejected by the network.',
  links: [
    ...(topForge ? [{ label: top && /L(\d+)/.test(topForge.note) ? `${top.name} reaching L${topForge.note.match(/L(\d+)/)![1]}` : 'A Warden forge', href: tx(topForge.txid) }] : []),
    ...(smoke?.forge ? [{ label: 'A forge from the game', href: tx(smoke.forge) }] : []),
    code('Replay in script', 'contracts/src/Lane.cash'),
    code('Fake win rejected (test)', 'contracts/test/forge.test.mjs#L74'),
  ],
});
const chal = smoke?.challenge ?? W?.txs.find((t) => t.kind === 'challenge')?.txid;
claims.push({
  title: 'Keepers are paid on every challenge',
  body: `The challenge fee (${bch(BigInt(dep.challengeFee))} BCH) goes to the echo’s keeper inside the same transaction. The contract will not let a challenge through without that output.`,
  links: [...(chal ? [{ label: 'A challenge tx', href: tx(chal) }] : []), code('Fee rule', 'contracts/src/Lane.cash')],
});
claims.push({
  title: 'Fees follow the hero to its new owner',
  body: 'When a hero is sold or sent home, its echo’s keeper address moves with it in the same transaction, so the earnings always go to whoever holds the hero.',
  links: [...(smoke?.sync ? [{ label: 'A sync tx', href: tx(smoke.sync) }] : []), code('Sync test', 'contracts/test/sync-reclaim.test.mjs')],
});
claims.push({
  title: 'Heroes trade with no operator',
  body: 'A seller lists a hero at a price. Anyone can buy it: the hero and the money swap in one transaction, and the seller can take it back any time before. Nobody takes a cut.',
  links: [
    ...(bazaar?.list ? [{ label: 'List', href: tx(bazaar.list) }] : []),
    ...(bazaar?.buy ? [{ label: 'Buy', href: tx(bazaar.buy) }] : []),
    ...(bazaar?.cancel ? [{ label: 'Cancel', href: tx(bazaar.cancel) }] : []),
    code('Sale contract', 'contracts/src/Sale.cash'),
  ],
});
claims.push({
  title: 'Gear supply is capped forever',
  body: `Gear drops when you beat an echo 3 or more levels above you. The counter contract refuses to mint past ${Number(dep.gearCap).toLocaleString()} pieces. Nobody can raise the cap.`,
  links: [code('Counter contract', 'contracts/src/Counter.cash'), code('Cap test', 'contracts/test/forge.test.mjs#L127')],
});
claims.push({
  title: 'Nobody can take or delete a hero',
  body: 'There is no admin key and no freeze path in any contract. A hero is a CashToken in its holder’s wallet, and a sale is an atomic swap with no operator.',
  links: [code('Threat model', 'contracts/THREATS.md')],
});
claims.push({
  title: 'The browser and the chain agree, move for move',
  body: 'The duel you watch is simulated in your browser with the same rules the covenant enforces. 100 recorded duels are checked against the contract in the test suite.',
  links: [code('Parity test', 'contracts/test/parity.test.mjs'), code('Rules spec', 'docs/SPEC.md')],
});
claims.push({
  title: 'No server of ours',
  body: 'This page and the game are static files. They read the chain straight from public Bitcoin Cash servers. Anyone can host a copy and the arena keeps working.',
  links: [code('Source', 'README.md')],
});

$('claims').innerHTML = claims.map((c) => `<div class="claim"><div><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></div><div class="links">${
  c.links.map((l) => `<a${l.code ? ' class="code"' : ''} href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div></div>`).join('');

// ---------------------------------------------------------------- live state
async function read() {
  const live = $('live');
  const chain = new Chain(net);
  try {
    await chain.connect();
    const [height, lanes, ghosts, counter] = await Promise.all([chain.tip(), chain.lanes(game), chain.ghosts(game), chain.counter(game)]);
    live.querySelector('span')!.textContent = `Live from Bitcoin Cash ${net === 'chipnet' ? 'chipnet' : 'mainnet'} · block ${height.toLocaleString()}`;
    const raised = lanes.reduce((a, l) => a + l.lane.ctr, 0);
    const defences = ghosts.reduce((a, g) => a + g.ghost.defences, 0);
    const beaten = ghosts.reduce((a, g) => a + g.ghost.beaten, 0);
    set('s-heroes', raised.toLocaleString());
    set('s-duels', defences.toLocaleString());
    $('s-paid').textContent = `${bch(BigInt(defences) * BigInt(dep.challengeFee))} BCH to keepers (${bch(BigInt(dep.challengeFee))} per defence)`;
    set('s-wins', beaten.toLocaleString());
    set('s-gear', counter ? counter.minted.toLocaleString() : '0');
    $('s-cap').textContent = `of ${Number(dep.gearCap).toLocaleString()}, ever`;

    const labels = W?.labels ?? {};
    const rows = [...ghosts].sort((a, b) => b.ghost.level - a.ghost.level || b.ghost.defences - a.ghost.defences);
    $('arena').innerHTML = rows.map(({ utxo, ghost: g }) => {
      const name = labels[String(g.id)] ?? `Hero #${g.id}`;
      const keeper = lockToAddress(p2pkhLock(g.ownerPkh), cfg.prefix);
      return `<tr><td class="n">${g.level}</td><td>${esc(name)}<span class="cls">${CLASS_NAMES[g.cls] ?? ''}</span></td>` +
        `<td class="right">${g.defences}</td><td class="right">${g.beaten}</td>` +
        `<td class="right hide-s" title="${esc(keeper)}">${bch(BigInt(g.defences) * BigInt(dep.challengeFee))} BCH</td>` +
        `<td class="right"><a href="${esc(tx(utxo.txid))}" target="_blank" rel="noopener">${utxo.txid.slice(0, 8)}</a></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="note">The arena is empty.</td></tr>';
    $('arena-note').textContent = `${rows.length} echoes held by the arena contract. Each row is a live token; its latest transaction is the last time it fought.`;
  } catch (e) {
    live.classList.add('off');
    live.querySelector('span')!.textContent = 'Could not reach a Bitcoin Cash server. Nothing below is shown until it can be read.';
    $('arena').innerHTML = `<tr><td colspan="6" class="note err">${esc((e as Error).message)}</td></tr>`;
  } finally {
    chain.disconnect().catch(() => {});
  }
}
read();
