// App state, routing and the little bit of chrome that sits over the game.
import type { GameChain, HeroView, Ticket } from './chain/types';
import { PracticeHall } from './game/practiceHall';
import { world } from './three/world';
import { h, icon, shortCents } from './ui/kit';
import { isMuted, setMuted, sfx, unlock } from './audio/sfx';

export type Route = 'front' | 'raise' | 'arena' | 'duel' | 'hero' | 'bazaar';

/** The live chain, set by the sdk when it is wired in; null means only practice exists. */
let realChain: GameChain | null = null;
export const practice = new PracticeHall();
export const app = {
  chain: practice as GameChain,
  heroId: null as number | null,
  ticket: null as Ticket | null,
  /** replaying a lost paid fight for free: it teaches, it does not count (no forge, no XP, no bounty) */
  replay: false,
  focusGhost: null as number | null,
  /** set right after a raise, so the hero screen can welcome the new hero */
  justRaised: false,
  route: 'front' as Route,
};
export function useRealChain(c: GameChain) { realChain = c; app.chain = c; }
/** Back to the in-browser practice game (the real chain stays loaded for a quick switch back). */
export function usePractice() { app.chain = practice; }
export const hasRealChain = () => realChain !== null;
export const isPractice = () => app.chain.mode === 'practice';
/** set after the first finished practice fight: only then is real play offered inside the game */
export const practiceDone = () => { try { return localStorage.getItem('evermore.practice.done') === '1'; } catch { return false; } };
export const markPracticeDone = () => { try { localStorage.setItem('evermore.practice.done', '1'); } catch { /* storage blocked */ } };

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
  world.reset();
  app.route = r;
  document.body.dataset.route = r;
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
  const P = isPractice();
  const s = app.route !== 'duel' && (!P || app.route !== 'front') ? await app.chain.satchel().catch(() => null) : null;
  if (gen !== chromeGen) return; // a newer render won
  const c = document.getElementById('chrome')!; c.innerHTML = '';
  const mute = h('button', { class: 'mute', 'aria-label': 'Sound', onClick: () => { unlock(); setMuted(!isMuted()); renderChrome(); } }, icon(isMuted() ? 'muted' : 'sound'));
  // the mode tag: practice offers the way to real play; real play names its network and the wallet, in Bitcoin Cash green
  const openConnect = () => import('./ui/connect').then(m => m.openConnect());
  if (app.route !== 'duel') c.append(h('div', { class: 'tag', 'data-mode': app.chain.mode },
    ...(P ? [h('b', {}, 'Practice · free'), app.route === 'front' || !practiceDone() ? null : h('button', { class: 'go-real', onClick: openConnect }, h('i', { class: 'bchm' }), 'Play for real')]
      : [h('button', { class: 'chip', onClick: openConnect }, h('i', { class: 'bchm' }), h('b', {}, app.chain.mode === 'chipnet' ? 'Chipnet' : 'Bitcoin Cash'),
          h('span', {}, s?.connected ?? 'connect wallet'))])));
  if (s && app.route !== 'front' && !P) {
    const f = app.chain.fees();
    c.append(h('button', { class: `pouch${P ? ' dim' : ' real'}`, 'aria-label': 'Satchel', onClick: () => import('./ui/satchel').then(m => m.openSatchel()) },
      icon('pouch'), shortCents(s.sats, f.usdPerBch), P ? null : h('small', {}, `${(s.sats / 1e8).toFixed(s.sats >= 1e6 ? 4 : 5)} BCH`)));
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
