// Front door: three fighters stand in the shaft of light, the camera breathes in on them. One line, one button.
import { engine } from '../three/engine';
import { director, fitDistance, portrait, shot } from '../three/fx';
import { world } from '../three/world';
import { app, go, hasRealChain, register } from '../app';
import { h } from './kit';

register('front', root => {
  let alive = true;
  (async () => {
    // a Rogue, a Knight and a Mage at three points on the road: the knight wears a crown at level 10
    const [r, k, m] = await Promise.all([
      world.fighter(1, { level: 7, gear: [{ kind: 0, tier: 2 }] }),
      world.fighter(0, { level: 10, gear: [{ kind: 1, tier: 3 }] }),
      world.fighter(2, { level: 5, gear: [{ kind: 2, tier: 2 }] }),
    ]);
    if (!alive) return;
    // on a phone the trio stands as a pyramid, the knight forward, so they can stand tall in a narrow frame
    const P = portrait(), sx = P ? 0.62 : 1.25;
    r.root.position.set(-sx, 0, P ? -0.75 : -0.4); k.root.position.set(0, 0, P ? 0.55 : 0.2); m.root.position.set(sx, 0, P ? -0.75 : -0.4);
    r.face(1.5, 6); k.face(0, 6); m.face(-1.5, 6);
    // the trio fills the middle of the frame: title above their heads, the button below their feet
    const fov = portrait() ? 34 : 26;
    const d = P ? Math.max(7.2, fitDistance(2.3, fov)) : 8.4;
    const ly = P ? 1.12 : 1.15;
    director.cut(shot(1.2, 3.6, d * 0.6, 0, ly + 0.4, 0, fov - 3));
    director.move(shot(0, 1.05, d, 0, ly, 0, fov), 3600);
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
  const raise = h('button', { class: 'btn prime', onClick: () => start() }, 'Raise a hero');
  const practiceLink = h('button', { class: 'link', onClick: () => start() }, hasRealChain() ? 'or practice first, no wallet' : 'Practice runs in your browser, no wallet');
  root.append(h('section', { class: 'screen front' },
    h('div', { class: 'title' }, title, h('div', { class: 'line' }, "Games die. Heroes don't.")),
    h('div', { class: 'cta' }, raise, practiceLink)));

  async function start() {
    const mine = await app.chain.myHeroes();
    go(mine.length ? 'arena' : 'raise');
  }
  return () => { alive = false; };
});
