// Raise: pick a class, name it, raise it. The new hero arrives in a column of light.
import { Actor } from '../gfx/actor';
import { drawHall } from '../gfx/hall';
import { ease, stage } from '../gfx/stage';
import { STARTER } from '../game/sim';
import { app, go, isPractice, register, setHero, renderChrome } from '../app';
import { sfx } from '../audio/sfx';
import { h, icon, money, toast } from './kit';
import type { ClassId } from '../chain/types';

const BLURB = [
  'Knight. Hard to hurt and slow to fall. Wins the long fights.',
  'Rogue. Fast. Strikes first almost every round.',
  'Mage. Hits hardest. Breaks if you are careless.',
];
const NAMES = ['Ash', 'Briar', 'Cinder', 'Dusk', 'Ember', 'Fable', 'Gale', 'Hollow', 'Iris', 'Juniper', 'Kite', 'Lark', 'Moth', 'Nettle', 'Onyx', 'Pike', 'Quill', 'Rook', 'Sorrow', 'Tansy', 'Umber', 'Vale', 'Wick', 'Yarrow', 'Zephyr'];
const MAX = { hp: 60, atk: 15, def: 8, spd: 9 };

register('raise', root => {
  let cls: ClassId = 0;
  const fem = Math.random() < 0.5;
  const actors = [new Actor(0, fem), new Actor(1, fem), new Actor(2, fem)];
  let shown = 0; // animated selection position
  let summon = -1; // summon animation time
  stage.scene = {
    view: { pw: 80, lh: 120 },
    update(dt) { actors.forEach(a => a.update(dt)); shown += (cls - shown) * (1 - Math.exp(-dt / 90)); if (summon >= 0) summon += dt; },
    draw(ctx, W, H, t) {
      const fy = Math.round(H * (H > W ? 0.36 : 0.42));
      drawHall(ctx, W, H, t, { floorY: fy, camX: 400 + shown * 24, focusY: fy + 26 });
      const cx = W / 2, base = fy + 34;
      actors.forEach((a, i) => {
        const d = i - shown;
        a.place(cx + d * 30, base - Math.abs(d) * 3);
        a.face = d > 0.3 ? -1 : 1;
        const on = Math.abs(d) < 0.5;
        a.alpha = on ? 1 : 0.38;
        a.layer = on ? 'img' : 'dark';
        if (summon >= 0 && on) a.alpha = Math.min(1, summon / 500);
        if (summon < 0 || on) a.draw(ctx, t);
      });
      if (summon >= 0) {
        const p = Math.min(1, summon / 700);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(246,196,83,${0.5 * (1 - p)})`;
        const w = Math.round(14 * (1 - p) + 2);
        ctx.fillRect(Math.round(cx - w / 2), 0, w, base);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  };

  const tabs = h('div', { class: 'classes' });
  const blurb = h('p', { class: 'blurb' });
  const stats = h('div', { class: 'stats' });
  const name = h('input', { class: 'name', maxlength: 14, placeholder: 'Name your hero', 'aria-label': 'Hero name', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  name.value = NAMES[Math.floor(Math.random() * NAMES.length)];
  const dice = h('button', { class: 'dice', 'aria-label': 'Random name', onClick: () => { name.value = NAMES[Math.floor(Math.random() * NAMES.length)]; } }, icon('dice', '#efe6d2', '#3b2d52', 3));
  const f = app.chain.fees();
  const go1 = h('button', { class: 'btn', onClick: raise }, 'Raise', h('small', {}, isPractice() ? 'practice' : money(f.raiseSats, f.usdPerBch)));

  const paint = () => {
    tabs.innerHTML = '';
    ['Knight', 'Rogue', 'Mage'].forEach((n, i) => tabs.append(h('button', { class: i === cls ? 'on' : '', onClick: () => { cls = i as ClassId; sfx.soft(); paint(); } }, n)));
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

  // swipe between classes
  let sx = 0;
  const swipe = (e: PointerEvent) => { sx = e.clientX; };
  const swipeEnd = (e: PointerEvent) => { const d = e.clientX - sx; if (Math.abs(d) > 40 && e.clientY < innerHeight * 0.5) { cls = Math.max(0, Math.min(2, cls + (d < 0 ? 1 : -1))) as ClassId; sfx.soft(); paint(); } };
  addEventListener('pointerdown', swipe); addEventListener('pointerup', swipeEnd);

  root.append(h('section', { class: 'screen raise' },
    h('div', { class: 'top' }, h('h2', { class: 'drop' }, 'Raise a hero')),
    h('div', { class: 'panel scrim-b' }, h('div', { class: 'wrap' }, tabs, blurb, stats, h('div', { class: 'namerow' }, name, dice), h('div', { style: 'display:flex' }, go1),
      h('p', { class: 'fine' }, isPractice() ? 'Practice hero. It lives in this browser only.' : 'Your hero is a token in your wallet. Nobody can delete it.')))));
  (go1 as HTMLElement).style.width = '100%';

  async function raise() {
    go1.setAttribute('disabled', '');
    try {
      const { hero } = await app.chain.raise(cls, name.value);
      setHero(hero.id);
      summon = 0; sfx.reveal();
      stage.flashScreen('#f6c453', 0.6); stage.shake(0.3);
      const a = actors[cls];
      stage.burst(a.x, a.y - 14, 40, ['#f6c453', '#fff1c1', '#ff9d3c'], 70, 40, 900);
      await stage.tween(900, p => { a.dy = -Math.round((1 - ease.outBack(p)) * 20); });
      renderChrome();
      go('arena');
    } catch (e) { toast((e as Error).message, true); go1.removeAttribute('disabled'); }
  }
  return () => { removeEventListener('pointerdown', swipe); removeEventListener('pointerup', swipeEnd); };
});
