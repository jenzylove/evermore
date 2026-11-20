import './styles.css';
import { world } from './three/world';
import { armAudio, go, type Route } from './app';
import { startPlaying, playForReal } from './ui/front';
import './ui/raise';
import './ui/arena';
import './ui/duel';
import './ui/hero';
import './ui/bazaar';

declare global { interface Window { __intent?: 'practice' | 'real' } }

async function boot() {
  const fonts = Promise.all(['900 40px Cinzel', '700 40px Cinzel', '600 20px Barlow Condensed', '700 20px Barlow Condensed', '500 20px Barlow Condensed'].map(f => document.fonts.load(f)));
  await Promise.all([world.boot(document.getElementById('world') as HTMLCanvasElement), fonts]);
  armAudio();
  // come back in real mode if the player left in it (the wallet + sdk bundle loads only then)
  if ((() => { try { return localStorage.getItem('evermore.mode') === 'real'; } catch { return false; } })()) await import('./ui/connect').then(m => m.restoreMode());
  const r0 = (location.hash.slice(1) || 'front') as Route;
  document.body.dataset.world = 'ready';
  const intent = window.__intent;
  if (intent === 'practice') await startPlaying();
  else { go(['raise', 'arena', 'hero', 'bazaar'].includes(r0) ? r0 : 'front', false); if (intent === 'real') playForReal(); }
  // let the lit hall draw a few real frames before the still lifts, so the hand over never shows a black frame
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(() => r(null)));
  const veil = document.getElementById('veil');
  if (veil) { veil.classList.add('gone'); setTimeout(() => veil.remove(), 900); }
  // now compile the rest of the game's shaders, a batch at a time, while the player looks at the door
  setTimeout(() => world.warmRest(), 700);
}
boot().catch(e => {
  const veil = document.getElementById('veil');
  const p = veil?.querySelector('.lighting span');
  if (p) p.textContent = 'This device could not start the 3D arena. ' + (e as Error).message;
  console.error(e);
});

// dev only handle for the headless driver (stripped from production builds)
if (import.meta.env.DEV) {
  import('./app').then(m => { (window as unknown as Record<string, unknown>).__ev = m; });
  Promise.all([import('./three/engine'), import('./three/fx'), import('./three/world')]).then(([e, f, w]) => { (window as unknown as Record<string, unknown>).__3 = { engine: e.engine, director: f.director, world: w.world }; });
}
