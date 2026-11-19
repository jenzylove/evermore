// Drive the real page on chipnet: a pre-funded Satchel (WIF from a key file outside the repo)
// raises a hero through the Raise screen, challenges a ghost from the Arena, plays the winning
// moves on the duel buttons, and waits for the forge's explorer link.
//
//   node scripts/real-page.ts [base url]   (dev server running; EVERMORE_SATCHEL_FILE overrides the key)
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as E from '../../sdk/src/index.ts';

const base = process.argv[2] ?? 'http://localhost:5190';
const wif = fs.readFileSync(process.env.EVERMORE_SATCHEL_FILE ?? 'C:\\Users\\LENOVO\\relic-launch\\keys\\evermore-chipnet-test-satchel.wif', 'utf8').trim();
const shots = process.env.SHOTS_DIR ?? '';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('tx')) console.log('  [page]', m.text()); });
const fails: string[] = []; const ok = (c: boolean, m: string) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
const shot = async (n: string) => { if (shots) await p.screenshot({ path: `${shots}/${n}.png` }); };
const ev = <T>(f: string, arg?: unknown) => p.evaluate(([f, arg]) => new Function('m', 'arg', `return (async () => { ${f} })()`)((window as any).__ev, arg), [f, arg] as const) as Promise<T>;

await p.goto(base);
await p.evaluate((w) => { localStorage.clear(); localStorage.setItem('evermore.satchel.chipnet', w); localStorage.setItem('evermore.mode', 'real'); }, wif);
await p.reload();
await p.waitForFunction(() => (window as any).__ev && !document.getElementById('veil'), null, { timeout: 60000 });
ok(await ev<string>('return m.app.chain.mode;') === 'chipnet', 'page boots in real mode on chipnet');
const sat = await ev<{ sats: number; address: string }>('return await m.app.chain.satchel();');
ok(sat.sats > (process.env.EVERMORE_REUSE_HERO === '1' ? 30000 : 145000), `Satchel ${sat.address} holds ${sat.sats} sats (read from Fulcrum in the browser)`);

// connect sheet opens from the mode tag
await ev(`m.go('arena');`);
await p.locator('#chrome .tag').click();
await p.locator('[data-sheet=connect]').waitFor();
const shown = await p.waitForFunction((a) => document.querySelector('[data-sheet=connect]')?.textContent?.includes(a), sat.address, { timeout: 20000 }).then(() => true, () => false);
ok(shown, 'connect sheet shows the Satchel address');
await p.waitForTimeout(800); await shot('real-connect');
await p.locator('.sheet-bg').click({ position: { x: 20, y: 20 } });

// raise through the Raise screen (EVERMORE_REUSE_HERO=1 skips it and plays the first Satchel hero)
const reuse = process.env.EVERMORE_REUSE_HERO === '1';
const before = reuse ? [] : await ev<number[]>('return (await m.app.chain.myHeroes()).map(h => h.id);');
if (!reuse) {
await ev(`m.go('raise');`);
await p.locator('.classes button', { hasText: 'Rogue' }).click();
await p.locator('input.name').fill('Pagewalker');
await shot('real-raise');
await p.locator('.screen.raise .btn.prime').click();
const raiseTx = await p.locator('.tx-receipt').getAttribute('data-txid', { timeout: 90000 });
ok(!!raiseTx, `raise receipt https://chipnet.imaginary.cash/tx/${raiseTx}`);
await p.waitForTimeout(2500);
const heroes = await ev<any[]>('return await m.app.chain.myHeroes();');
const hero0 = heroes.find((h) => !before.includes(h.id));
ok(!!hero0 && hero0.name === 'Pagewalker' && hero0.cls === 1, `new hero #${hero0?.id} ${hero0?.name} in the Satchel`);
}
const hero = (await ev<any[]>('return await m.app.chain.myHeroes();')).filter((h) => h.where === 'satchel' && (reuse || !before.includes(h.id)))[0];
const wins0 = hero.wins;
await ev(`m.setHero(arg);`, hero.id);

// pick a ghost whose (covenant) style this hero can beat
const ghosts = await ev<any[]>('return await m.app.chain.listGhosts();');
let target: any = null, moves: number[] | null = null;
for (const g of ghosts.filter((g) => !g.mine)) {
  const seed = await ev<number>('return m.app.chain.styleSeed(arg.h, arg.g);', { h: hero.id, g });
  const mv = E.solve(hero, g, seed);
  if (mv) { target = g; moves = mv; break; }
}
ok(!!target, `winnable ghost: #${target?.id} (${moves?.length} rounds)`);
if (target) {
  await ev(`m.app.focusGhost = arg; m.go('arena');`, target.id);
  const btn = p.locator('.btn.spirit', { hasText: 'Challenge' });
  await btn.waitFor({ timeout: 60000 });
  // the preview on screen must be the covenant's style
  await shot('real-arena');
  await btn.click();
  await p.waitForFunction(() => document.body.dataset.route === 'duel', null, { timeout: 90000 });
  const t = await ev<any>('return m.app.ticket;');
  ok(!!t.receipt.txid, `challenge receipt ${t.receipt.explorer}`);
  const live = E.solve(hero, t.ghost, t.seed);
  ok(!!live, 'ticket style is winnable');
  const cls = ['strike', 'guard', 'special'];
  for (const m of live ?? []) {
    const mb = p.locator(`.moves:not(.wait) .btn.${cls[m]}`);
    await mb.waitFor({ timeout: 60000 });
    await mb.click();
    await p.waitForTimeout(300);
  }
  const seal = p.locator('.sealed a, a.seal').first();
  await seal.waitFor({ timeout: 120000 });
  const href = await seal.getAttribute('href');
  ok(!!href && href.startsWith('https://chipnet.imaginary.cash/tx/'), `forge sealed ${href}`);
  await p.waitForTimeout(1500);
  await shot('real-forge');
  let after: any = null;
  for (let i = 0; i < 10 && !(after?.wins > wins0); i++) { await p.waitForTimeout(2000); after = await ev<any>('return await m.app.chain.getHero(arg);', hero.id); }
  ok(after.wins === wins0 + 1 && after.xp > 0, `hero after forge: L${after.level} xp ${after.xp} wins ${after.wins}`);
}
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exit(fails.length ? 1 : 0);
