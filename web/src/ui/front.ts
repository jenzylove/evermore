// Front door: three fighters stand in the shaft of light, the camera breathes in on them. One line, two ways in:
// practice in the browser, or play for real on Bitcoin Cash.
// index.html carries the same door over a still of the hall, so it can be tapped before the 3D is up; when the hall is
// lit this screen takes over in place (no entrance animation, the camera already at rest).
import { engine } from '../three/engine';
import { director, fitDistance, portrait, shot } from '../three/fx';
import { FRONT_TRIO, world } from '../three/world';
import { app, go, isPractice, register } from '../app';
import { h } from './kit';

/** into the game: the Arena if you have a hero, else raise one */
export async function startPlaying() {
  const mine = await app.chain.myHeroes();
  go(mine.length ? 'arena' : 'raise');
}
/** the Play for real sheet: wallet, Satchel, the switch (the wallet bundle loads only now) */
export function playForReal() { return import('./connect').then(m => m.openConnect()); }

const bchMark = () => h('i', { class: 'bchm' });

register('front', root => {
  let alive = true;
  const still = !!document.getElementById('veil'); // taking over from the page's own door
  (async () => {
    const [r, k, m] = await Promise.all(FRONT_TRIO.map(([c, l]) => world.fighter(c, l)));
    if (!alive) return;
    // on a phone the trio stands as a pyramid, the knight forward, so they can stand tall in a narrow frame
    const P = portrait(), sx = P ? 0.62 : 1.25;
    r.root.position.set(-sx, 0, P ? -0.75 : -0.4); k.root.position.set(0, 0, P ? 0.55 : 0.2); m.root.position.set(sx, 0, P ? -0.75 : -0.4);
    r.face(1.5, 6); k.face(0, 6); m.face(-1.5, 6);
    // the trio fills the middle of the frame: title above their heads, the buttons below their feet
    const fov = portrait() ? 34 : 26;
    const d = P ? Math.max(7.2, fitDistance(2.3, fov)) : 8.4;
    const ly = P ? 1.12 : 1.15;
    const rest = shot(0, 1.05, d, 0, ly, 0, fov);
    if (still) director.cut(rest);
    else { director.cut(shot(1.2, 3.6, d * 0.6, 0, ly + 0.4, 0, fov - 3)); director.move(rest, 3600); }
    // now and then someone shows off
    let next = engine.t + 3.5;
    world.tick((_, t) => {
      if (t < next) return;
      next = t + 4 + Math.random() * 3;
      const f = [r, k, m][Math.floor(Math.random() * 3)];
      if (f.clipName === 'idle') f.once(Math.random() < 0.5 ? 'taunt' : 'victory', { fade: 0.35, speed: 1 });
    });
  })();

  const title = h('h1', {}, ...[...'Evermore'].map((ch, i) => { const s = h('span', {}, ch); s.style.animationDelay = `${500 + i * 70}ms`; return s; }));
  const P = isPractice();
  const raise = h('button', { class: 'btn prime', onClick: () => startPlaying() }, P ? 'Raise a hero ' : 'Enter the hall ', h('small', {}, P ? 'practice, free' : `on ${app.chain.mode}`));
  const real = h('button', { class: 'btn bch', onClick: () => playForReal() }, bchMark(), P ? 'Play for real' : 'Wallet and Satchel');
  root.append(h('section', { class: `screen front${still ? ' still' : ''}` },
    h('div', { class: 'title' }, title, h('div', { class: 'line' }, "Games die. Heroes don't."), h('div', { class: 'chainline' }, bchMark(), 'Every hero lives on Bitcoin Cash')),
    h('div', { class: 'cta' }, raise, real)));
  return () => { alive = false; };
});
