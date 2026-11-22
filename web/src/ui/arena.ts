// Arena: the echoes of other players' heroes stand on plinths round the hall, bodies of light with their names written
// above them and round their feet. Yours waits in the foreground.
// Turn to a ghost and it turns to face you; its fighting style against your hero is shown before you pay.
// The hall can hold any number of ghosts: they stand on a spiral that winds round the ring, and only the few either
// side of the one in focus are raised in 3D (the rest are made as you walk to them). A roster strip, class and level
// filters and a "beatable" mark (a winning line exists within 8 rounds) help pick a fight among dozens.
import * as THREE from 'three';
import { ease } from '../three/engine';
import { director, fitDistance, portrait, shot } from '../three/fx';
import { world } from '../three/world';
import { ECHO, echoTint, echoVariant, type Fighter } from '../three/fighter';
import { haunt, type GhostFx } from '../three/ghost';
import { CLASS_NAMES, ghostMoves, seedOf, solve, styleHash } from '../game/sim';
import { activeHero, app, go, isPractice, register } from '../app';
import { sfx } from '../audio/sfx';
import { h, icon, shortCents, toast } from './kit';
import type { GhostView, HeroView } from '../chain/types';
import { tabs } from './tabs';

export const MOVE_ICON = ['strike', 'guard', 'special'] as const;
export const MOVE_NAME = ['Strike', 'Guard', 'Special'] as const;
const R = 5.4, STEP = 0.46, LIFT = 0.2;
/** raised either side of the ghost in focus; kept a little further so walking back is instant */
const SHOW = 2, KEEP = 3;
const angle = (i: number) => -Math.PI / 2 + i * STEP;
const at = (i: number) => new THREE.Vector3(Math.cos(angle(i)) * R, 0, Math.sin(angle(i)) * R);
const CLS_SHORT = ['K', 'R', 'M'];

type Slot = { f: Fighter; fx: GhostFx; pl: THREE.Mesh };
type Band = 'all' | 'near' | 'beatable';

