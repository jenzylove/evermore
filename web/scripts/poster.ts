// Captures the lit front door (no UI) as the stills the page shows before the 3D is up: public/poster-p.webp (phone,
// portrait) and public/poster-l.webp (wide). Run with the dev server up: node --experimental-strip-types scripts/poster.ts
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5190';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, vp, dpr, q] of [['p', { width: 430, height: 932 }, 1.5, 0.62], ['l', { width: 1600, height: 900 }, 1, 0.6]] as const) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: dpr });
  await p.goto(`${base}/?q=2`);
  await p.evaluate(() => { localStorage.clear(); });
  await p.goto(`${base}/?q=2`);
  await p.waitForFunction(() => document.body.dataset.world === 'ready', null, { timeout: 120000 });
  await p.addStyleTag({ content: '#ui, #chrome, #veil { display: none !important; }' });
  await p.waitForTimeout(2500);
  const jpg = (await p.screenshot({ type: 'png' })).toString('base64');
  const webp = await p.evaluate(async ([src, q]) => {
    const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0);
    return c.toDataURL('image/webp', q as number);
  }, [jpg, q] as const);
  const buf = Buffer.from(webp.split(',')[1], 'base64');
  fs.writeFileSync(`public/poster-${name}.webp`, buf); console.log(name, buf.length);
  await p.close();
}
await b.close();
