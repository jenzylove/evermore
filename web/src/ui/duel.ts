// Duel: your hero meets the echo of another player's hero in the hall. Each round you pick Strike, Guard or Special;
// the round then plays out as the sim decides, with the class animations, cuts, hit stop, sparks and numbers.
// A win ends with the ghost shattering into light and the Forge, where what was earned comes into being on the hero.
// Every number shown comes from sim.trace(), the same arithmetic the covenant replays. The camera only dresses it.
import * as THREE from 'three';
import { engine, ease } from '../three/engine';
import { bolt, director, fitDistance, flash, pin, pop, portrait, screenFlash, shock, shot, sparks, ward } from '../three/fx';
import { world } from '../three/world';
import { CONTACT, ECHO, TIER_NAME, echoTint, tierOf, type Fighter } from '../three/fighter';
import { GHOST_LIGHT, haunt, type GhostFx } from '../three/ghost';
import { beginRite } from '../three/forge';
import { glyphSvg } from '../three/runes';
import { GUARD, SPECIAL, STRIKE, ghostMoves, seedOf, solve, styleHash, trace, xpNeed, type Ghost, type Hero, type Move, type RoundTrace } from '../game/sim';
import type { GhostView } from '../chain/types';
import { activeHero, app, go, isPractice, markPracticeDone, register, renderChrome } from '../app';
import { setIntensity, sfx } from '../audio/sfx';
import { gearIcon, gearName, h, icon, money, toast } from './kit';
import type { HeroView } from '../chain/types';
import { MOVE_ICON } from './arena';

/** what one level adds, by class (the same growth the forge contract writes) */
const GROW_TEXT = ['+3 HP, +1 ATK, +2 DEF', '+2 HP, +2 ATK, +2 SPD', '+1 HP, +3 ATK, +1 DEF, +1 SPD'];
const CLS = ['knight', 'rogue', 'mage'];
const HERO_FX = ['#ffd27a', '#ff7a3c', '#ffffff'];
const GHOST_FX = ['#cfeaff', '#8fc8ff', '#ffffff'];

