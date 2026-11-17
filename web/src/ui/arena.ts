// Arena: walk your hero down the hall of ghosts. The ghost you stop at turns to face you.
import { Actor } from '../gfx/actor';
import { drawHall } from '../gfx/hall';
import { stage } from '../gfx/stage';
import { CLASS_NAMES, ghostMoves, seedOf, styleHash } from '../game/sim';
import { activeHero, app, go, isPractice, register } from '../app';
import { sfx } from '../audio/sfx';
import { h, icon, shortCents, toast } from './kit';
import type { GhostView, HeroView } from '../chain/types';
import { tabs } from './tabs';

const SPACING = 58;
export const MOVE_ICON = ['strike', 'guard', 'special'] as const;
export const MOVE_COLOR = ['#ff8a5c', '#9fd8ff', '#f6c453'];

register('arena', root => {
  let ghosts: GhostView[] = [];
  let hero: HeroView | null = null;
  let me: Actor | null = null;
  const gActors = new Map<number, Actor>();
  let focus = 0, heroX = 0, cam = 0, walking = 0;
  const gx = (i: number) => 70 + i * SPACING;

  stage.scene = {
    view: { pw: 84, lh: 130 },
    update(dt) {
      const target = gx(focus) - 24;
      const d = target - heroX;
      const sp = Math.min(Math.abs(d), (dt / 1000) * 90);
      heroX += Math.sign(d) * sp;
      walking = Math.abs(d) > 0.5 ? 1 : 0;
      if (me) {
        me.anim = walking ? 'run' : 'idle'; me.face = d < -0.5 ? -1 : 1; me.update(dt);
        if (walking && Math.floor(stage.t / 160) !== Math.floor((stage.t - dt) / 160)) sfx.step();
      }
      cam += (heroX + 24 - stage.W / 2 - cam) * (1 - Math.exp(-dt / 160));
      gActors.forEach(a => a.update(dt));
    },
    draw(ctx, W, H, t) {
      const fy = Math.round(H * (H > W ? 0.36 : 0.36));
      drawHall(ctx, W, H, t, { floorY: fy, camX: cam, focusX: gx(focus) - cam, focusY: fy + 30 });
      const base = fy + 34;
      ghosts.forEach((g, i) => {
        const a = gActors.get(g.id)!;
        const on = i === focus;
        a.place(gx(i) - cam, base);
        a.alpha += ((on ? 1 : 0.45) - a.alpha) * 0.1;
        a.face = on ? -1 : (i % 2 ? -1 : 1);
        // plinth
        ctx.fillStyle = on ? '#3a2d55' : '#231a35'; ctx.fillRect(Math.round(a.x - 10), base - 1, 20, 3);
        ctx.fillStyle = '#120d1d'; ctx.fillRect(Math.round(a.x - 10), base + 2, 20, 2);
        a.draw(ctx, t);
        if (on) { // marker
          const y = base - 36 + Math.round(Math.sin(t / 220) * 1.5);
          ctx.fillStyle = g.mine ? '#f6c453' : '#8ff6e6';
          ctx.fillRect(Math.round(a.x) - 1, y, 3, 1); ctx.fillRect(Math.round(a.x), y + 1, 1, 1);
        }
      });
      if (me) { me.place(heroX - cam, base + 6); me.draw(ctx, t); }
    },
  };

  const info = h('div', { class: 'wrap' });
  const left = h('button', { class: 'walk l', 'aria-label': 'Walk left', onClick: () => move(-1) }, icon('left', '#efe6d2', '', 4));
  const right = h('button', { class: 'walk r', 'aria-label': 'Walk right', onClick: () => move(1) }, icon('right', '#efe6d2', '', 4));
  root.append(h('section', { class: 'screen arena' }, left, right, h('div', { class: 'info scrim-b' }, info, tabs('arena'))));

  const move = (d: number) => {
    const n = Math.max(0, Math.min(ghosts.length - 1, focus + d));
    if (n !== focus) { focus = n; app.focusGhost = ghosts[n].id; paint(); }
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); if (e.key === 'Enter') (info.querySelector('.btn') as HTMLButtonElement | null)?.click(); };
  addEventListener('keydown', key);
  // swipe on the scene to walk; tap a ghost to walk to it
  let sx = 0, sy = 0;
  const cv = document.getElementById('world')!;
  const down = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; };
  const up = (e: PointerEvent) => {
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(e.clientY - sy)) { move(dx < 0 ? 1 : -1); return; }
    const k = stage.k / Math.min(3, devicePixelRatio || 1);
    const wx = e.clientX / k + cam;
    const i = Math.round((wx - 70) / SPACING);
    if (i >= 0 && i < ghosts.length && Math.abs(wx - gx(i)) < 14) { focus = i; app.focusGhost = ghosts[i].id; paint(); }
  };
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointerup', up);

  (async () => {
    [ghosts, hero] = await Promise.all([app.chain.listGhosts(), activeHero()]);
    ghosts.forEach(g => gActors.set(g.id, new Actor(g.cls, g.id % 2 === 1, g.mine ? 'img' : 'ghost')));
    // start near a fair fight for the hero
    const fi = ghosts.findIndex(g => g.id === app.focusGhost);
    focus = fi >= 0 ? fi : Math.max(0, ghosts.findIndex(g => !g.mine && g.level >= (hero?.level ?? 1)));
    if (hero) { me = new Actor(hero.cls, hero.id % 2 === 1); heroX = gx(focus) - 90; } else heroX = gx(focus) - 24;
    cam = heroX + 24 - stage.W / 2;
    paint();
  })();

  function paint() {
    const g = ghosts[focus]; if (!g) return;
    sfx.soft();
    const f = app.chain.fees();
    info.innerHTML = '';
    info.classList.remove('card-in'); void info.offsetWidth; info.classList.add('card-in');
    info.append(
      h('div', { class: 'who' }, h('span', { class: 'nm drop', style: g.mine ? 'color:var(--gold)' : '' }, g.name), h('span', { class: 'lv' }, `Level ${g.level} ${CLASS_NAMES[g.cls]}`)),
      h('div', { class: 'rec' }, g.mine ? `Your hero · defended ${g.defences}, beaten ${g.beaten}` : `Defended ${g.defences} · beaten ${g.beaten} · kept by ${g.owner}`),
    );
    if (g.mine) {
      info.append(h('p', { class: 'dim', style: 'font-size:16px;margin:12px 0 14px' }, 'It stands here while you are away. Every challenge pays you.'));
      return;
    }
    if (hero) {
      const seed = seedOf(styleHash(hero.id, g));
      const mv = ghostMoves(seed);
      const st = h('div', { class: 'style' }, h('span', { class: 'lbl' }, `How it fights ${hero.name}`));
      mv.forEach(m => st.append(h('span', { class: 'mv', title: ['Strike', 'Guard', 'Special'][m] }, icon(MOVE_ICON[m], MOVE_COLOR[m], 'rgba(0,0,0,0.3)', 2))));
      info.append(st);
      const cmp = (k: 'hp' | 'atk' | 'def' | 'spd', label: string) => {
        const a = hero![k], b = g[k];
        return h('span', {}, `${label} `, h('b', { class: a > b ? 'up' : a < b ? 'dn' : '' }, String(a)), ` vs ${b}`);
      };
      info.append(h('div', { class: 'vs' }, cmp('hp', 'HP'), cmp('atk', 'ATK'), cmp('def', 'DEF'), cmp('spd', 'SPD')));
      const btn = h('button', { class: 'btn spirit', style: 'width:100%', onClick: async () => {
        btn.setAttribute('disabled', '');
        try {
          app.ticket = await app.chain.challenge(hero!.id, g.id);
          go('duel');
        } catch (e) { toast((e as Error).message, true); btn.removeAttribute('disabled'); }
      } }, 'Challenge', h('small', {}, isPractice() ? 'practice' : `${shortCents(f.challengeSats, f.usdPerBch)} to its owner`));
      info.append(btn);
    } else {
      info.append(h('p', { class: 'dim', style: 'margin:12px 0' }, 'Raise a hero to see how this ghost fights you.'),
        h('button', { class: 'btn', style: 'width:100%', onClick: () => go('raise') }, 'Raise a hero'));
    }
  }

  return () => { removeEventListener('keydown', key); cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointerup', up); };
});
