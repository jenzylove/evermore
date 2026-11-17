// Duel: two fighters face off in the pit. Each round you pick Strike, Guard or Special; the round then plays out
// as the sim decides, with the class animations, cuts, hit stop, shake, sparks and numbers.
// Every number shown comes from sim.trace(), the same arithmetic the covenant replays. The camera only dresses it.
import * as THREE from 'three';
import { engine, ease } from '../three/engine';
import { bolt, director, fitDistance, flash, pin, pop, portrait, screenFlash, shock, shot, sparks, ward } from '../three/fx';
import { world } from '../three/world';
import { CONTACT, TIER_COLOR, tierOf, type Fighter } from '../three/fighter';
import { GUARD, SPECIAL, STRIKE, ghostMoves, trace, xpNeed, type Ghost, type Hero, type Move, type RoundTrace } from '../game/sim';
import { activeHero, app, go, isPractice, register, renderChrome } from '../app';
import { setIntensity, sfx } from '../audio/sfx';
import { gearIcon, gearName, h, icon, money, toast } from './kit';
import type { HeroView } from '../chain/types';
import { MOVE_ICON } from './arena';

const CLS = ['knight', 'rogue', 'mage'];
const HERO_FX = ['#ffd27a', '#ff7a3c', '#ffffff'];
const GHOST_FX = ['#9ff4ff', '#3fb6c9', '#ffffff'];