register('duel', root => {
  const t0 = app.ticket;
  if (!t0) { queueMicrotask(() => go('arena', false)); return; }
  const ticket = t0;
  let hero: HeroView | null = null;
  const G = ticket.ghost;
  const ghostSim: Ghost = { ...G, ownerPkh: new Uint8Array(20) };
  const gMoves = ghostMoves(ticket.seed);
  const moves: Move[] = [];
  let hHp = 0, gHp = G.hp, hCh = 0, gCh = 0, busy = true, over = false, powerShown = false;
  let A: Fighter | null = null, B: Fighter | null = null, ghost: GhostFx | null = null;
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
  const plate = (side: 'l' | 'r', sub: string) => {
    const nm = h('div', { class: 'nm' }), hp = h('div', { class: 'hp' }, h('i', {}), h('b', {})), n = h('span', { class: 'n' });
    const pips = h('span', { class: 'pips', title: 'Power: each Guard fills half; full = a Power hit (double damage)' }, h('b', {}, 'Power'), h('i', {}), h('i', {}));
    return { el: h('div', { class: `plate ${side}` }, h('div', { class: 'sub' }, sub), nm, hp, h('div', { class: 'hpn' }, n, pips)), nm, hp, n, pips };
  };
  const L = plate('l', 'Hero'), Rr = plate('r', 'Echo');
  // the round counter is a line of twelve runes; the current one burns, the spent ones stay faintly lit
  const runes = [...Array(12)].map(() => h('span', { class: 'rp' }));
  runes.forEach((x, i) => x.append(glyphSvg(200 + i)));
  const round = h('div', { class: 'round' }, h('div', { class: 'rl' }), h('div', { class: 'rr' }, ...runes));
  const btns = h('div', { class: 'moves wait' });
  const mk = (m: Move, label: string, sub: string, cls: string) => {
    const b = h('button', { class: `btn ${cls}`, onClick: () => play(m) }, icon(MOVE_ICON[m]), label, h('small', {}, sub));
    b.addEventListener('pointerdown', () => sfx.tap());
    return b;
  };
  const bS = mk(STRIKE, 'Strike', 'full hit', 'strike'), bG = mk(GUARD, 'Guard', 'half · +1 power', 'guard'), bX = mk(SPECIAL, 'Power', 'guard to charge', 'special');
  btns.append(bS, bG, bX);
  const center = h('div', { class: 'pass', style: 'position:absolute;inset:0' });
  const hint = h('div', { class: 'duel-hint' });
  root.append(h('section', { class: 'screen duel' }, h('div', { class: 'hud scrim-t' }, L.el, round, Rr.el), center, h('div', { style: 'margin-top:auto' }, hint, btns)));
  const key = (e: KeyboardEvent) => { const m = { '1': STRIKE, '2': GUARD, '3': SPECIAL, s: STRIKE, g: GUARD, x: SPECIAL }[e.key]; if (m !== undefined) play(m as Move); };
  addEventListener('keydown', key);

  // the ghost's next move floats over its head: fixed by the seed, never hidden
  const intent = h('div', { class: 'intent' });
  let unpin: (() => void) | null = null;
  // the two moments a player must never miss, shown as banners across the middle of the screen at the start of a turn
  const banner = (title: string, sub: string, tone: 'gold' | 'red') => {
    document.querySelector('.cue')?.remove();
    const el = h('div', { class: `cue ${tone}` }, h('b', {}, title), h('span', {}, sub));
    document.body.append(el);
    setTimeout(() => el.classList.add('out'), 2200); setTimeout(() => el.remove(), 2700);
  };
  const turnCues = () => {
    if (over) return;
    const theirs = gMoves[moves.length] === SPECIAL && gCh >= 2;
    if (theirs) { banner('Power incoming', `${G.name} hits double next. Guard to take half.`, 'red'); sfx.charge(); return; }
    if (hCh >= 2 && !powerShown) { powerShown = true; L.pips.classList.add('burst'); setTimeout(() => L.pips.classList.remove('burst'), 900); banner('Power ready', 'Tap Power for a double hit.', 'gold'); sfx.charge(); }
  };
  const showIntent = () => {
    intent.innerHTML = '';
    if (over || moves.length >= 12 || !B) { intent.style.display = 'none'; return; }
    const m = gMoves[moves.length];
    intent.style.display = ''; intent.className = `intent m${m}${m === SPECIAL && gCh >= 2 ? ' danger' : ''}`; void intent.offsetWidth; intent.classList.add('pop-in');
    intent.append(icon(MOVE_ICON[m]));
  };

  const hud = () => {
    if (!hero) return;
    const set = (p: typeof L, cur: number, max: number, ch: number, name: string) => {
      p.nm.textContent = name;
      const w = `${Math.max(0, cur) / max * 100}%`;
      (p.hp.children[1] as HTMLElement).style.width = w; (p.hp.children[0] as HTMLElement).style.width = w;
      p.hp.classList.toggle('low', cur / max < 0.3);
      p.n.textContent = `${Math.max(0, cur)}`;
      [...p.pips.querySelectorAll('i')].forEach((x, i) => x.classList.toggle('on', ch > i));
      p.pips.classList.toggle('full', ch >= 2);
    };
    set(L, hHp, hero.hp, hCh, hero.name);
    set(Rr, gHp, G.hp, gCh, G.name);
    const r = moves.length;
    (round.firstChild as HTMLElement).textContent = over ? '' : `Round ${r + 1}`;
    runes.forEach((x, i) => { x.className = `rp${i < r ? ' past' : ''}${i === r && !over ? ' now' : ''}`; });
    hint.textContent = '';
    bX.disabled = hCh < 2; bX.classList.toggle('ready', hCh >= 2);
    if (hCh < 2) powerShown = false;
    (bX.querySelector('small') as HTMLElement).textContent = hCh >= 2 ? 'double hit · ready' : `guard to charge ${hCh}/2`;
  };

  (async () => {
    hero = await activeHero();
    if (!hero || hero.id !== ticket.heroId) { toast('That hero is not in your satchel.', true); go('arena'); return; }
    const gear = (await app.chain.myGear()).filter(x => x.where === 'satchel');
    [A, B] = await Promise.all([world.fighter(hero.cls, { level: hero.level, gear }), world.fighter(G.cls, { level: G.level }, ECHO)]);
    B.tint(echoTint(G.id));
    A.root.position.set(-X(), 0, 0); B.root.position.set(X(), 0, 0);
    A.face(1, 0); B.face(-1, 0);
    ghost = haunt(B, { name: G.name, owner: G.owner });
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
    await meet(hero.name, G.name, G.owner, isPractice() ? 'Practice duel' : 'The chain checks every move', 1700);
    director.drift = 0.6;
    busy = false; btns.classList.remove('wait'); showIntent(); hud();
  })();

  // the meeting: a quiet line of words, not a splash. Your hero, the echo it meets, and who keeps that echo.
  async function meet(a: string, b: string, owner: string, small: string, ms: number) {
    const el = h('div', { class: 'meet' },
      h('div', { class: 'a' }, a),
      h('div', { class: 'mid' }, h('i', {}), 'meets the echo of', h('i', {})),
      h('div', { class: 'b' }, b),
      h('div', { class: 'k' }, `kept by ${owner}`, h('span', {}, ' · ', small)));
    center.append(el); sfx.reveal();
    await engine.wait(ms); el.classList.add('out'); await engine.wait(420); el.remove();
  }

  async function play(m: Move) {
    if (over || !hero || !A || !B) return;
    if (busy) return; // a round is playing: nothing is ever played for you
    if (m === SPECIAL && hCh < 2) { toast('Power needs a full power bar. Each Guard fills half.'); return; }
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
    showIntent(); hud();
    btns.classList.remove('wait');
    turnCues();
  }

  const wards: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; f: Fighter }[] = [];
  async function raiseWard(f: Fighter, mine: boolean) {
    f.once('guard', { fade: 0.1, speed: 1.6, hold: true });
    const w = ward(mine ? '#ffe2a6' : '#a9d8ff');
    w.mesh.position.set(0, 1.0, 0.45); f.root.add(w.mesh);
    wards.push({ ...w, f });
    sparks(f.point('chest').add(new THREE.Vector3(Math.sign(-f.root.position.x) * 0.5, 0, 0)), 14, mine ? ['#ffe9bf', '#ffffff'] : ['#d8efff', '#a9d8ff'], 2.2, 0, 0.5);
    await engine.tween(150, p => { w.mat.uniforms.uA.value = ease.outBack(p); w.mat.uniforms.uT.value = engine.t; });
  }
  async function dropWards() {
    const ws = wards.splice(0);
    await engine.tween(130, p => ws.forEach(w => { w.mat.uniforms.uA.value = 1 - p; }));
    ws.forEach(w => { w.mesh.removeFromParent(); if (w.f.clipName === 'guard') w.f.play('idle', 0.3); });
  }

  async function animateRound(r: RoundTrace) {
    const a = A!, b = B!;
    // guards go up first, together
    const g: Promise<void>[] = [];
    if (r.heroMove === GUARD) g.push(raiseWard(a, true).then(() => { hCh = r.hCharge; hud(); }));
    if (r.ghostMove === GUARD) g.push(raiseWard(b, false).then(() => { gCh = r.gCharge; hud(); }));
    if (g.length) { sfx.ward(); sfx.charge(); director.move(two(), 400); await Promise.all(g); await engine.wait(110); }
    for (const beat of r.beats) {
      const mine = beat.who === 'hero';
      const atk = mine ? a : b, tgt = mine ? b : a;
      await strike(atk, tgt, beat.special, beat.dmg, beat.blocked, beat.targetHp, mine);
      if (mine) { gHp = beat.targetHp; if (beat.special) hCh = 0; } else { hHp = beat.targetHp; if (beat.special) gCh = 0; }
      hud();
      if (beat.targetHp <= 0) break;
      await engine.wait(60);
    }
    if (!r.beats.length) await engine.wait(300); // both guarded: a held breath
    await dropWards();
    if (r.hHp > 0 && r.gHp > 0) director.move(two(), 520);
    // a full charge shows on the body
    [a, b].forEach((f, i) => { const ch = i ? r.gCharge : r.hCharge; if (ch >= 2) { f.flash(0.5); sparks(f.point('hand'), 12, i ? [GHOST_LIGHT] : ['#ffd27a'], 1.2, -1, 0.8); } });
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
      director.cut(close(a)); director.move(close(a, true), 420, ease.outCubic);
      a.flash(0.9);
      sparks(a.root.position.clone().setY(0.2), 40, [fxc[0], '#ffffff'], 2.5, -2, 0.9);
      shock(a.root.position.clone().setY(0.06), fxc[0], 2.2, 0.5);
      pop(a.point('head').add(new THREE.Vector3(0, 0.35, 0)), 'Power', 'word');
      engine.slow = 0.6;
      await engine.wait(260);
      engine.slow = 1;
    }
    // cut to over the attacker's shoulder for the exchange
    director.cut(ots(a, b));
    sfx.whoosh(special);
    const anim = a.once(special ? 'special' : 'strike', { fade: 0.08, speed: (special ? c.sspeed : c.speed) * 1.3, at: special ? c.special : c.strike });
    const contactMs = anim.ms * (special ? c.special : c.strike);
    if (a.cls !== 2) {
      // close the distance during the wind up
      const stop = b.root.position.x - dir * (special ? 0.95 : 1.05);
      const dash = Math.min(contactMs * 0.8, 300);
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
    await engine.tween(130, p => { b.root.position.x = bHome + kb * Math.sin(p * Math.PI * 0.5); });
    if (special) world.arena.dim(0);
    await engine.wait(70);
    // recover: both settle back onto their marks
    const ax = a.root.position.x, bx = b.root.position.x;
    await engine.tween(220, p => { const k = ease.inOut(p); a.root.position.x = ax + (home.x - ax) * k; b.root.position.x = bx + (bHome - bx) * k; });
  }

  function impact(a: Fighter, b: Fighter, special: boolean, dmg: number, blocked: boolean, kill: boolean, mine: boolean) {
    const fxc = mine ? HERO_FX : GHOST_FX;
    const at = b.point('chest').add(new THREE.Vector3(Math.sign(a.root.position.x - b.root.position.x) * 0.25, 0, 0.1));
    engine.hitstop(kill ? 200 : special ? 160 : blocked ? 55 : 90);
    director.shake(kill ? 0.6 : special ? 0.6 : blocked ? 0.2 : 0.38);
    const away = new THREE.Vector3(Math.sign(b.root.position.x - a.root.position.x), 0.3, 0);
    if (blocked) {
      sfx.clang();
      sparks(at, 26, ['#ffffff', '#bcd4ff', '#ffd27a'], 5, 7, 0.45, away);
      flash(at, '#bcd4ff', 0.9, 0.16);
      b.flash(0.35);
      pop(b.point('head').add(new THREE.Vector3(0, 0.15, 0)), `\u2212${dmg}`, mine ? 'them' : 'you');
      pop(b.point('head').add(new THREE.Vector3(0, -0.2, 0)), 'Guarded \u00b7 half', 'word');
    } else {
      sfx.hit(special || kill);
      sparks(at, special ? 70 : 34, fxc, special ? 7 : 5, 8, 0.6, away);
      flash(at, fxc[0], special ? 2.4 : 1.4, special ? 0.3 : 0.2);
      shock(at, fxc[0], special ? 1.8 : 0.9, 0.3);
      b.flash(1);
      pop(b.point('head').add(new THREE.Vector3(0, 0.2, 0)), `\u2212${dmg}`, `${mine ? 'them' : 'you'}${special || dmg >= 12 ? ' big' : ''}`);
    }
    if (special || kill) screenFlash(special ? '#fff3d6' : '#eef5ff', special ? 0.5 : 0.45);
  }

  // the final blow lands crisp and short. A ghost does not fall: it shatters into light. A hero falls once, cleanly.
  async function ko(b: Fighter, a: Fighter, mine: boolean) {
    director.drift = 0;
    const p = b.root.position.clone();
    if (mine) {
      sfx.shatter();
      // hold on the ghost from low and close while it breaks
      director.move(shot(p.x + Math.sign(p.x) * 0.7, 1.0, portrait() ? 4.4 : 3.6, p.x - Math.sign(p.x) * 0.3, 1.3, 0, portrait() ? 46 : 34), 500, ease.outCubic);
      b.once('hit', { fade: 0.05, speed: 0.7, hold: true });
      await (ghost ? ghost.shatter() : Promise.resolve());
      await engine.wait(250);
    } else {
      sfx.ko();
      engine.slow = 0.55; world.arena.dim(0.4);
      director.move(shot(p.x + Math.sign(-p.x || 1) * 1.4, 0.8, portrait() ? 3.4 : 2.8, p.x, 0.7, 0, portrait() ? 46 : 34), 700, ease.outCubic);
      b.once('ko', { fade: 0.08, hold: true });
      sparks(b.point('chest'), 30, ['#ffe9bf', '#ffffff'], 2, -0.5, 1.4);
      await engine.wait(600);
      engine.slow = 1; world.arena.dim(0);
      await engine.wait(500);
    }
    director.drift = 0.6;
    void a;
  }

  async function finish(won: boolean, outOfRounds = false) {
    over = true; hud(); setIntensity(0); unpin?.(); intent.remove();
    btns.remove(); hint.remove();
    const f = app.chain.fees();
    if (!won) {
      sfx.lose();
      if (isPractice()) markPracticeDone(); // a finished practice fight, won or lost, unlocks real play
      if (outOfRounds) { B!.once('taunt', { fade: 0.2 }); director.move(close(B!), 900); }
      else { B!.once('victory', { fade: 0.25, hold: true }); director.move(close(B!, true), 1400); }
      center.append(h('div', { class: 'titlecard' }, h('h2', { class: 'fallen' }, 'Fallen'),
        h('p', {}, outOfRounds ? `${G.name} held out for 12 rounds` : `${G.name} holds the hall`)));
      const panel = h('div', { class: 'forge scrim-b' }, h('div', { class: 'wrap' },
        h('p', { class: 'dim', style: 'margin:0 0 4px' }, isPractice() ? 'Practice. Nothing was lost.' : 'Your hero keeps its level and XP. Read its next move and go again.'),
        h('p', { class: 'dim', style: 'margin:0' }, 'Its next move shows above its head. Guard on its Strikes to fill your power bar, then hit with Power. Its moves change every fight.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onClick: () => go('arena') }, 'Choose another'),
          h('button', { class: 'btn spirit', onClick: rematch }, 'Rematch', isPractice() ? null : h('small', {}, money(f.challengeSats, f.usdPerBch))))));
      root.querySelector('.screen')!.append(panel);
      return;
    }
    sfx.win();
    const a = A!;
    a.face(0, 4);
    a.once('victory', { fade: 0.25, hold: true });
    const card = h('div', { class: 'titlecard won', style: 'top:12%' }, h('h2', { class: 'gold' }, 'Victory'), h('p', {}, `in ${moves.length} round${moves.length > 1 ? 's' : ''}, ${hHp} HP left`));
    center.append(card);
    await engine.wait(700);
    await forge(card);
  }

  // The Forge. The hero is sealed in a column of light while the chain replays the duel; the XP lights the ring rune by
  // rune; a new level's pieces and any new gear come into being on the body one at a time. Then the camera settles.
  async function forge(card: HTMLElement) {
    const hero0 = hero!;
    const a = A!;
    const rite = beginRite(a);
    const seal = h('div', { class: `seal${isPractice() ? '' : ' pending'}` }, h('span', { class: 'dot' }), isPractice() ? 'Practice · forging in your browser' : 'Sealing on Bitcoin Cash');
    const xpI = h('i', {}), xpBar = h('div', { class: 'xpbar' }, xpI);
    const xpL = h('span', {}), xpR = h('span', {});
    const extra = h('div', {});
    const actions = h('div', { class: 'row' });
    const panel = h('div', { class: 'forge scrim-b' }, h('div', { class: 'wrap' }, h('div', { class: 'eyebrow' }, 'The Forge'), seal, xpBar, h('div', { class: 'xprow' }, xpL, xpR), extra, actions));
    root.querySelector('.screen')!.append(panel);
    xpI.style.width = `${hero0.xp / xpNeed(hero0.level) * 100}%`;
    xpL.textContent = `Level ${hero0.level}`; xpR.textContent = `${hero0.xp} / ${xpNeed(hero0.level)} XP`;
    let res;
    const minimum = engine.wait(1100); // let the column come all the way down before anything is written
    try { res = await app.chain.forge(ticket, moves); }
    catch (e) { seal.textContent = (e as Error).message; rite.settle(endShot()); actions.append(h('button', { class: 'btn ghost', onClick: () => go('arena') }, 'Arena')); return; }
    await minimum;
    seal.innerHTML = '';
    if (res.receipt.explorer) {
      // the chain moment: the seal turns Bitcoin Cash green and a green ring of light runs out across the floor
      seal.replaceWith(h('div', { class: 'sealed', 'data-txid': res.receipt.txid ?? '' }, h('i', { class: 'bchm' }), 'Sealed on Bitcoin Cash',
        h('a', { href: res.receipt.explorer, target: '_blank', rel: 'noopener' }, 'view', icon('link'))));
      const feet = a.root.position.clone().setY(0.05);
      shock(feet, '#0ac18e', 5.2, 1.2); shock(feet, '#43f0bd', 3.2, 0.8);
      sparks(feet.clone().setY(0.4), 60, ['#0ac18e', '#7af7cf', '#ffffff'], 2.6, -1, 1.6);
      sfx.chime(4);
    } else seal.append(h('span', { class: 'dot' }), 'Practice · not sealed on chain');
    card.style.transition = 'transform 600ms, opacity 600ms'; card.style.transform = 'translateY(-16px)'; card.style.opacity = '0';
    const need0 = xpNeed(hero0.level);
    const total = hero0.xp + res.xpGain;
    const steps = Math.min(30, res.xpGain);
    const big = h('div', { class: 'xpgain' }, '+0 XP');
    extra.append(big);
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(hero0.xp + (res.xpGain * i) / steps);
      big.textContent = `+${Math.round(res.xpGain * i / steps)} XP`;
      xpI.style.width = `${Math.min(1, x / need0) * 100}%`;
      xpR.textContent = `${Math.min(x, need0)} / ${need0} XP  +${Math.round(res.xpGain * i / steps)}`;
      sfx.xtick(); if (i % 3 === 0) rite.glyph();
      await engine.wait(34);
    }
    const gearNow = (await app.chain.myGear()).filter(x => x.where === 'satchel');
    if (res.levelled || res.gear) {
      const newTier = tierOf(res.hero.level) > tierOf(hero0.level);
      // the hero takes its new form: everything it wears comes in one piece at a time, each with a chime
      a.setLook({ level: res.hero.level, gear: gearNow });
      if (res.levelled) {
        xpI.classList.add('flash'); await engine.wait(80); xpI.classList.remove('flash');
        sfx.levelUp(); rite.crest(); a.flash(0.5);
        xpI.style.width = '0%'; await engine.wait(60);
        xpI.style.width = `${res.hero.xp / xpNeed(res.hero.level) * 100}%`;
        xpL.textContent = `Level ${res.hero.level}`; xpR.textContent = `${res.hero.xp} / ${xpNeed(res.hero.level)} XP`;
        const d = (k: 'hp' | 'atk' | 'def' | 'spd', n: string) => res.hero[k] > hero0[k] ? h('span', {}, `${n} +${res.hero[k] - hero0[k]}`) : null;
        extra.append(h('div', { class: 'lvup' }, `Level ${res.hero.level}`, newTier ? h('small', {}, ['', 'Shoulders plated', 'Veins of light, a burning hand', 'A halo, and an aura', 'Crowned'][tierOf(res.hero.level)], ` · ${TIER_NAME[tierOf(res.hero.level)]}`) : null),
          h('div', { class: 'gain' }, d('hp', 'HP'), d('atk', 'ATK'), d('def', 'DEF'), d('spd', 'SPD')));
      }
      await rite.materialise(a);
    } else {
      xpR.textContent = `${total} / ${need0} XP`;
      extra.append(h('div', { class: 'tonext' }, `${need0 - total} more XP to level ${hero0.level + 1}: `, h('b', {}, GROW_TEXT[hero0.cls])));
      await engine.wait(900);
    }
    if (res.gear) {
      sfx.reveal();
      const g = res.gear;
      extra.append(h('div', { class: 'drop-reveal' }, gearIcon(g.kind, g.tier),
        h('div', {}, h('div', { class: 'gold', style: 'font:700 20px var(--display)' }, gearName(g.kind, g.tier)),
          h('div', { class: 'dim', style: 'font-size:14px' }, `Gear #${g.id} of a capped 5,000. Worn now; yours to keep or sell.`))));
    }
    await engine.wait(600);
    rite.settle(endShot());
    hero = res.hero; renderChrome();
    actions.append(h('button', { class: 'btn ghost', onClick: () => go('hero') }, 'Hero'), h('button', { class: 'btn ghost', onClick: () => go('arena') }, 'Choose another'));
    const next = h('div', { class: 'whatsnext' });
    actions.before(next);
    const fee = app.chain.fees();
    const feeTxt = isPractice() ? '' : ` · ${money(fee.challengeSats, fee.usdPerBch)}`;
    const go2 = (g: GhostView, b: HTMLButtonElement) => async () => {
      b.setAttribute('disabled', '');
      try { app.focusGhost = g.id; app.ticket = await app.chain.challenge(res.hero.id, g.id); go('duel'); }
      catch (e) { toast((e as Error).message, true); b.removeAttribute('disabled'); }
    };
    Promise.all([nextFight(res.hero), gearFight(res.hero)]).then(([n, gf]) => {
      if (n) { const b: HTMLButtonElement = h('button', { class: 'btn spirit nextup' }, `Next: fight ${n.name}`, h('small', {}, `level ${n.level}${feeTxt}`)); b.onclick = go2(n, b); next.append(b); }
      if (gf) {
        const b: HTMLButtonElement = h('button', { class: 'gearfight open' }, h('span', { class: 'gk' }, 'Gear fight'), h('b', {}, `${gf.name} · level ${gf.level}`), h('small', {}, `win a rare piece of gear${feeTxt}`));
        b.onclick = go2(gf, b); next.append(b);
      } else next.append(h('div', { class: 'gearfight locked' }, h('span', { class: 'gk' }, 'Gear fight · locked'), h('small', {}, 'Gear fights open as you level up. Keep climbing.')));
    });
    // a practice win is the moment to offer the real thing: the same hero, kept forever on Bitcoin Cash
    if (isPractice()) markPracticeDone();
    if (isPractice()) actions.after(h('button', { class: 'btn bch keep', onClick: () => import('./front').then(m => m.playForReal()) }, 'Keep a hero forever', h('small', {}, 'play for real on Bitcoin Cash')));
  }
  const endShot = () => {
    const x = A!.root.position.x;
    return portrait() ? shot(x + 0.3, 1.5, 5.0, x, 0.2, 0, 46) : shot(x - 1.0, 1.25, 5.2, x - 1.1, 0.95, 0, 34);
  };

  /** the next echo to fight after a win: not mine, not the one just beaten, at or above my level, one I can beat, lowest level first */
  async function nextFight(me: HeroView): Promise<GhostView | null> {
    const all = (await app.chain.listGhosts()).filter(g => !g.mine && g.id !== G.id && g.level >= me.level).sort((a, b) => a.level - b.level).slice(0, 12);
    for (const g of all) {
      const seed = app.chain.styleSeed?.(me.id, g) ?? seedOf(styleHash(me.id, g));
      if (solve(me as unknown as Hero, { ...g, ownerPkh: new Uint8Array(20) } as Ghost, seed, 8)) return g;
    }
    return null;
  }

  /** a gear fight: an echo 3+ levels above this hero that it can actually beat, lowest first */
  async function gearFight(me: HeroView): Promise<GhostView | null> {
    const all = (await app.chain.listGhosts()).filter(g => !g.mine && g.level >= me.level + 3).sort((a, b) => a.level - b.level).slice(0, 5);
    for (const g of all) {
      const seed = app.chain.styleSeed?.(me.id, g) ?? seedOf(styleHash(me.id, g));
      if (solve(me as unknown as Hero, { ...g, ownerPkh: new Uint8Array(20) } as Ghost, seed, 10)) return g;
    }
    return null;
  }

  async function rematch() {
    try { app.ticket = await app.chain.challenge(ticket.heroId, G.id); go('duel'); }
    catch (e) { toast((e as Error).message, true); }
  }

  return () => { removeEventListener('keydown', key); setIntensity(0); unpin?.(); };
});
