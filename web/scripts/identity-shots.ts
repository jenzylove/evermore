// Drives the real client in headless Chromium (WebGL on the real GPU) through the moments that carry Evermore's look:
// the front door, the hall of ghosts, a duel hit, a ghost shattering, the Forge level up and the hero card.
// Run: node --experimental-strip-types scripts/identity-shots.ts [baseUrl] [outDir] [phone|desk]
import { chromium, type Page } from 'playwright';
import { solve, styleHash, seedOf, type Hero, type Ghost } from '../src/game/sim.ts';

const base = process.argv[2] ?? 'http://localhost:5190';
const out = process.argv[3] ?? 'C:/Users/LENOVO/relic-launch/shots-identity';
const only = process.argv[4];
const sizes = [
  { tag: 'phone', q: 1, ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { tag: 'desk', q: 2, ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false } },
].filter(s => !only || s.tag === only);
const errs: string[] = [];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function shot(p: Page, tag: string, name: string) { await p.screenshot({ path: `${out}/${tag}-${name}.png`, timeout: 60000 }); console.log(`${tag}-${name}`); }
const ready = (p: Page) => p.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
const duelReady = (p: Page) => p.waitForSelector('.moves:not(.wait)', { timeout: 20000 }).catch(() => {});
const roundDone = (p: Page) => p.waitForSelector('.moves:not(.wait), .forge', { timeout: 20000 }).catch(() => {});

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
  await wait(4600); await shot(p, s.tag, '01-front');
  // a knight one win short of level 5, so the Forge has pieces to bring in
  await p.evaluate(async () => {
    const m = (window as any).__ev; await m.app.chain.raise(0, 'Ember');
    const st = m.practice.s; const h = st.heroes[0]; Object.assign(h, { level: 4, xp: 79, hp: 84, atk: 15, def: 11, spd: 5 }); m.practice.save();
    m.go('arena');
  });
  await wait(3800); await shot(p, s.tag, '02-arena');
  await p.getByRole('button', { name: 'Walk right' }).click(); await wait(1700); await shot(p, s.tag, '03-arena-walk');
  // pick a ghost this hero can beat
  const pick = await p.evaluate(async () => { const m = (window as any).__ev; return { hero: await m.activeHero(), ghosts: await m.app.chain.listGhosts() }; });
  const cands = pick.ghosts.filter((g: any) => !g.mine).sort((a: any, b: any) => b.level - a.level);
  let target: any = null;
  for (const g of cands) { if (solve(pick.hero as Hero, { ...g, ownerPkh: new Uint8Array(20) } as Ghost, seedOf(styleHash(pick.hero.id, g)))) { target = g; break; } }
  console.log('target', target?.name, target?.level);
  await p.evaluate((id: number) => { const m = (window as any).__ev; m.app.focusGhost = id; m.go('arena'); }, target.id);
  await wait(3200); await shot(p, s.tag, '04-arena-target');
  await p.getByRole('button', { name: /^Challenge/ }).click();
  await wait(2900); await shot(p, s.tag, '05-duel-meet');
  await duelReady(p); await wait(300); await shot(p, s.tag, '06-duel-ready');
  const t = await p.evaluate(async () => { const m = (window as any).__ev; return { hero: await m.activeHero(), ghost: m.app.ticket.ghost, seed: m.app.ticket.seed }; });
  const mv = solve(t.hero as Hero, { ...t.ghost, ownerPkh: new Uint8Array(20) } as Ghost, t.seed)!;
  console.log('line', mv.join(''));
  for (let i = 0; i < mv.length; i++) {
    await p.locator('.moves .btn', { hasText: ['Strike', 'Guard', 'Special'][mv[i]] }).click();
    if (i === 0) { await wait(600); await shot(p, s.tag, '07-duel-hit'); }
    if (i === mv.length - 1) {
      // the final blow and the shatter, as a burst
      // game time slowed only while the burst is captured, so a slow headless screenshot still lands mid effect
      await wait(700); await p.evaluate(() => { (window as any).__3.engine.slow = 0.25; });
      for (let k = 0; k < 8; k++) { await wait(150); await shot(p, s.tag, `08-shatter-${k}`); }
      await p.evaluate(() => { (window as any).__3.engine.slow = 1; });
    }
    await roundDone(p);
  }
  await p.evaluate(() => { (window as any).__3.engine.slow = 0.4; });
  for (let k = 0; k < 10; k++) { await wait(500); await shot(p, s.tag, `09-forge-${k}`); }
  await p.evaluate(() => { (window as any).__3.engine.slow = 1; });
  await p.waitForSelector('.forge .row .btn', { timeout: 20000 }).catch(() => {});
  await wait(1600); await shot(p, s.tag, '10-forge-done');
  await p.getByRole('button', { name: 'Hero' }).first().click(); await wait(3000); await shot(p, s.tag, '11-hero');
  await ctx.close().catch(() => {}); await b.close().catch(() => {});
}
console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
process.exit(0);
