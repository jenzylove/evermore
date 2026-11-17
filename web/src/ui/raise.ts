// Raise: the chosen fighter turns slowly in the shaft of light. Pick a class, name it, raise it.
import * as THREE from 'three';
import { engine, ease } from '../three/engine';
import { director, flash, portrait, screenFlash, shock, shot, sparks } from '../three/fx';
import { world } from '../three/world';
import type { Fighter } from '../three/fighter';
import { STARTER } from '../game/sim';
import { app, go, isPractice, register, setHero, renderChrome } from '../app';
import { sfx } from '../audio/sfx';
import { h, icon, money, toast } from './kit';
import type { ClassId } from '../chain/types';

const BLURB = [
  'Hard to hurt and slow to fall. Wins the long fights.',
  'Fast. Strikes first almost every round.',
  'Hits hardest. Breaks if you are careless.',
];
const NAMES = ['Ash', 'Briar', 'Cinder', 'Dusk', 'Ember', 'Fable', 'Gale', 'Hollow', 'Iris', 'Juniper', 'Kite', 'Lark', 'Moth', 'Nettle', 'Onyx', 'Pike', 'Quill', 'Rook', 'Sorrow', 'Tansy', 'Umber', 'Vale', 'Wick', 'Yarrow', 'Zephyr'];
const MAX = { hp: 60, atk: 15, def: 8, spd: 9 };

register('raise', root => {
  let cls: ClassId = 0;
  const figs: (Fighter | null)[] = [null, null, null];
  let spin = 0.5, drag = 0, dragging = false, lastX = 0;

  // phone: the fighter stands in the top half, clear of the panel; desktop: left of the panel
  const frame = () => portrait() ? shot(0, 1.55, 7.6, 0, 0.1, 0, 38) : shot(1.5, 1.2, 5.6, 1.5, 0.95, 0, 30);
  director.cut(shot(0, 2.4, 7.5, 0, 1, 0, 30));
  director.move(frame(), 1400, ease.outCubic);
  (async () => {
    const fs = await Promise.all([0, 1, 2].map(c => world.fighter(c, { level: 1 })));
    fs.forEach((f, i) => { figs[i] = f; f.root.visible = i === cls; });
    world.tick(dt => {
      if (!dragging) { drag *= Math.exp(-dt * 3); spin += dt * 0.35 + drag * dt; }
      figs.forEach(f => { if (f) f.root.rotation.y = spin; });
    });
  })();

  const tabs = h('div', { class: 'classes' });
  const blurb = h('p', { class: 'blurb' });
  const stats = h('div', { class: 'stats' });
  const name = h('input', { class: 'name', maxlength: 14, placeholder: 'Name your hero', 'aria-label': 'Hero name', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  name.value = NAMES[Math.floor(Math.random() * NAMES.length)];
  const dice = h('button', { class: 'dice', 'aria-label': 'Random name', onClick: () => { name.value = NAMES[Math.floor(Math.random() * NAMES.length)]; } }, icon('dice'));
  const f = app.chain.fees();
  const go1 = h('button', { class: 'btn prime', style: 'width:100%', onClick: raise }, 'Raise', h('small', {}, isPractice() ? 'practice' : money(f.raiseSats, f.usdPerBch)));

  const pickClass = (c: ClassId) => {
    if (c === cls) return;
    cls = c; sfx.soft(); paint();
    figs.forEach((x, i) => { if (x) x.root.visible = i === cls; });
    const fg = figs[cls]; if (fg) { fg.flash(0.6); fg.once('taunt', { fade: 0.2 }); }
  };
  const paint = () => {
    tabs.innerHTML = '';
    ['Knight', 'Rogue', 'Mage'].forEach((n, i) => tabs.append(h('button', { class: i === cls ? 'on' : '', onClick: () => pickClass(i as ClassId) }, n)));
    blurb.textContent = BLURB[cls];
    stats.innerHTML = '';
    const s = STARTER[cls];
    (['hp', 'atk', 'def', 'spd'] as const).forEach(k => {
      const bar = h('div', { class: 'bar' }, h('i', {}));
      stats.append(h('span', { class: 'k' }, k.toUpperCase()), bar, h('span', { class: 'v' }, String(s[k])));
      requestAnimationFrame(() => { (bar.firstChild as HTMLElement).style.width = `${(s[k] / MAX[k]) * 100}%`; });
    });
  };
  paint();

  // drag the fighter round; a quick swipe changes class
  const cv = document.getElementById('world')!;
  let sx = 0, t0 = 0;
  const down = (e: PointerEvent) => { dragging = true; lastX = sx = e.clientX; t0 = performance.now(); };
  const move = (e: PointerEvent) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; spin += dx * 0.012; drag = dx * 0.6; };
  const up = (e: PointerEvent) => {
    if (!dragging) return; dragging = false;
    const d = e.clientX - sx;
    if (Math.abs(d) > 60 && performance.now() - t0 < 260) pickClass(Math.max(0, Math.min(2, cls + (d < 0 ? 1 : -1))) as ClassId);
  };
  cv.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up);

  root.append(h('section', { class: 'screen raise' },
    h('div', { class: 'top' }, h('div', { class: 'eyebrow' }, 'Raise a hero')),
    h('div', { class: 'panel scrim-b' }, h('div', { class: 'wrap' }, tabs, blurb, stats, h('div', { class: 'namerow' }, name, dice), go1,
      h('p', { class: 'fine' }, isPractice() ? 'Practice hero. It lives in this browser only.' : 'Your hero is a token in your wallet. Nobody can delete it.')))));

  async function raise() {
    go1.setAttribute('disabled', '');
    try {
      const { hero } = await app.chain.raise(cls, name.value);
      setHero(hero.id);
      sfx.reveal();
      const fg = figs[cls];
      if (fg) {
        const feet = fg.root.position.clone().setY(0.05), chest = fg.point('chest', new THREE.Vector3());
        screenFlash('#ffd58a', 0.55); director.shake(0.35);
        shock(feet, '#ffbf6a', 3); flash(chest, '#ffcf80', 2.2, 0.35);
        sparks(feet.clone().setY(0.3), 70, ['#ffcf80', '#fff1c1', '#ff9d3c'], 5, 3, 1.1);
        fg.flash(1); fg.once('victory', { fade: 0.15, hold: true });
        director.move(portrait() ? shot(0, 0.7, 3.4, 0, 1.0, 0, 40) : shot(0, 0.7, 3.6, 0, 1.0, 0, 32), 1600, ease.outCubic);
      }
      await engine.wait(1700);
      renderChrome();
      go('arena');
    } catch (e) { toast((e as Error).message, true); go1.removeAttribute('disabled'); }
  }
  return () => { cv.removeEventListener('pointerdown', down); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
});