register('arena', root => {
  let all: GhostView[] = [];
  let list: GhostView[] = [];
  let hero: HeroView | null = null;
  let me: Fighter | null = null;
  let cls = -1, band: Band = 'all';
  const slots = new Map<number, Slot>();
  const making = new Set<number>();
  const beat = new Map<number, boolean>();
  let focus = 0, ready = false, alive = true;
  const plinthGeo = new THREE.CylinderGeometry(0.62, 0.7, LIFT, 40);
  const plinthMat = new THREE.MeshStandardMaterial({ color: '#6a7a9c', roughness: 0.35, metalness: 0, emissive: '#1a3a7a', emissiveIntensity: 0.15 });

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

  // ---- the panel: filters, the roster, the ghost in focus ----
  const count = h('div', { class: 'eyebrow' });
  const filters = h('div', { class: 'filters', role: 'toolbar', 'aria-label': 'Filter ghosts' });
  const roster = h('div', { class: 'roster', role: 'listbox', 'aria-label': 'Ghosts in the hall' });
  const info = h('div', { class: 'card' });
  const left = h('button', { class: 'walk l', 'aria-label': 'Walk left', onClick: () => move(-1) }, icon('left'));
  const right = h('button', { class: 'walk r', 'aria-label': 'Walk right', onClick: () => move(1) }, icon('right'));
  root.append(h('section', { class: 'screen arena' }, left, right,
    h('div', { class: 'info scrim-b' }, h('div', { class: 'wrap' }, h('div', { class: 'hallhead' }, count, filters), roster, info), tabs('arena'))));

  const move = (d: number) => {
    const n = Math.max(0, Math.min(list.length - 1, focus + d));
    if (n !== focus) setFocus(n);
  };
  const setFocus = (n: number, cut = false) => {
    focus = n; app.focusGhost = list[n]?.id ?? null;
    const f = framing(n);
    if (cut) director.cut(f.s); else director.move(f.s, 700, ease.inOut);
    placeMe(n);
    world.arena.focus(f.g.x, f.g.z);
    sync();
    const sl = slots.get(list[n]?.id);
    if (sl && !cut && sl.f.clipName === 'idle') sl.f.once('taunt', { fade: 0.25 });
    paintRoster(); paint();
  };

  /** raise the ghosts near the focus, put every raised one on its spot, let go of the far ones */
  function sync() {
    const want = new Map<number, number>();
    list.forEach((g, i) => { if (Math.abs(i - focus) <= KEEP) want.set(g.id, i); });
    for (const [id, sl] of slots) {
      const i = want.get(id);
      if (i === undefined) { sl.fx.dispose(); world.drop(sl.f); world.unextra(sl.pl); slots.delete(id); continue; }
      sl.f.root.position.copy(at(i)).setY(LIFT); sl.pl.position.copy(at(i)).setY(LIFT / 2);
      const vis = Math.abs(i - focus) <= SHOW; sl.f.root.visible = vis; sl.pl.visible = vis;
    }
    // nearest first, so the ghost in focus is never the last to appear
    const order = [...want.entries()].sort((a, b) => Math.abs(a[1] - focus) - Math.abs(b[1] - focus));
    for (const [id] of order) if (!slots.has(id) && !making.has(id)) raise(id);
  }
  async function raise(id: number) {
    const g = all.find(x => x.id === id); if (!g) return;
    making.add(id);
    const v = g.mine ? 0 : echoVariant(g.id, g.cls, hero?.cls ?? null);
    const f = await world.fighter(g.cls, { level: g.level }, ECHO, v); if (!g.mine && v === 0) f.tint(echoTint(g.id));
    making.delete(id);
    const i = list.findIndex(x => x.id === id);
    if (!alive || i < 0 || Math.abs(i - focus) > KEEP || slots.has(id)) { world.drop(f); return; }
    const pl = world.extra(new THREE.Mesh(plinthGeo, plinthMat)); pl.receiveShadow = true; pl.castShadow = true;
    const fx = haunt(f, { name: g.name, owner: g.mine ? 'you' : g.owner, label: true, lift: LIFT, color: g.mine ? '#ffd08a' : undefined });
    f.face(0, 0);
    slots.set(id, { f, fx, pl });
    sync();
  }

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

  const seedFor = (g: GhostView) => (hero ? app.chain.styleSeed?.(hero.id, g) ?? seedOf(styleHash(hero.id, g)) : 0); // real chains: the covenant seed
  const nearMe = (g: GhostView) => !!hero && g.level >= hero.level - 1 && g.level <= hero.level + 3;
  function applyFilters(keep = list[focus]?.id) {
    list = all.filter(g => (cls < 0 || g.cls === cls) && (band === 'all' || (band === 'near' ? nearMe(g) || g.mine : beat.get(g.id) === true)));
    const i = list.findIndex(g => g.id === keep);
    const n = i >= 0 ? i : Math.max(0, list.findIndex(g => !g.mine && g.level >= (hero?.level ?? 1)));
    paintFilters();
    if (!list.length) { focus = 0; sync(); paintRoster(); paint(); return; }
    setFocus(Math.min(n, list.length - 1));
  }

  // "beatable": does a winning line exist within 8 rounds? Worked out one ghost per idle moment, nearest first.
  let beatQueue: GhostView[] = [];
  function startBeat() {
    if (!hero) return;
    beatQueue = all.filter(g => !g.mine && !beat.has(g.id));
    const step = () => {
      if (!alive || !hero) return;
      const fi = list[focus]?.id;
      beatQueue.sort((a, b) => (a.id === fi ? -1 : b.id === fi ? 1 : Math.abs(a.level - hero!.level) - Math.abs(b.level - hero!.level)));
      const g = beatQueue.shift(); if (!g) { paintFilters(); return; }
      beat.set(g.id, !!solve(hero, { ...g, ownerPkh: new Uint8Array(20) }, seedFor(g), 8));
      paintRoster(true);
      if (g.id === fi) paint(false);
      if (band === 'beatable' && beat.get(g.id)) applyFilters();
      else if (band === 'beatable') paintFilters();
      ('requestIdleCallback' in window ? requestIdleCallback : (f: () => void) => setTimeout(f, 16))(step);
    };
    setTimeout(step, 400);
  }

  // while the arena is read from the chain, say so; if it fails, say why and offer a retry (never a blank floor)
  info.append(h('p', { class: 'dim', style: 'margin:12px 0' }, isPractice() ? 'Opening the arena…' : 'Reading the arena from Bitcoin Cash…'));
  const failed = (e: unknown) => {
    console.error('arena load failed', e);
    info.innerHTML = '';
    info.append(h('p', { class: 'tip', style: 'margin:12px 0 4px' }, 'The arena could not be read.'),
      h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:14px' }, (e as Error)?.message ?? String(e)),
      h('button', { class: 'btn spirit', style: 'width:100%', onClick: () => { (app.chain as { forget?: () => void }).forget?.(); go('arena', false); } }, 'Try again'));
  };
  const slow = setTimeout(() => { if (!ready) failed(new Error('Bitcoin Cash servers are slow to answer right now.')); }, 25000);
  (async () => {
    [all, hero] = await Promise.all([app.chain.listGhosts(), activeHero()]);
    const gear = hero ? await app.chain.myGear() : [];
    me = hero ? await world.fighter(hero.cls, { level: hero.level, gear: gear.filter(x => x.where === 'satchel') }) : null;
    ready = true;
    // the ghost in focus turns to face your hero; the rest look into the ring
    world.tick(dt => {
      for (const [id, sl] of slots) {
        const f = sl.f; if (!f.root.visible) continue;
        const on = list[focus]?.id === id;
        const target = on && me ? Math.atan2(me.root.position.x - f.root.position.x, me.root.position.z - f.root.position.z) : Math.atan2(-f.root.position.x, -f.root.position.z);
        let d = target - f.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        f.root.rotation.y += d * (1 - Math.exp(-dt * 5));
        f.ghostGlow(on ? 1 : 0);
        sl.fx.setFocus(on ? 1 : 0);
      }
    });
    list = all;
    const fi = all.findIndex(g => g.id === app.focusGhost);
    // first time in, stand the player in front of an echo they can actually beat, nearest their level
    let firstWin = -1;
    if (fi < 0 && hero) {
      const near = all.map((g, k) => ({ g, k })).filter(x => !x.g.mine && x.g.level <= hero!.level + 1)
        .sort((a, b) => (Number(a.g.cls === hero!.cls) - Number(b.g.cls === hero!.cls)) || (Math.abs(a.g.level - hero!.level) - Math.abs(b.g.level - hero!.level))).slice(0, 10); // a different class first: no mirror matches
      for (const { g, k } of near) {
        const ok = !!solve(hero, { ...g, ownerPkh: new Uint8Array(20) }, seedFor(g), 8);
        beat.set(g.id, ok);
        if (ok) { firstWin = k; break; }
      }
    }
    focus = fi >= 0 ? fi : firstWin >= 0 ? firstWin : Math.max(0, all.findIndex(g => !g.mine && g.level >= (hero?.level ?? 1)));
    paintFilters();
    setFocus(focus, true);
    director.cut(shot(director.cur.pos.x * 1.4, 3, director.cur.pos.z * 1.4, director.cur.look.x, 1, director.cur.look.z, director.cur.fov));
    director.move(framing(focus).s, 1200, ease.outCubic);
    startBeat();
    clearTimeout(slow);
  })().catch(failed);

  function paintFilters() {
    const others = all.filter(g => !g.mine).length;
    count.textContent = `${others} echo${others === 1 ? '' : 'es'} in the hall${list.length !== all.length ? ` · ${list.length} shown` : ''}`;
    filters.innerHTML = '';
    const chip = (label: string, on: boolean, fn: () => void, extra = '') => h('button', { class: `fchip${on ? ' on' : ''}${extra}`, 'aria-pressed': String(on), onClick: () => { sfx.soft(); fn(); } }, label);
    filters.append(chip('All', cls < 0, () => { cls = -1; applyFilters(); }));
    CLASS_NAMES.forEach((n, i) => filters.append(chip(n, cls === i, () => { cls = cls === i ? -1 : i; applyFilters(); })));
    if (hero) {
      filters.append(h('span', { class: 'fsep' }));
      filters.append(chip('Near my level', band === 'near', () => { band = band === 'near' ? 'all' : 'near'; applyFilters(); }));
      const left0 = beatQueue.length;
      filters.append(chip(left0 && band === 'beatable' ? `Beatable · checking ${left0}` : 'Beatable', band === 'beatable', () => { band = band === 'beatable' ? 'all' : 'beatable'; applyFilters(); }, ' beat'));
    }
  }

  function paintRoster(marksOnly = false) {
    if (marksOnly) {
      roster.querySelectorAll<HTMLElement>('[data-id]').forEach(el => el.classList.toggle('beat', beat.get(Number(el.dataset.id)) === true));
      return;
    }
    roster.innerHTML = '';
    list.forEach((g, i) => {
      const el = h('button', { class: `rchip${i === focus ? ' on' : ''}${g.mine ? ' mine' : ''}${beat.get(g.id) ? ' beat' : ''}`, role: 'option', 'aria-selected': String(i === focus), 'data-id': g.id,
        title: `${g.name}, level ${g.level} ${CLASS_NAMES[g.cls]}`, onClick: () => { if (i !== focus) setFocus(i); } },
        h('b', {}, String(g.level)), h('span', {}, g.name), h('i', {}, CLS_SHORT[g.cls]));
      roster.append(el);
    });
    const on = roster.children[focus] as HTMLElement | undefined;
    if (on) roster.scrollTo({ left: on.offsetLeft - roster.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' });
    left.style.visibility = focus > 0 ? 'visible' : 'hidden';
    right.style.visibility = focus < list.length - 1 ? 'visible' : 'hidden';
  }

  function paint(anim = true) {
    if (!ready) return;
    const g = list[focus];
    info.innerHTML = '';
    if (!g) {
      info.append(h('p', { class: 'dim', style: 'margin:12px 0' }, 'No echo matches.'), h('button', { class: 'btn ghost', style: 'width:100%', onClick: () => { cls = -1; band = 'all'; applyFilters(); } }, 'Show all'));
      return;
    }
    if (anim) { sfx.soft(); info.classList.remove('card-in'); void info.offsetWidth; info.classList.add('card-in'); }
    const f = app.chain.fees();
    const record = g.defences || g.beaten ? `Defended ${g.defences} · beaten ${g.beaten}` : 'Not challenged yet';
    info.append(
      h('div', { class: 'who' }, h('span', { class: `nm${g.mine ? ' mine' : ''}` }, g.name), h('span', { class: 'lv' }, `Level ${g.level} ${CLASS_NAMES[g.cls]}`)),
      h('div', { class: 'rec' }, g.mine ? `Your hero · ${record.toLowerCase()}` : `${record} · kept by `, g.mine ? null : h('span', { class: 'keeper' }, g.owner)),
    );
    if (g.mine) {
      info.append(h('p', { class: 'tip', style: 'margin:12px 0 4px' }, 'This is you.'),
        h('p', { class: 'dim', style: 'font-size:16px;margin:0 0 14px' }, isPractice()
          ? 'Your echo stands here for other players to fight. In the real game, every challenge pays you.'
          : `Your echo stands here for other players to fight. Every challenge pays you ${shortCents(f.challengeSats, f.usdPerBch)}.`));
      // jump to the nearest echo this hero can beat (or the next one along)
      const target = () => { const k = list.findIndex(x => !x.mine && beat.get(x.id) === true); return k >= 0 ? k : list.findIndex(x => !x.mine); };
      info.append(h('button', { class: 'btn spirit', style: 'width:100%', onClick: () => { const k = target(); if (k >= 0) setFocus(k); } }, 'Find a fight'));
      return;
    }
    if (hero) {
      const mv = ghostMoves(seedFor(g));
      const nS = mv.filter(m => m === 0).length, nG = mv.filter(m => m === 1).length;
      const style = nS >= 7 ? 'Aggressive: strikes often' : nG >= 5 ? 'Defensive: guards often' : 'Balanced: strikes, guards and power hits';
      const st = h('div', { class: 'style' }, h('span', { class: 'lbl' }, `${g.name}'s style`), h('span', { class: 'stylename' }, style));
      const b = beat.get(g.id);
      if (b !== undefined) st.append(h('span', { class: `hint${b ? ' yes' : ''}` }, b ? 'Beatable' : 'No quick win'));
      info.append(st);
      const cmp = (k: 'hp' | 'atk' | 'def' | 'spd', label: string) => {
        const a = hero![k], v = g[k];
        return h('span', {}, `${label} `, h('b', { class: a > v ? 'up' : a < v ? 'dn' : '' }, String(a)), ` vs ${v}`);
      };
      info.append(h('div', { class: 'vslbl' }, `${hero.name} vs ${g.name}`), h('div', { class: 'vs' }, cmp('hp', 'HP'), cmp('atk', 'ATK'), cmp('def', 'DEF'), cmp('spd', 'SPD')));
      const fee = shortCents(f.challengeSats, f.usdPerBch);
      const btn = h('button', { class: 'btn spirit', style: 'width:100%', onClick: async () => {
        btn.setAttribute('disabled', '');
        try {
          app.ticket = await app.chain.challenge(hero!.id, g.id);
          go('duel');
        } catch (e) { toast((e as Error).message, true); btn.removeAttribute('disabled'); }
      } }, `Fight ${g.name}`, isPractice() ? null : h('small', {}, `${fee} goes to its keeper`));
      // a plain line on what to do and what this fight is
      const tip = b === true ? 'You can win this one. Tap Fight.' : b === false ? 'Hard fight. Pick one with a gold dot to win.' : 'Pick an echo to fight. A gold dot means you can win.';
      info.append(h('p', { class: 'tip' }, tip), btn);
    } else {
      info.append(h('p', { class: 'dim', style: 'margin:12px 0' }, 'Raise a hero to see how this ghost fights you.'),
        h('button', { class: 'btn', style: 'width:100%', onClick: () => go('raise') }, 'Raise a hero'));
    }
  }

  return () => { alive = false; removeEventListener('keydown', key); cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointerup', up); plinthGeo.dispose(); plinthMat.dispose(); };
});
