// Load timing in headless Chromium with a mid phone profile: 4x CPU slowdown and a slow 4G link (1.6 Mbps down, 150 ms RTT).
// Reports first paint, when the front door can be tapped, when the 3D hall is on screen, the boot's own measures
// (shader warmup, model load), main thread blocking and bytes over the wire.
// Run: node --experimental-strip-types scripts/loadtime.ts <url> [runs] [phone|desk]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173';
const runs = Number(process.argv[3] ?? 2);
const kind = process.argv[4] ?? 'phone';
const phone = kind === 'phone';

const rows: Record<string, number>[] = [];
for (let r = 0; r < runs; r++) {
  const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (phone) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => { bytes += e.encodedDataLength; });
  await p.addInitScript(() => {
    (window as any).__lt = { tbt: 0, long: 0 };
    new PerformanceObserver(l => { for (const e of l.getEntries()) { (window as any).__lt.tbt += Math.max(0, e.duration - 50); (window as any).__lt.long = Math.max((window as any).__lt.long, e.duration); } }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'commit' });
  // front door tappable: a visible CTA button that nothing covers
  const tap = p.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find(x => /raise a hero|practice|play for real/i.test(x.textContent || '')) as HTMLElement | undefined;
    if (!b) return false;
    const r = b.getBoundingClientRect(); if (!r.width || getComputedStyle(b).visibility === 'hidden') return false;
    let o: HTMLElement | null = b; while (o) { if (Number(getComputedStyle(o).opacity) < 0.9) return false; o = o.parentElement; }
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && (top === b || b.contains(top));
  }, null, { timeout: 180000, polling: 50 }).then(() => Date.now() - t0);
  const world = p.waitForFunction(() => !document.getElementById('veil') || document.body.dataset.world === 'ready', null, { timeout: 180000, polling: 50 }).then(() => Date.now() - t0);
  const [tTap, tWorld] = await Promise.all([tap, world]);
  await p.waitForTimeout(phone ? 6000 : 3000);
  const m = await p.evaluate(() => {
    const ms = (n: string) => Math.round(performance.getEntriesByName(n).reduce((a, e) => a + e.duration, 0));
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1;
    return { fcp: Math.round(fcp), warm: ms('warm'), kits: ms('kits'), arena: ms('arena'), mount: ms('mount'), tbt: Math.round((window as any).__lt.tbt), longest: Math.round((window as any).__lt.long) };
  });
  rows.push({ run: r + 1, ...m, tappable: tTap, hall: tWorld, kb: Math.round(bytes / 1024) });
  await b.close();
}
console.table(rows);
const med = (k: string) => { const v = rows.map(x => x[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
console.log(JSON.stringify({ url, kind, fcp: med('fcp'), tappable: med('tappable'), hall: med('hall'), warm: med('warm'), kits: med('kits'), arena: med('arena'), tbt: med('tbt'), longest: med('longest'), kb: med('kb') }));
