// Progression check: the same hero on the Hero screen at levels 1, 3, 5, 7 and 10, with and without gear.
// Practice storage only (the save is edited in the test browser), so it proves the look, not the rules.
// Run: node --experimental-strip-types scripts/looks.ts [baseUrl] [outDir] [phone|desk]
import { chromium } from 'playwright';
import { grown } from '../src/game/sim.ts';

const base = process.argv[2] ?? 'http://localhost:5190';
const out = process.argv[3] ?? 'C:/Users/LENOVO/relic-launch/shots3d';
const tag = process.argv[4] ?? 'desk';
const phone = tag === 'phone';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const url = `${base}/?q=${phone ? 1 : 2}#hero`;
await p.goto(url, { timeout: 90000 }); await p.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
const classes = process.argv[5] ? process.argv[5].split(',').map(Number) : [0, 1, 2];
for (const cls of classes) for (const [level, gear] of [[1, 0], [3, 0], [5, 1], [7, 2], [10, 3]] as const) {
  await p.evaluate(({ cls, level, gear, stats }) => {
    const m = (window as any).__ev;
    m.practice.reset();
    const s = JSON.parse(localStorage.getItem('evermore.practice.v1') ?? '{}');
    s.heroes = [{ id: 4242, cls, level, xp: 3, ...stats, wins: level * 3, name: 'Ember', defences: 0, beaten: 0, earned: 0, where: 'satchel' }];
    s.gear = [];
    if (gear >= 1) s.gear.push({ id: 1, kind: 0, tier: Math.min(3, gear), where: 'satchel' });
    if (gear >= 2) s.gear.push({ id: 2, kind: 2, tier: 2, where: 'satchel' });
    if (gear >= 3) s.gear.push({ id: 3, kind: 1, tier: 3, where: 'satchel' });
    localStorage.setItem('evermore.practice.v1', JSON.stringify(s));
    localStorage.setItem('evermore.hero', '4242');
  }, { cls, level, gear, stats: grown(cls, level) });
  await p.reload({ timeout: 90000 }); await p.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
  await p.waitForTimeout(3200);
  await p.screenshot({ path: `${out}/${tag}-look-${['knight', 'rogue', 'mage'][cls]}-L${String(level).padStart(2, '0')}.png`, timeout: 60000 });
  console.log(cls, level);
}
await p.evaluate(() => { (window as any).__ev.practice.reset(); localStorage.clear(); });
process.exit(0);
