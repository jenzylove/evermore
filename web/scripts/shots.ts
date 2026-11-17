// Drives the real client in headless Chromium at phone and desktop sizes and saves screenshots.
// Run: node --experimental-strip-types scripts/shots.ts [baseUrl] [outDir]
import { chromium, type Page } from 'playwright';
import { solve, styleHash, seedOf, type Hero, type Ghost } from '../src/game/sim.ts';

const base = process.argv[2] ?? 'http://localhost:5190';
const out = process.argv[3] ?? 'C:/Users/LENOVO/relic-launch/shots';
const sizes = [
  { tag: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { tag: 'desk', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
const errs: string[] = [];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function shot(p: Page, tag: string, name: string) { await p.screenshot({ path: `${out}/${tag}-${name}.png` }); console.log(`${tag}-${name}`); }
async function click(p: Page, text: string) { await p.getByRole('button', { name: text }).first().click(); }

async function winningMoves(p: Page): Promise<number[] | null> {
  const t = await p.evaluate(async () => {
    const m = (window as any).__ev; const hero = await m.activeHero(); const tk = m.app.ticket;
    return { hero, ghost: tk.ghost, seed: tk.seed };
  });
  return solve(t.hero as Hero, { ...t.ghost, ownerPkh: new Uint8Array(20) } as Ghost, t.seed);
}

for (const s of sizes) {
  const b = await chromium.launch();
  const ctx = await b.newContext(s);
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${s.tag}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errs.push(`${s.tag} console: ${m.text()}`); });
  await p.goto(base);
  await wait(500); await shot(p, s.tag, '01-front-intro');
  await wait(2200); await shot(p, s.tag, '02-front');
  await click(p, 'Raise a hero'); await wait(900); await shot(p, s.tag, '03-raise');
  await p.getByRole('button', { name: 'Mage' }).click(); await wait(500); await shot(p, s.tag, '04-raise-mage');
  await p.getByRole('button', { name: 'Knight' }).click(); await wait(300);
  await p.fill('input.name', 'Ember');
  await p.getByRole('button', { name: /^Raise/ }).last().click(); await wait(500); await shot(p, s.tag, '05-raise-summon');
  await wait(1500); await shot(p, s.tag, '06-arena');
  await p.getByRole('button', { name: 'Walk right' }).click(); await wait(1200); await shot(p, s.tag, '07-arena-walk');
  await p.getByRole('button', { name: 'Walk left' }).click(); await wait(1000);
  // fight to a win using the solver (the ghost's moves are public)
  let won = false;
  for (let attempt = 0; attempt < 4 && !won; attempt++) {
    await p.getByRole('button', { name: /^Challenge/ }).click(); await wait(2000);
    if (attempt === 0) await shot(p, s.tag, '08-duel-start');
    const mv = await winningMoves(p);
    if (!mv) { await p.goto(base + '/#arena'); await wait(1200); await p.getByRole('button', { name: 'Walk left' }).click(); await wait(800); continue; }
    for (let i = 0; i < mv.length; i++) {
      const name = ['Strike', 'Guard', 'Special'][mv[i]];
      await p.locator('.moves .btn', { hasText: name }).click();
      if (i === 0) { await wait(380); await shot(p, s.tag, '09-duel-hit'); }
      await p.waitForSelector('.moves:not(.wait)', { timeout: 8000 }).catch(() => {});
      if (i === 1) await shot(p, s.tag, '10-duel-mid');
    }
    won = true;
    await wait(700); await shot(p, s.tag, '11-victory');
    await wait(3200); await shot(p, s.tag, '12-forge');
  }
  // a harder ghost (level 4 Mage, three above): Special, level up and a gear drop
  if (s.tag === 'phone') {
    const pick = await p.evaluate(async () => { const m = (window as any).__ev; return { hero: await m.activeHero(), ghosts: await m.app.chain.listGhosts() }; });
    const cands = pick.ghosts.filter((g: any) => !g.mine && g.level >= pick.hero.level + 2).sort((a: any, b: any) => b.level - a.level);
    let target = cands[cands.length - 1];
    for (const g of cands) { if (solve(pick.hero, { ...g, ownerPkh: new Uint8Array(20) }, seedOf(styleHash(pick.hero.id, g)))) { target = g; break; } }
    console.log('hard target', target?.name, target?.level);
    await p.evaluate((id: number) => { const m = (window as any).__ev; m.app.focusGhost = id; m.go('arena'); }, target.id);
    await wait(1500); await shot(p, s.tag, '16-arena-hard');
    await p.getByRole('button', { name: /^Challenge/ }).click(); await wait(2000);
    const mv = await winningMoves(p);
    console.log('hard line', mv?.join(''));
    if (mv) {
      for (let i = 0; i < mv.length; i++) {
        await p.locator('.moves .btn', { hasText: ['Strike', 'Guard', 'Special'][mv[i]] }).click();
        if (mv[i] === 2) { await wait(300); await shot(p, s.tag, '17-special-buildup'); await wait(330); await shot(p, s.tag, '18-special-hit'); }
        await p.waitForSelector('.moves:not(.wait)', { timeout: 9000 }).catch(() => {});
      }
      await wait(4200); await shot(p, s.tag, '19-forge-levelup');
      await wait(1500); await shot(p, s.tag, '20-forge-gear');
    } else await p.evaluate(() => (window as any).__ev.go('arena'));
    // one more win to cross the level line
    for (let k = 0; k < 8; k++) {
      await p.evaluate((id: number) => { const m = (window as any).__ev; m.app.focusGhost = id; m.go('arena'); }, 100 + 7 * (k % 4));
      await wait(1200);
      await p.getByRole('button', { name: /^Challenge/ }).click(); await wait(1800);
      const mv2 = await winningMoves(p);
      if (!mv2) continue;
      for (const m2 of mv2) { await p.locator('.moves .btn', { hasText: ['Strike', 'Guard', 'Special'][m2] }).click(); await p.waitForSelector('.moves:not(.wait)', { timeout: 9000 }).catch(() => {}); }
      await wait(4300);
      if (await p.locator('.lvup').count()) { await shot(p, s.tag, '21-forge-levelup'); break; }
    }
  }
  await click(p, 'Hero'); await wait(1000); await shot(p, s.tag, '13-hero');
  await click(p, 'Bazaar'); await wait(1000); await shot(p, s.tag, '14-bazaar');
  await p.locator('.pouch').click(); await wait(500); await shot(p, s.tag, '15-satchel');
  await b.close();
}
console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