register('duel', root => {
  const t0 = app.ticket;
  if (!t0) { queueMicrotask(() => go('arena', false)); return; }
  const ticket = t0;
  let hero: HeroView | null = null;
  const G = ticket.ghost;
  const ghostSim: Ghost = { ...G, ownerPkh: new Uint8Array(20) };
  const gMoves = ghostMoves(ticket.seed);
  const moves: Move[] = [];
  let hHp = 0, gHp = G.hp, hCh = 0, gCh = 0, busy = true, over = false;
  let A: Fighter | null = null, B: Fighter | null = null;
  const X = () => (portrait() ? 0.85 : 1.3);

  // ---- camera language ----
  const fovW = () => (portrait() ? 40 : 30);
  const two = () => { const fov = fovW(), d = Math.max(4.4, fitDistance(X() * 2 + (portrait() ? 1.1 : 2.6), fov)); return shot(0, 1.2, d, 0, portrait() ? 1.25 : 1.05, 0, fov); };
  const ots = (a: Fighter, b: Fighter) => {
    const pa = a.root.position, pb = b.root.position, dir = pb.clone().sub(pa).setY(0).normalize();
    const back = portrait() ? 2.6 : 2.0, side = portrait() ? 1.0 : 1.35;
    const cam = pa.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, 0, side)).setY(1.55);
    const look = pa.clone().lerp(pb, 0.62).setY(1.05);
    return shot(cam.x, cam.y, cam.z, look.x, look.y, look.z, portrait() ? 44 : 34);
  };
  const close = (f: Fighter, low = false) => {
    const p = f.root.position, s = Math.sign(-p.x || 1);
    return shot(p.x + s * 0.9, low ? 0.6 : 1.45, portrait() ? 2.9 : 2.3, p.x + s * 0.1, low ? 1.25 : 1.35, 0, portrait() ? 42 : 30);
  };

  // ---- HUD ----
  const plate = (side: 'l' | 'r') => {
    const nm = h('div', { class: 'nm' }), hp = h('div', { class: 'hp' }, h('i', {}), h('b', {})), n = h('span', {});
    const pips = h('span', { class: 'pips' }, h('i', {}), h('i', {}));
    return { el: h('div', { class: `plate ${side}` }, nm, hp, h('div', { class: 'hpn' }, n, pips)), nm, hp, n, pips };
  };
  const L = plate('l'), Rr = plate('r');
  const round = h('div', { class: 'round' });
  const btns = h('div', { class: 'moves wait' });
  const mk = (m: Move, label: string, sub: string, cls: string) => {
    const b = h('button', { class: `btn ${cls}`, onClick: () => play(m) }, icon(MOVE_ICON[m]), label, h('small', {}, sub));
    b.addEventListener('pointerdown', () => sfx.tap());
    return b;
  };
  const bS = mk(STRIKE, 'Strike', 'full hit', 'strike'), bG = mk(GUARD, 'Guard', 'half, +1 charge', 'guard'), bX = mk(SPECIAL, 'Special', '2 charges', '');
  btns.append(bS, bG, bX);
  const center = h('div', { class: 'pass', style: 'position:absolute;inset:0' });
  const hint = h('div', { class: 'duel-hint' });
  root.append(h('section', { class: 'screen duel' }, h('div', { class: 'hud scrim-t' }, L.el, round, Rr.el), hint, center, h('div', { style: 'margin-top:auto' }, btns)));
  const key = (e: KeyboardEvent) => { const m = { '1': STRIKE, '2': GUARD, '3': SPECIAL, s: STRIKE, g: GUARD, x: SPECIAL }[e.key]; if (m !== undefined) play(m as Move); };
  addEventListener('keydown', key);

  // the ghost's next move floats over its head: fixed by the seed, never hidden
  const intent = h('div', { class: 'intent' });
  let unpin: (() => void) | null = null;
  const showIntent = () => {
    intent.innerHTML = '';
    if (over || moves.length >= 12 || !B) { intent.style.display = 'none'; return; }
    const m = gMoves[moves.length];
    intent.style.display = ''; intent.className = `intent m${m}`; void intent.offsetWidth; intent.classList.add('pop-in');
    intent.append(icon(MOVE_ICON[m]));
  };

  const hud = () => {
    if (!hero) return;
    const set = (p: typeof L, cur: number, max: number, ch: number, name: string) => {
      p.nm.textContent = name;
      const w = `${Math.max(0, cur) / max * 100}%`;
      (p.hp.children[1] as HTMLElement).style.width = w; (p.hp.children[0] as HTMLElement).style.width = w;
      p.hp.classList.toggle('low', cur / max < 0.3);
      p.n.textContent = `${Math.max(0, cur)} / ${max}`;
      [...p.pips.children].forEach((x, i) => x.classList.toggle('on', ch > i));
    };
    set(L, hHp, hero.hp, hCh, hero.name);
    set(Rr, gHp, G.hp, gCh, G.name);
    round.innerHTML = over ? '' : `Round<b>${moves.length + 1}</b>`;
    hint.textContent = !over && moves.length === 0 ? 'Its next move shows above its head' : '';
    bX.disabled = hCh < 2;
    (bX.querySelector('small') as HTMLElement).textContent = hCh >= 2 ? 'double hit' : `${hCh} of 2 charges`;
  };

  (async () => {
    hero = await activeHero();
    if (!hero || hero.id !== ticket.heroId) { toast('That hero is not in your satchel.', true); go('arena'); return; }
    const gear = (await app.chain.myGear()).filter(x => x.where === 'satchel');
    [A, B] = await Promise.all([world.fighter(hero.cls, { level: hero.level, gear }), world.fighter(G.cls, { level: G.level }, 0.6)]);
    A.root.position.set(-X(), 0, 0); B.root.position.set(X(), 0, 0);
    A.face(1, 0); B.face(-1, 0);
    hHp = hero.hp;
    hud(); setIntensity(1);
    unpin = pin(intent, () => B!.point('head', new THREE.Vector3()).add(new THREE.Vector3(0, 0.32, 0)));
    intent.style.display = 'none';
    // intro: the camera comes round from behind the ghost, both fighters posture, then the two shot
    director.cut(close(B, true)); director.drift = 0.3;
    director.move(ots(B, A), 1400, ease.inOut);
    B.once('taunt', { fade: 0.2 });
    await engine.wait(900);
    A.once('taunt', { fade: 0.2 });
    director.move(two(), 1100, ease.inOut);
    await banner(`${hero.name}`, `${G.name}`, isPractice() ? 'Practice duel' : 'The chain will check every move', 1500);
    director.drift = 0.6;
    busy = false; btns.classList.remove('wait'); showIntent();
  })();

  async function banner(a: string, b: string, small: string, ms: number) {
    const el = h('div', { class: 'titlecard' }, h('h2', { class: 'vs' }, a), h('p', { style: 'margin:6px 0;font-size:13px' }, 'versus'), h('h2', { class: 'vs', style: 'color:var(--spirit)' }, b), h('p', {}, small));
    center.append(el); sfx.reveal();
    await engine.wait(ms); el.style.transition = 'opacity 260ms'; el.style.opacity = '0'; await engine.wait(260); el.remove();
  }

  async function play(m: Move) {
    if (busy || over || !hero || !A || !B) return;
    if (m === SPECIAL && hCh < 2) { toast('Special needs 2 charges. Guard to charge.'); return; }
    busy = true; btns.classList.add('wait'); intent.style.display = 'none';
    moves.push(m);
    const tr = trace(hero as Hero, ghostSim, ticket.seed, moves);
    const r = tr[tr.length - 1];
    await animateRound(r);
    hHp = r.hHp; gHp = r.gHp; hCh = r.hCharge; gCh = r.gCharge;
    hud();
    busy = false;
    if (gHp <= 0) return finish(true);
    if (hHp <= 0) return finish(false);
    if (moves.length >= 12) return finish(false, true);
    showIntent();
    btns.classList.remove('wait');
  }

  const wards: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; f: Fighter }[] = [];
  async function raiseWard(f: Fighter, mine: boolean) {
    f.once('guard', { fade: 0.1, speed: 1.6, hold: true });
    const w = ward(mine ? '#9fc4ff' : '#7fe9ff');
    w.mesh.position.set(0, 1.0, 0.45); f.root.add(w.mesh);
    wards.push({ ...w, f });
    sparks(f.point('chest').add(new THREE.Vector3(Math.sign(-f.root.position.x) * 0.5, 0, 0)), 14, mine ? ['#cfe0ff', '#ffffff'] : ['#bff9ff', '#7fe9ff'], 2.2, 0, 0.5);
    await engine.tween(220, p => { w.mat.uniforms.uA.value = ease.outBack(p); w.mat.uniforms.uT.value = engine.t; });
  }
  async function dropWards() {
    const ws = wards.splice(0);
    await engine.tween(200, p => ws.forEach(w => { w.mat.uniforms.uA.value = 1 - p; }));
    ws.forEach(w => { w.mesh.removeFromParent(); if (w.f.clipName === 'guard') w.f.play('idle', 0.3); });
  }

  async function animateRound(r: RoundTrace) {
    const a = A!, b = B!;
    // guards go up first, together
    const g: Promise<void>[] = [];
    if (r.heroMove === GUARD) g.push(raiseWard(a, true).then(() => { hCh = r.hCharge; hud(); }));
    if (r.ghostMove === GUARD) g.push(raiseWard(b, false).then(() => { gCh = r.gCharge; hud(); }));
    if (g.length) { sfx.ward(); sfx.charge(); director.move(two(), 400); await Promise.all(g); await engine.wait(250); }
    for (const beat of r.beats) {
      const mine = beat.who === 'hero';
      const atk = mine ? a : b, tgt = mine ? b : a;
      await strike(atk, tgt, beat.special, beat.dmg, beat.blocked, beat.targetHp, mine);
      if (mine) { gHp = beat.targetHp; if (beat.special) hCh = 0; } else { hHp = beat.targetHp; if (beat.special) gCh = 0; }
      hud();
      if (beat.targetHp <= 0) break;
      await engine.wait(140);
    }
    if (!r.beats.length) await engine.wait(400); // both guarded: a held breath
    await dropWards();
    if (r.hHp > 0 && r.gHp > 0) director.move(two(), 520);
    // a full charge shows on the body
    [a, b].forEach((f, i) => { const ch = i ? r.gCharge : r.hCharge; if (ch >= 2) { f.flash(0.5); sparks(f.point('hand'), 12, i ? ['#7fe9ff'] : ['#ffd27a'], 1.2, -1, 0.8); } });
  }

  async function strike(a: Fighter, b: Fighter, special: boolean, dmg: number, blocked: boolean, left: number, mine: boolean) {
    const c = CONTACT[CLS[a.cls]];
    const home = a.root.position.clone();
    const dir = Math.sign(b.root.position.x - home.x);
    const fxc = mine ? HERO_FX : GHOST_FX;
    const kill = left <= 0;
    if (special) {
      // the build up: the world drops away, the attacker burns, time slows, the camera moves in on them
      sfx.specialUp(); world.arena.dim(1);
      director.cut(close(a)); director.move(close(a, true), 700, ease.outCubic);
      a.flash(0.9);
      sparks(a.root.position.clone().setY(0.2), 40, [fxc[0], '#ffffff'], 2.5, -2, 0.9);
      shock(a.root.position.clone().setY(0.06), fxc[0], 2.2, 0.5);
      pop(a.point('head').add(new THREE.Vector3(0, 0.35, 0)), 'Special', 'word');
      engine.slow = 0.55;
      await engine.wait(420);
      engine.slow = 1;
    }
    // cut to over the attacker's shoulder for the exchange
    director.cut(ots(a, b));
    sfx.whoosh(special);
    const anim = a.once(special ? 'special' : 'strike', { fade: 0.08, speed: special ? c.sspeed : c.speed, at: special ? c.special : c.strike });
    const contactMs = anim.ms * (special ? c.special : c.strike);
    if (a.cls !== 2) {
      // close the distance during the wind up
      const stop = b.root.position.x - dir * (special ? 0.95 : 1.05);
      const dash = Math.min(contactMs * 0.8, 420);
      engine.tween(dash, p => { a.root.position.x = home.x + (stop - home.x) * ease.inOut(p); });
      director.move(ots(a, b), dash);
      await anim.hit;
    } else {
      await anim.hit;
      sfx.bolt();
      await bolt(a.point('hand'), b.point('chest'), fxc[0], special ? 300 : 220, special);
    }
    impact(a, b, special, dmg, blocked, kill, mine);
    // the target reels
    const bHome = b.root.position.x;
    const kb = (special ? 0.45 : 0.25) * (blocked ? 0.35 : 1) * dir;
    if (!blocked && !kill) b.once('hit', { fade: 0.06, speed: 1.4 });
    if (kill) { await ko(b, a, mine); return; }
    await engine.tween(160, p => { b.root.position.x = bHome + kb * Math.sin(p * Math.PI * 0.5); });
    if (special) world.arena.dim(0);
    await engine.wait(160);
    // recover: both settle back onto their marks
    const ax = a.root.position.x, bx = b.root.position.x;
    await engine.tween(320, p => { const k = ease.inOut(p); a.root.position.x = ax + (home.x - ax) * k; b.root.position.x = bx + (bHome - bx) * k; });
  }

  function impact(a: Fighter, b: Fighter, special: boolean, dmg: number, blocked: boolean, kill: boolean, mine: boolean) {
    const fxc = mine ? HERO_FX : GHOST_FX;
    const at = b.point('chest').add(new THREE.Vector3(Math.sign(a.root.position.x - b.root.position.x) * 0.25, 0, 0.1));
    engine.hitstop(kill ? 240 : special ? 170 : blocked ? 55 : 95);
    director.shake(kill ? 0.95 : special ? 0.8 : blocked ? 0.22 : 0.45);
    const away = new THREE.Vector3(Math.sign(b.root.position.x - a.root.position.x), 0.3, 0);
    if (blocked) {
      sfx.clang();
      sparks(at, 26, ['#ffffff', '#bcd4ff', '#ffd27a'], 5, 7, 0.45, away);
      flash(at, '#bcd4ff', 0.9, 0.16);
      b.flash(0.35);
      pop(b.point('head').add(new THREE.Vector3(0, 0.15, 0)), String(dmg), 'block');
      pop(b.point('head').add(new THREE.Vector3(0, -0.15, 0)), 'Blocked', 'word');
    } else {
      sfx.hit(special || kill);
      sparks(at, special ? 70 : 34, [...fxc, '#ff4a2a'], special ? 7 : 5, 8, 0.6, away);
      flash(at, fxc[0], special ? 2.4 : 1.4, special ? 0.3 : 0.2);
      shock(at, fxc[0], special ? 1.8 : 0.9, 0.3);
      b.flash(1);
      pop(b.point('head').add(new THREE.Vector3(0, 0.2, 0)), String(dmg), special || dmg >= 12 ? 'big' : mine ? 'dmg' : 'spirit');
    }
    if (special || kill) screenFlash(special ? '#fff3d6' : '#ffffff', special ? 0.55 : 0.4);
  }

  async function ko(b: Fighter, a: Fighter, mine: boolean) {
    sfx.ko();
    engine.slow = 0.28;
    world.arena.dim(0.6);
    const p = b.root.position.clone();
    director.drift = 0;
    director.orbit = t => { const k = t * 0.5; return shot(p.x + Math.sin(k) * 2.6, 0.9, Math.cos(k) * 2.6 + 0.4, p.x, 0.75, 0, portrait() ? 46 : 34); };
    b.once('ko', { fade: 0.08, hold: true });
    sparks(b.point('chest'), 60, mine ? ['#7fe9ff', '#ffffff'] : ['#ff5a3c', '#ffd36b'], 3, -0.5, 2.2);
    await engine.wait(700);
    engine.slow = 0.6;
    await engine.wait(900);
    engine.slow = 1; world.arena.dim(0);
    if (mine) {
      // a beaten ghost comes apart into light
      const body = b.point('chest');
      for (let i = 0; i < 4; i++) sparks(body.clone().add(new THREE.Vector3(0, -0.4 + i * 0.2, 0)), 30, ['#7fe9ff', '#ffffff', '#3fb6c9'], 1.2, -1.4, 2.4);
      b.setSpectral(1);
      await engine.tween(900, k => { b.ghostGlow(1 - k); b.root.position.y = -k * 0.15; b.root.scale.setScalar(1 - k * 0.04); b.mats.forEach(m => { m.opacity = 1 - k; }); });
      b.root.visible = false;
    }
    director.orbit = null; director.drift = 0.6;
    a.root.position.x = a.root.position.x; // winner keeps their ground
  }

  async function finish(won: boolean, outOfRounds = false) {
    over = true; hud(); setIntensity(0); unpin?.(); intent.remove();
    btns.remove(); hint.remove();
    const f = app.chain.fees();
    if (!won) {
      sfx.lose();
      if (outOfRounds) { B!.once('taunt', { fade: 0.2 }); director.move(close(B!), 900); }
      else { B!.once('victory', { fade: 0.25, hold: true }); director.move(close(B!, true), 1400); }
      center.append(h('div', { class: 'titlecard' }, h('h2', { class: 'red' }, 'Fallen'),
        h('p', {}, outOfRounds ? `${G.name} held out for 12 rounds` : `${G.name} holds the pit`)));
      const panel = h('div', { class: 'forge scrim-b' }, h('div', { class: 'wrap' },
        h('p', { class: 'dim', style: 'margin:0 0 4px' }, isPractice() ? 'Practice. Nothing was lost.' : `Your ${money(f.challengeSats, f.usdPerBch)} went to its owner. Your hero keeps everything else.`),
        h('p', { class: 'dim', style: 'margin:0' }, 'Its moves are shown before each round. Guard on its Strikes, Special when it Guards.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onClick: () => go('arena') }, 'Arena'),
          h('button', { class: 'btn spirit', onClick: rematch }, 'Again', h('small', {}, isPractice() ? 'practice' : money(f.challengeSats, f.usdPerBch))))));
      root.querySelector('.screen')!.append(panel);
      return;
    }
    sfx.win();
    const a = A!;
    a.face(0, 4);
    a.once('victory', { fade: 0.25, hold: true });
    director.move(portrait() ? shot(a.root.position.x + 0.2, 0.55, 3.6, a.root.position.x, 1.15, 0, 44) : shot(a.root.position.x + 1.1, 0.6, 3.4, a.root.position.x + 0.9, 1.05, 0, 32), 1600, ease.outCubic);
    sparks(a.root.position.clone().setY(0.2), 60, ['#ffd27a', '#fff1c1', '#ff9d3c'], 4, 2, 1.4);
    const card = h('div', { class: 'titlecard', style: 'top:18%' }, h('h2', { class: 'gold' }, 'Victory'), h('p', {}, `in ${moves.length} round${moves.length > 1 ? 's' : ''}, ${hHp} HP left`));
    center.append(card);
    await engine.wait(1300);
    await forge(card);
  }

  async function forge(card: HTMLElement) {
    const hero0 = hero!;
    const seal = h('div', { class: 'seal' }, h('span', { class: 'dot' }), isPractice() ? 'Practice · forging in your browser' : 'Forging on Bitcoin Cash');
    const xpI = h('i', {}), xpBar = h('div', { class: 'xpbar' }, xpI);
    const xpL = h('span', {}), xpR = h('span', {});
    const extra = h('div', {});
    const actions = h('div', { class: 'row' });
    const panel = h('div', { class: 'forge scrim-b' }, h('div', { class: 'wrap' }, h('div', { class: 'eyebrow' }, 'Forge'), seal, xpBar, h('div', { class: 'xprow' }, xpL, xpR), extra, actions));
    root.querySelector('.screen')!.append(panel);
    xpI.style.width = `${hero0.xp / xpNeed(hero0.level) * 100}%`;
    xpL.textContent = `Level ${hero0.level}`; xpR.textContent = `${hero0.xp} / ${xpNeed(hero0.level)} XP`;
    let res;
    try { res = await app.chain.forge(ticket, moves); }
    catch (e) { seal.textContent = (e as Error).message; actions.append(h('button', { class: 'btn ghost', onClick: () => go('arena') }, 'Arena')); return; }
    seal.innerHTML = '';
    if (res.receipt.explorer) {
      seal.replaceWith(h('a', { class: 'seal', href: res.receipt.explorer, target: '_blank', rel: 'noopener' }, h('span', { class: 'dot' }), 'Sealed on Bitcoin Cash', icon('link')));
    } else seal.append(h('span', { class: 'dot' }), 'Practice · not sealed on chain');
    card.style.transition = 'transform 400ms, opacity 400ms'; card.style.transform = 'translateY(-30px) scale(0.8)'; card.style.opacity = '0';
    const need0 = xpNeed(hero0.level);
    const total = hero0.xp + res.xpGain;
    const steps = Math.min(30, res.xpGain);
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(hero0.xp + (res.xpGain * i) / steps);
      xpI.style.width = `${Math.min(1, x / need0) * 100}%`;
      xpR.textContent = `${Math.min(x, need0)} / ${need0} XP  +${Math.round(res.xpGain * i / steps)}`;
      sfx.xtick(); await engine.wait(28);
    }
    const a = A!;
    const gearNow = (await app.chain.myGear()).filter(x => x.where === 'satchel');
    if (res.levelled) {
      xpI.classList.add('flash'); await engine.wait(80); xpI.classList.remove('flash');
      // the new level is worn on the body, right now
      sfx.levelUp(); screenFlash('#ffd58a', 0.6); director.shake(0.45);
      const t = tierOf(res.hero.level), col = TIER_COLOR[Math.max(1, t)];
      shock(a.root.position.clone().setY(0.05), col, 3.4, 0.6); flash(a.point('chest'), col, 2.6, 0.4);
      sparks(a.root.position.clone().setY(0.3), 90, [col, '#fff1c1', '#ffffff'], 5, 2, 1.5);
      a.setLook({ level: res.hero.level, gear: gearNow }); a.flash(1.2);
      xpI.style.width = '0%'; await engine.wait(60);
      xpI.style.width = `${res.hero.xp / xpNeed(res.hero.level) * 100}%`;
      xpL.textContent = `Level ${res.hero.level}`; xpR.textContent = `${res.hero.xp} / ${xpNeed(res.hero.level)} XP`;
      const d = (k: 'hp' | 'atk' | 'def' | 'spd', n: string) => res.hero[k] > hero0[k] ? h('span', {}, `${n} +${res.hero[k] - hero0[k]}`) : null;
      const newTier = tierOf(res.hero.level) > tierOf(hero0.level);
      extra.append(h('div', { class: 'lvup' }, `Level ${res.hero.level}`, newTier ? h('small', {}, ['', 'Shoulders plated', 'Veins of fire, a burning hand', 'A halo, and an aura', 'Crowned'][tierOf(res.hero.level)]) : null),
        h('div', { class: 'gain' }, d('hp', 'HP'), d('atk', 'ATK'), d('def', 'DEF'), d('spd', 'SPD')));
    } else xpR.textContent = `${total} / ${need0} XP  +${res.xpGain}`;
    if (res.gear) {
      await engine.wait(500); sfx.reveal();
      const g = res.gear;
      a.setLook({ level: res.hero.level, gear: gearNow }); a.flash(0.8);
      sparks(a.point('chest'), 40, ['#ffd27a', '#ffffff'], 3, 2, 1);
      extra.append(h('div', { class: 'drop-reveal' }, gearIcon(g.kind, g.tier),
        h('div', {}, h('div', { class: 'gold', style: 'font:700 20px var(--display)' }, gearName(g.kind, g.tier)),
          h('div', { class: 'dim', style: 'font-size:14px' }, `Gear #${g.id} of a capped 5,000. Worn now; yours to keep or sell.`))));
    }
    hero = res.hero; renderChrome();
    actions.append(h('button', { class: 'btn ghost', onClick: () => go('hero') }, 'Hero'), h('button', { class: 'btn spirit', onClick: () => go('arena') }, 'Next fight'));
  }

  async function rematch() {
    try { app.ticket = await app.chain.challenge(ticket.heroId, G.id); go('duel'); }
    catch (e) { toast((e as Error).message, true); }
  }

  return () => { removeEventListener('keydown', key); setIntensity(0); unpin?.(); };
});
