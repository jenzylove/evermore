// The first minute guide: shown once, the first time a player steps in, so they know what the
// game is, how a fight works and how a hero earns before they touch anything. Reopened any time
// from "How it works" on the front door. Swipe, arrows or the buttons move through it.
import { h } from './kit';

const SEEN = 'evermore.guide.v1';
type Step = { img: string; kick: string; title: string; body: string };
const STEPS: Step[] = [
  { img: '/landing/hero.webp', kick: '1 · Raise', title: 'Raise a hero', body: 'Pick a Knight, Rogue or Mage. On Bitcoin Cash your hero is a token in your own wallet: its level, XP and stats live inside it, so no company can ever delete it.' },
  { img: '/landing/arena.webp', kick: '2 · Challenge', title: 'Fight the echoes', body: 'The arena is full of echoes: other players’ heroes, fighting on their own. Pick one near your level. A small challenge fee goes straight to its owner.' },
  { img: '/landing/duel.webp', kick: '3 · Duel', title: 'Strike, Guard, Power', body: 'Each round you both choose one move, and the faster fighter goes first. Strike hits. Guard does not attack: it halves the hit you take and fills half your power bar. With a full bar, Power hits twice as hard.' },
  { img: '/landing/forge.webp', kick: '4 · Forge', title: 'The chain checks your win', body: 'Win and Bitcoin Cash replays the whole fight before your hero levels up. A faked win is rejected. Beat an echo far above you and capped gear can drop.' },
  { img: '/landing/victory.webp', kick: '5 · Earn', title: 'Earn while you sleep', body: 'Your hero becomes an echo too. Every time someone challenges it, you get paid, even while you are away. You can also sell your hero at your own price.' },
  { img: '/poster-l.webp', kick: '6 · Start', title: 'Practice free, then play for real', body: 'Practice runs in your browser with nothing on chain. When you are ready, Play for real with Selene, Cashonize or Paytaca: about $1 is plenty.' },
];

export function guideSeen() { try { return localStorage.getItem(SEEN) === '1'; } catch { return true; } }

/** Show the guide; resolves when the player closes or finishes it. */
export function showGuide(): Promise<void> {
  return new Promise((done) => {
    let i = 0;
    const img = h('div', { class: 'gd-img' });
    const kick = h('div', { class: 'gd-kick' });
    const title = h('h2', { class: 'gd-title' });
    const body = h('p', { class: 'gd-body' });
    const dots = h('div', { class: 'gd-dots' }, ...STEPS.map((_, k) => h('i', { onClick: () => show(k) })));
    const back = h('button', { class: 'btn ghost gd-back', onClick: () => show(i - 1) }, 'Back');
    const next = h('button', { class: 'btn prime gd-next', onClick: () => (i === STEPS.length - 1 ? close() : show(i + 1)) }, 'Next');
    const skip = h('button', { class: 'gd-skip', onClick: () => close() }, 'Skip');
    const card = h('div', { class: 'gd-card' }, img, h('div', { class: 'gd-text' }, kick, title, body, dots, h('div', { class: 'gd-nav' }, back, next)), skip);
    const el = h('div', { class: 'guide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How Evermore works' }, card);
    function show(k: number) {
      i = Math.max(0, Math.min(STEPS.length - 1, k));
      const s = STEPS[i];
      img.style.backgroundImage = `url(${s.img})`;
      kick.textContent = s.kick; title.textContent = s.title; body.textContent = s.body;
      [...dots.children].forEach((d, k2) => d.classList.toggle('on', k2 === i));
      back.style.visibility = i ? 'visible' : 'hidden';
      next.textContent = i === STEPS.length - 1 ? 'Let’s go' : 'Next';
      card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    }
    function key(e: KeyboardEvent) { if (e.key === 'ArrowRight') next.click(); else if (e.key === 'ArrowLeft' && i) show(i - 1); else if (e.key === 'Escape') close(); }
    let x0 = 0;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) dx < 0 ? next.click() : i && show(i - 1); });
    function close() {
      try { localStorage.setItem(SEEN, '1'); } catch { /* storage blocked: shown again next time */ }
      removeEventListener('keydown', key);
      el.classList.add('out');
      setTimeout(() => { el.remove(); done(); }, 280);
    }
    addEventListener('keydown', key);
    // preload every picture so swiping never shows an empty frame
    STEPS.forEach((s) => { const im = new Image(); im.src = s.img; });
    document.body.append(el);
    show(0);
  });
}
