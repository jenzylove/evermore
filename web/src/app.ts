// App state, routing and the little bit of chrome that sits over the game.
import type { GameChain, HeroView, Ticket } from './chain/types';
import { PracticeChain } from './chain/practice';
import { stage } from './gfx/stage';
import { h, icon, shortCents } from './ui/kit';
import { isMuted, setMuted, sfx, unlock } from './audio/sfx';

export type Route = 'front' | 'raise' | 'arena' | 'duel' | 'hero' | 'bazaar';

/** The live chain, set by the sdk when it is wired in; null means only practice exists. */
let realChain: GameChain | null = null;
export const practice = new PracticeChain();
export const app = {
  chain: practice as GameChain,
  heroId: null as number | null,
  ticket: null as Ticket | null,
  focusGhost: null as number | null,
  route: 'front' as Route,
};
export function useRealChain(c: GameChain) { realChain = c; app.chain = c; }
export const hasRealChain = () => realChain !== null;
export const isPractice = () => app.chain.mode === 'practice';

try { const v = localStorage.getItem('evermore.hero'); if (v) app.heroId = Number(v); } catch { /* */ }
export function setHero(id: number) { app.heroId = id; try { localStorage.setItem('evermore.hero', String(id)); } catch { /* */ } }

export async function activeHero(): Promise<HeroView | null> {
  const mine = await app.chain.myHeroes();
  const playing = mine.filter(x => x.where === 'satchel');
  const h0 = playing.find(x => x.id === app.heroId) ?? playing[0] ?? null;
  if (h0 && h0.id !== app.heroId) setHero(h0.id);
  return h0;
}

const ui = () => document.getElementById('ui')!;
type Screen = (root: HTMLElement) => void | (() => void);
const screens = {} as Record<Route, Screen>;
export function register(r: Route, s: Screen) { screens[r] = s; }

let cleanup: (() => void) | void;
export function go(r: Route, push = true) {
  cleanup?.(); cleanup = undefined;
  stage.clearFx();
  app.route = r;
  const root = ui(); root.innerHTML = '';
  if (push) history.pushState({ r }, '', r === 'front' ? location.pathname : `#${r}`);
  cleanup = screens[r](root);
  renderChrome();
}
addEventListener('popstate', () => {
  const r = (location.hash.slice(1) || 'front') as Route;
  go(r === 'duel' ? 'arena' : (screens[r] ? r : 'front'), false);
});

let chromeGen = 0;
export async function renderChrome() {
  const gen = ++chromeGen;
  const s = app.route !== 'front' && app.route !== 'duel' ? await app.chain.satchel() : null;
  if (gen !== chromeGen) return; // a newer render won
  const c = document.getElementById('chrome')!; c.innerHTML = '';
  const mute = h('button', { class: 'mute', 'aria-label': 'Sound', onClick: () => { unlock(); setMuted(!isMuted()); renderChrome(); } }, icon(isMuted() ? 'muted' : 'sound', '#a99cb8'));
  if (app.route !== 'duel' && isPractice()) c.append(h('div', { class: 'tag' }, h('b', {}, 'Practice'), ' · nothing on chain'));
  if (s) {
    const f = app.chain.fees();
    c.append(h('button', { class: 'pouch dim', 'aria-label': 'Satchel', onClick: () => import('./ui/satchel').then(m => m.openSatchel()) },
      icon('pouch', '#a99cb8', '#3b2d52', 2), shortCents(s.sats, f.usdPerBch)));
  }
  c.append(mute);
}

/** First tap anywhere wakes the sound. */
export function armAudio() {
  const once = () => { unlock(); removeEventListener('pointerdown', once); };
  addEventListener('pointerdown', once);
  // Button taps get a tick everywhere.
  addEventListener('pointerdown', e => { const b = (e.target as HTMLElement).closest('button'); if (b && !b.disabled && !b.closest('.moves')) sfx.tap(); }, true);
}
