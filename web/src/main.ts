import './styles.css';
import { world } from './three/world';
import { armAudio, go, type Route } from './app';
import './ui/front';
import './ui/raise';
import './ui/arena';
import './ui/duel';
import './ui/hero';
import './ui/bazaar';

async function boot() {
  const fonts = Promise.all(['900 40px Cinzel', '700 40px Cinzel', '600 20px Barlow Condensed', '700 20px Barlow Condensed', '500 20px Barlow Condensed'].map(f => document.fonts.load(f)));
  await Promise.all([world.boot(document.getElementById('world') as HTMLCanvasElement), fonts]);
  armAudio();
  // come back in real mode if the player left in it (the wallet + sdk bundle loads only then)
  if ((() => { try { return localStorage.getItem('evermore.mode') === 'real'; } catch { return false; } })()) await import('./ui/connect').then(m => m.restoreMode());
  const r0 = (location.hash.slice(1) || 'front') as Route;
  go(['raise', 'arena', 'hero', 'bazaar'].includes(r0) ? r0 : 'front', false);
  const veil = document.getElementById('veil');
  if (veil) { veil.classList.add('gone'); setTimeout(() => veil.remove(), 900); }
}
boot().catch(e => {
  const veil = document.getElementById('veil');
  if (veil) veil.querySelector('p')!.textContent = 'This device could not start the 3D arena. ' + (e as Error).message;
  console.error(e);
});

// dev only handle for the headless driver (stripped from production builds)
if (import.meta.env.DEV) {
  import('./app').then(m => { (window as unknown as Record<string, unknown>).__ev = m; });
  Promise.all([import('./three/engine'), import('./three/fx')]).then(([e, f]) => { (window as unknown as Record<string, unknown>).__3 = { engine: e.engine, director: f.director }; });
}
