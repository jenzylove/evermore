// Arena: the ghosts of other players' heroes stand round the ring, cold and translucent. Yours waits in the foreground.
// Turn to a ghost and it turns to face you; its fighting style against your hero is shown before you pay.
import * as THREE from 'three';
import { ease } from '../three/engine';
import { director, fitDistance, portrait, shot } from '../three/fx';
import { world } from '../three/world';
import type { Fighter } from '../three/fighter';
import { CLASS_NAMES, ghostMoves, seedOf, styleHash } from '../game/sim';
import { activeHero, app, go, isPractice, register } from '../app';
import { sfx } from '../audio/sfx';
import { h, icon, shortCents, toast } from './kit';
import type { GhostView, HeroView } from '../chain/types';
import { tabs } from './tabs';

export const MOVE_ICON = ['strike', 'guard', 'special'] as const;
export const MOVE_NAME = ['Strike', 'Guard', 'Special'] as const;
const R = 5.4, STEP = 0.46;
const angle = (i: number) => -Math.PI / 2 + i * STEP;
const at = (i: number) => new THREE.Vector3(Math.cos(angle(i)) * R, 0, Math.sin(angle(i)) * R);

register('arena', root => {
  let ghosts: GhostView[] = [];
  let hero: HeroView | null = null;
  let me: Fighter | null = null;
  const figs = new Map<number, Fighter>();
  let focus = 0, ready = false;

  // the camera stands behind your hero, looking out across the ring at the ghost in focus
  const framing = (i: number) => {
    const g = at(i), dir = g.clone().normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const fov = portrait() ? 40 : 30, dist = Math.max(4.1, fitDistance(portrait() ? 2.6 : 4.6, fov));
    const cam = g.clone().addScaledVector(dir, -dist).addScaledVector(side, portrait() ? 0.35 : 0.9).setY(1.55);
    const look = g.clone().addScaledVector(side, portrait() ? 0 : -0.7).setY(portrait() ? 0.85 : 1.05);
    return { s: shot(cam.x, cam.y, cam.z, look.x, look.y, look.z, fov), dir, side, g };
  };
  const placeMe = (i: number) => {
    if (!me) return;
    const { dir, side, g } = framing(i);
    const p = g.clone().addScaledVector(dir, -2.6).addScaledVector(side, portrait() ? -0.75 : -1.25);
    me.root.position.copy(p); me.face(g.x, g.z);
  };

  const info = h('div', { class: 'wrap' });
  const left = h('button', { class: 'walk l', 'aria-label': 'Walk left', onClick: () => move(-1) }, icon('left'));
  const right = h('button', { class: 'walk r', 'aria-label': 'Walk right', onClick: () => move(1) }, icon('right'));
  root.append(h('section', { class: 'screen arena' }, left, right, h('div', { class: 'info scrim-b' }, info, tabs('arena'))));

  const move = (d: number) => {
    const n = Math.max(0, Math.min(ghosts.length - 1, focus + d));
    if (n !== focus) setFocus(n);
  };
  const setFocus = (n: number, cut = false) => {
    focus = n; app.focusGhost = ghosts[n]?.id ?? null;
    const f = framing(n);
    if (cut) director.cut(f.s); else director.move(f.s, 700, ease.inOut);
    placeMe(n);
    world.arena.focus(f.g.x, f.g.z);
    figs.forEach((fg, id) => {
      const i = ghosts.findIndex(g => g.id === id);
      fg.root.visible = Math.abs(i - n) <= 2;
    });
    const fg = figs.get(ghosts[n]?.id);
    if (fg && !cut && fg.clipName === 'idle') fg.once('taunt', { fade: 0.25 });
    paint();
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); if (e.key === 'Enter') (info.querySelector('.btn') as HTMLButtonElement | null)?.click(); };
  addEventListener('keydown', key);
  let sx = 0, sy = 0;
  const cv = document.getElementById('world')!;
  const down = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; };
  const up = (e: PointerEvent) => {
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(e.clientY - sy)) move(dx < 0 ? 1 : -1);
  };
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointerup', up);

  (async () => {
    [ghosts, hero] = await Promise.all([app.chain.listGhosts(), activeHero()]);
    const fi = ghosts.findIndex(g => g.id === app.focusGhost);
    focus = fi >= 0 ? fi : Math.max(0, ghosts.findIndex(g => !g.mine && g.level >= (hero?.level ?? 1)));
    const gear = hero ? await app.chain.myGear() : [];
    const made = await Promise.all([
      ...ghosts.map(g => world.fighter(g.cls, { level: g.level }, 1)),
      hero ? world.fighter(hero.cls, { level: hero.level, gear: gear.filter(x => x.where === 'satchel') }) : Promise.resolve(null),
    ]);
    ghosts.forEach((g, i) => {
      const f = made[i]!;
      f.root.position.copy(at(i)); f.face(0, 0);
      if (g.mine) f.rimColor('#ffc875');
      figs.set(g.id, f);
    });
    me = made[ghosts.length] ?? null;
    ready = true;
    // the ghost in focus turns to face your hero; the rest look into the ring
    world.tick(dt => {
      ghosts.forEach((g, i) => {
        const f = figs.get(g.id); if (!f || !f.root.visible) return;
        const on = i === focus;
        const target = on && me ? Math.atan2(me.root.position.x - f.root.position.x, me.root.position.z - f.root.position.z) : Math.atan2(-f.root.position.x, -f.root.position.z);
        let d = target - f.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        f.root.rotation.y += d * (1 - Math.exp(-dt * 5));
        f.ghostGlow(on ? 1 : 0);
      });
    });
    setFocus(focus, true);
    director.cut(shot(director.cur.pos.x * 1.4, 3, director.cur.pos.z * 1.4, director.cur.look.x, 1, director.cur.look.z, director.cur.fov));
    director.move(framing(focus).s, 1200, ease.outCubic);
  })();

  function paint() {
    const g = ghosts[focus]; if (!g || !ready) return;
    sfx.soft();
    const f = app.chain.fees();
    info.innerHTML = '';
    info.classList.remove('card-in'); void info.offsetWidth; info.classList.add('card-in');
    info.append(
      h('div', { class: 'who' }, h('span', { class: `nm${g.mine ? ' mine' : ''}` }, g.name), h('span', { class: 'lv' }, `Level ${g.level} ${CLASS_NAMES[g.cls]}`)),
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
      mv.forEach(m => { const s = h('span', { class: `mv m${m}`, title: MOVE_NAME[m] }, icon(MOVE_ICON[m])); st.append(s); });
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
