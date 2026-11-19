// Bakes the hall's code made textures (floor, columns, grain) to WebP in public/tex, so the client loads them instead
// of computing them. Run with the dev server up: node --experimental-strip-types scripts/bake-textures.ts [devUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5190';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(`${base}/?nofx`);
const out = await p.evaluate(async () => {
  const m = await import('/src/three/arena.ts' as string);
  const c = m.bakeCanvases() as Record<string, HTMLCanvasElement>;
  const q: Record<string, number> = { floor: 0.9, column: 0.85, grain: 0.8 };
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.toDataURL('image/webp', q[k])]));
});
for (const [k, v] of Object.entries(out)) {
  const buf = Buffer.from((v as string).split(',')[1], 'base64');
  fs.writeFileSync(`public/tex/${k}.webp`, buf); console.log(k, buf.length);
}
await b.close();
