// Drives the real client in headless Chromium (WebGL on the real GPU) at phone and desktop sizes and saves screenshots.
// Run: node --experimental-strip-types scripts/shots.ts [baseUrl] [outDir]
import { chromium, type Page } from 'playwright';
import { solve, styleHash, seedOf, type Hero, type Ghost } from '../src/game/sim.ts';

const base = process.argv[2] ?? 'http://localhost:5190';
const out = process.argv[3] ?? 'C:/Users/LENOVO/relic-launch/shots3d';
const only = process.argv[4]; // 'phone' | 'desk'
// a fixed quality tier, so a slow headless frame rate does not step the look down mid run
const sizes = [
  { tag: 'phone', q: 1, ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { tag: 'desk', q: 2, ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false } },
].filter(s => !only || s.tag === only);
const errs: string[] = [];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function shot(p: Page, tag: string, name: string) { await p.screenshot({ path: `${out}/${tag}-${name}.png`, timeout: 60000 }); console.log(`${tag}-${name}`); }
async function click(p: Page, text: string) { await p.getByRole('button', { name: text }).first().click(); }
const ready = (p: Page) => p.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
const roundDone = (p: Page) => p.waitForSelector('.moves:not(.wait), .forge', { timeout: 20000 }).catch(() => {});
const duelReady = (p: Page) => p.waitForSelector('.moves:not(.wait)', { timeout: 20000 }).catch(() => {});

async function winningMoves(p: Page): Promise<number[] | null> {
  const t = await p.evaluate(async () => {
    const m = (window as any).__ev; const hero = await m.activeHero(); const tk = m.app.ticket;
    return { hero, ghost: tk.ghost, seed: tk.seed };
  });
  return solve(t.hero as Hero, { ...t.ghost, ownerPkh: new Uint8Array(20) } as Ghost, t.seed);
}
async function fight(p: Page, mv: number[], onMove?: (i: number, m: number) => Promise<void>) {
  for (let i = 0; i < mv.length; i++) {
    await p.locator('.moves .btn', { hasText: ['Strike', 'Guard', 'Special'][mv[i]] }).click();
    if (onMove) await onMove(i, mv[i]);
    if (i === mv.length - 1 && onMove) await onMove(-1, -1);
    await roundDone(p);
  }
}

for (const s of sizes) {
  const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(s.ctx);
  const p = await ctx.newPage();
  const url = (hash = '') => `${base}/?q=${s.q}${hash}`;
  p.on('pageerror', e => errs.push(`${s.tag}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errs.push(`${s.tag} console: ${m.text()}`); });
  await p.goto(url()); await ready(p);
  await p.evaluate(() => { localStorage.clear(); (window as any).__ev.practice.reset(); });
  await p.goto(url()); await ready(p);
  await wait(900); await shot(p, s.tag, '01-front-intro');
  await wait(3800); await shot(p, s.tag, '02-front');
  await click(p, 'Raise a hero'); await wait(2400); await shot(p, s.tag, '03-raise');
  await p.getByRole('button', { name: 'Mage' }).click(); await wait(1600); await shot(p, s.tag, '04-raise-mage');
  await p.getByRole('button', { name: 'Knight' }).click(); await wait(400);
  await p.fill('input.name', 'Ember');
  await p.getByRole('button', { name: /^Raise/ }).last().click(); await wait(700); await shot(p, s.tag, '05-raise-summon');
  await p.waitForFunction(() => location.hash === '#arena', null, { timeout: 15000 });
  await wait(3500); await shot(p, s.tag, '06-arena');
  await p.getByRole('button', { name: 'Walk right' }).click(); await wait(1600); await shot(p, s.tag, '07-arena-walk');
  await p.getByRole('button', { name: 'Walk left' }).click(); await wait(1200);
  // fight to a win using the solver (the ghost's moves are public)
  let won = false;
  for (let attempt = 0; attempt < 4 && !won; attempt++) {
    await p.getByRole('button', { name: /^Challenge/ }).click(); await wait(2400);
    if (attempt === 0) await shot(p, s.tag, '08-duel-intro');
    await duelReady(p);
    if (attempt === 0) await shot(p, s.tag, '08b-duel-ready');
    const mv = await winningMoves(p);
    if (!mv) { await p.goto(url('#arena')); await ready(p); await wait(1500); await p.getByRole('button', { name: 'Walk left' }).click(); await wait(1000); continue; }
    await fight(p, mv, async (i) => {
      if (i === 0) { await wait(650); await shot(p, s.tag, '09-duel-hit'); }
      if (i === 1) { await wait(650); await shot(p, s.tag, '10-duel-mid'); }
      if (i === -1) { await wait(1300); await shot(p, s.tag, '10b-ko-slowmo'); await wait(1500); await shot(p, s.tag, '10c-ko-down'); }
    });
    won = true;
    await wait(200); await shot(p, s.tag, '11-victory');
    await wait(3600); await shot(p, s.tag, '12-forge');
  }
  // a harder ghost: Special, level up and a gear drop, then win until level 3 so the new look shows
  if (s.tag === 'phone') {
    const pick = await p.evaluate(async () => { const m = (window as any).__ev; return { hero: await m.activeHero(), ghosts: await m.app.chain.listGhosts() }; });
    const cands = pick.ghosts.filter((g: any) => !g.mine && g.level >= pick.hero.level + 2).sort((a: any, b: any) => b.level - a.level);
    let target = cands[cands.length - 1];
    for (const g of cands) { if (solve(pick.hero, { ...g, ownerPkh: new Uint8Array(20) }, seedOf(styleHash(pick.hero.id, g)))) { target = g; break; } }
    console.log('hard target', target?.name, target?.level);
    await p.evaluate((id: number) => { const m = (window as any).__ev; m.app.focusGhost = id; m.go('arena'); }, target.id);
    await wait(3200); await shot(p, s.tag, '16-arena-hard');
    await p.getByRole('button', { name: /^Challenge/ }).click(); await wait(2400); await duelReady(p);
    const mv = await winningMoves(p);
    console.log('hard line', mv?.join(''));
    if (mv) {
      let sp = 0;
      await fight(p, mv, async (_i, m) => { if (m === 2 && !sp++) { await wait(450); await shot(p, s.tag, '17-special-buildup'); await wait(1100); await shot(p, s.tag, '18-special-hit'); } });
      await wait(8000); await shot(p, s.tag, '19-forge-levelup');
      await wait(1500); await shot(p, s.tag, '20-forge-gear');
    } else await p.evaluate(() => (window as any).__ev.go('arena'));
  }
  await click(p, 'Hero'); await wait(3000); await shot(p, s.tag, '13-hero');
  await click(p, 'Bazaar'); await wait(3000); await shot(p, s.tag, '14-bazaar');
  await p.locator('.pouch').click(); await wait(700); await shot(p, s.tag, '15-satchel');
  await ctx.close().catch(() => {});
}
console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
process.exit(0);
