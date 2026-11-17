// End to end check of the practice loop in a real browser: raise, challenge, forge (XP, level up, gear drop),
// forge refuses a losing move list, list, buy, cancel, send home.
import { chromium } from 'playwright';
import { solve, styleHash, seedOf } from '../src/game/sim.ts';
const base = process.argv[2] ?? 'http://localhost:5190';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] }); const p = await b.newPage();
await p.goto(base); await p.waitForFunction(() => (window as any).__ev);
const ev = (f: string, arg?: unknown) => p.evaluate(([f, arg]) => new Function('m', 'arg', `return (async () => { ${f} })()`)((window as any).__ev, arg), [f, arg] as const);
const fails: string[] = []; const ok = (c: boolean, m: string) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };

await ev(`m.practice.reset(); localStorage.clear();`);
// find a hero that can beat a ghost 3+ levels above it
let found: any = null;
for (let tries = 0; tries < 40 && !found; tries++) {
  const r: any = await ev(`const x = await m.app.chain.raise(tries % 3, 'T' + arg); return { hero: x.hero, ghosts: await m.app.chain.listGhosts() };`.replace('tries', String(tries)), tries);
  for (const g of r.ghosts.filter((g: any) => !g.mine && g.level >= 4 && g.level <= 6)) {
    const mv = solve(r.hero, { ...g, ownerPkh: new Uint8Array(20) }, seedOf(styleHash(r.hero.id, g)));
    if (mv) { found = { hero: r.hero, g, mv }; break; }
  }
  if (tries % 5 === 4) await ev(`await m.app.chain.fund(50000000);`);
}
ok(!!found, 'a level 1 hero can beat some level 4 to 6 ghost');
if (found) {
  const t: any = await ev(`return await m.app.chain.challenge(arg.h, arg.g);`, { h: found.hero.id, g: found.g.id });
  ok(t.receipt.txid === null && t.receipt.explorer === null, 'practice receipts carry no txid or link');
  const bad = await ev(`try { await m.app.chain.forge(arg.t, [1]); return 'accepted'; } catch (e) { return e.message; }`, { t });
  ok(bad !== 'accepted', 'forge refuses a move list that does not win');
  const res: any = await ev(`return await m.app.chain.forge(arg.t, arg.mv);`, { t, mv: found.mv });
  ok(res.xpGain > 0, `xp gained ${res.xpGain}`);
  ok(res.levelled === res.hero.level > 1, `levelled=${res.levelled} level ${res.hero.level}`);
  ok(!!res.gear, `gear dropped ${JSON.stringify(res.gear)}`);
  const again = await ev(`try { await m.app.chain.forge(arg.t, arg.mv); return 'accepted'; } catch (e) { return e.message; }`, { t, mv: found.mv });
  ok(again !== 'accepted', 'a ticket forges only once');
  await ev(`await m.app.chain.list('hero', arg, 1000000);`, found.hero.id);
  const mine: any = await ev(`return (await m.app.chain.listings()).filter(l => l.mine).length;`);
  ok(mine === 1, 'listed hero shows in the bazaar');
  await ev(`const l = (await m.app.chain.listings()).find(l => l.mine); await m.app.chain.cancel(l.id);`);
  const buy: any = await ev(`const l = (await m.app.chain.listings()).find(l => !l.mine && l.kind === 'hero'); await m.app.chain.buy(l.id); return (await m.app.chain.myHeroes()).some(h => h.id === l.hero.id);`);
  ok(buy, 'bought hero lands in the satchel');
  const home: any = await ev(`await m.app.chain.sendHome(arg); return (await m.app.chain.getHero(arg)).where;`, found.hero.id);
  ok(home === 'home', 'send home moves the hero');
}
console.log(fails.length ? `${fails.length} failed` : 'all passed');
// exit without b.close(): with the GPU on, Chromium can hang on close in headless runs
process.exit(fails.length ? 1 : 0);
