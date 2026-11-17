import './styles.css';
import { loadSheet, R } from './gfx/atlas';
import { stage } from './gfx/stage';
import { armAudio, go, type Route } from './app';
import './ui/front';
import './ui/raise';
import './ui/arena';
import './ui/duel';
import './ui/hero';
import './ui/bazaar';

async function boot() {
  stage.mount(document.getElementById('world') as HTMLCanvasElement);
  await Promise.all([loadSheet(), document.fonts.load('700 20px Pixelify'), document.fonts.load('400 20px Pixelify'), document.fonts.load('600 20px Pixelify')]);
  // favicon from the knight's first idle frame
  const r = R.knight_m_idle, c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
  x.drawImage((await import('./gfx/atlas')).sheet.img, r[0], r[1] + 6, 16, 16, 0, 0, 32, 32);
  const link = document.createElement('link'); link.rel = 'icon'; link.href = c.toDataURL(); document.head.append(link);
  armAudio();
  const r0 = (location.hash.slice(1) || 'front') as Route;
  go(['raise', 'arena', 'hero', 'bazaar'].includes(r0) ? r0 : 'front', false);
}
boot();

// dev only handle for the headless driver (stripped from production builds)
if (import.meta.env.DEV) import('./app').then(m => { (window as unknown as Record<string, unknown>).__ev = m; });
