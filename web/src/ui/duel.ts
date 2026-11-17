// Duel: pick Strike, Guard or Special each round; the round plays out with hit stop, shake and numbers.
// Every number shown comes from sim.trace(), the same arithmetic the covenant replays.
import { Actor } from '../gfx/actor';
import { drawHall } from '../gfx/hall';
import { ease, stage } from '../gfx/stage';
import { GUARD, SPECIAL, STRIKE, ghostMoves, trace, xpNeed, type Ghost, type Hero, type Move, type RoundTrace } from '../game/sim';
import { activeHero, app, go, isPractice, register, renderChrome } from '../app';
import { setIntensity, sfx } from '../audio/sfx';
import { h, icon, iconRows, money, sprite, toast } from './kit';
import { GEAR_NAMES, GEAR_SPRITE } from '../gfx/atlas';
import type { HeroView } from '../chain/types';
import { MOVE_COLOR, MOVE_ICON } from './arena';

register('duel', root => {
  const t0 = app.ticket;
  if (!t0) { queueMicrotask(() => go('arena', false)); return; }
  const ticket = t0;
  let hero: HeroView | null = null;
  const G = ticket.ghost;
  const ghostSim: Ghost = { ...G, ownerPkh: new Uint8Array(20) };
  const gMoves = ghostMoves(ticket.seed);
  const moves: Move[] = [];
  let hHp = 0, gHp = G.hp, hCh = 0, gCh = 0, busy = false, over = false;

  const me = new Actor(0, false); // replaced once the hero loads
  let A = me;
  const B = new Actor(G.cls, G.id % 2 === 1, 'ghost'); B.face = -1;
  let fy = 0, bolt: { x: number; y: number; c: string } | null = null, intentPop = 0;

  stage.scene = {
    view: { pw: 72, lh: 110 },
    update(dt) { A.update(dt); B.update(dt); intentPop = Math.max(0, intentPop - dt); },
    draw(ctx, W, H, t) {
      const portrait = H > W;
      fy = Math.round(H * (portrait ? 0.4 : 0.42));
      drawHall(ctx, W, H, t, { floorY: fy, camX: 900, focusY: fy + 30, light: 1.1 });
      const base = fy + 36, gap = Math.min(Math.round(W * 0.24), 44);
      if (!busy) { A.place(W / 2 - gap, base); B.place(W / 2 + gap, base); }
      else { A.homeX = W / 2 - gap; B.homeX = W / 2 + gap; A.y = B.y = base; }
      // duel ring
      ctx.fillStyle = 'rgba(246,196,83,0.08)';
      ctx.fillRect(Math.round(W / 2 - gap - 18), base - 1, Math.round(gap * 2 + 36), 3);
      B.draw(ctx, t); A.draw(ctx, t);
      if (bolt) { ctx.fillStyle = bolt.c; ctx.fillRect(Math.round(bolt.x) - 2, Math.round(bolt.y) - 2, 4, 4); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(bolt.x) - 1, Math.round(bolt.y) - 1, 2, 2); }
      // the ghost's next move, shown over its head (fixed by the seed, never hidden)
      if (!over && moves.length < 12) {
        const m = gMoves[moves.length];
        const rows = iconRows(MOVE_ICON[m]);
        const pop = intentPop > 0 ? ease.outBack(1 - intentPop / 300) : 1;
        const ix = Math.round(B.x - 4), iy = Math.round(B.y - 42 + Math.sin(t / 260) * 1.2 - (1 - pop) * 4);
        ctx.fillStyle = 'rgba(7,6,13,0.75)'; ctx.fillRect(ix - 2, iy - 2, 13, 13);
        rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') { ctx.fillStyle = MOVE_COLOR[m]; ctx.fillRect(ix + i, iy + j, 1, 1); } }));
      }
    },
  };

  // ---- HUD ----
  const plate = (side: 'l' | 'r') => {
    const nm = h('div', { class: 'nm drop' }), hp = h('div', { class: 'hp' }, h('i', {}), h('b', {})), n = h('div', { class: 'hpn' });
    const pips = h('span', { class: 'pips' }, h('i', {}), h('i', {}));
    return { el: h('div', { class: `plate ${side}` }, nm, hp, h('div', { class: 'hpn' }, n, pips)), nm, hp, n, pips };
  };
  const L = plate('l'), Rr = plate('r');
  const round = h('div', { class: 'round drop' });
  const btns = h('div', { class: 'moves' });
  const mk = (m: Move, label: string, sub: string, cls: string) => {
    const b = h('button', { class: `btn ${cls}`, onClick: () => play(m) }, icon(MOVE_ICON[m], cls === 'ghost' ? '#9fd8ff' : cls === 'blood' ? '#fff2ea' : '#2a1606', 'rgba(0,0,0,0.2)', 3), label, h('small', {}, sub));
    b.addEventListener('pointerdown', () => sfx.tap());
    return b;
  };
  const bS = mk(STRIKE, 'Strike', 'full hit', 'blood'), bG = mk(GUARD, 'Guard', 'half, +1 charge', 'ghost'), bX = mk(SPECIAL, 'Special', '2 charges', '');
  btns.append(bS, bG, bX);
  const center = h('div', { class: 'pass', style: 'position:absolute;inset:0' });
  root.append(h('section', { class: 'screen duel' }, h('div', { class: 'hud scrim-t' }, L.el, Rr.el), round, center, h('div', { class: 'scrim-b', style: 'margin-top:auto' }, btns)));
  const key = (e: KeyboardEvent) => { const m = { '1': STRIKE, '2': GUARD, '3': SPECIAL, s: STRIKE, g: GUARD, x: SPECIAL }[e.key]; if (m !== undefined) play(m as Move); };
  addEventListener('keydown', key);

  const hud = () => {
    if (!hero) return;
    const set = (p: typeof L, cur: number, max: number, ch: number, name: string) => {
      p.nm.textContent = name;
      const w = `${Math.max(0, cur) / max * 100}%`;
      (p.hp.children[1] as HTMLElement).style.width = w; (p.hp.children[0] as HTMLElement).style.width = w;
      p.hp.classList.toggle('low', cur / max < 0.3);
      p.n.textContent = `${Math.max(0, cur)}/${max}`;
      [...p.pips.children].forEach((x, i) => x.classList.toggle('on', ch > i));
    };
    set(L, hHp, hero.hp, hCh, hero.name);
    set(Rr, gHp, G.hp, gCh, G.name);
    round.innerHTML = over ? '' : `Round ${moves.length + 1} of 12${moves.length === 0 ? '<br><span class="spirit" style="font-size:14px">its next move shows above its head</span>' : ''}`;
    bX.disabled = hCh < 2;
    (bX.querySelector('small') as HTMLElement).textContent = hCh >= 2 ? 'double hit' : `${hCh}/2 charges`;
  };

  (async () => {
    hero = await activeHero();
    if (!hero || hero.id !== ticket.heroId) { toast('That hero is not in your satchel.', true); go('arena'); return; }
    A = new Actor(hero.cls, hero.id % 2 === 1); A.face = 1;
    hHp = hero.hp;
    hud(); setIntensity(1);
    btns.classList.add('wait');
    await banner(`${hero.name}  vs  ${G.name}`, isPractice() ? 'Practice duel' : 'The chain will check every move', 1300);
    btns.classList.remove('wait');
  })();

  async function banner(big: string, small: string, ms: number) {
    const el = h('div', { class: 'titlecard' }, h('h2', { class: 'drop', style: 'font-size:clamp(30px,8vw,56px)' }, big), h('p', { class: 'drop' }, small));
    center.append(el); await stage.wait(ms); el.style.transition = 'opacity 240ms'; el.style.opacity = '0'; await stage.wait(240); el.remove();
  }

  async function play(m: Move) {
    if (busy || over || !hero) return;
    if (m === SPECIAL && hCh < 2) { toast('Special needs 2 charges. Guard to charge.'); return; }
    busy = true; btns.classList.add('wait');
    moves.push(m);
    const tr = trace(hero as Hero, ghostSim, ticket.seed, moves);
    const r = tr[tr.length - 1];
    await animateRound(r);
    hHp = r.hHp; gHp = r.gHp; hCh = r.hCharge; gCh = r.gCharge;
    hud(); intentPop = 300;
    busy = false;
    if (gHp <= 0) return finish(true);
    if (hHp <= 0) return finish(false);
    if (moves.length >= 12) return finish(false, true);
    btns.classList.remove('wait');
  }

  async function animateRound(r: RoundTrace) {
    // guards go up first, together
    const guards: Promise<void>[] = [];
    if (r.heroMove === GUARD) guards.push(raiseWard(A, true).then(() => { hCh = r.hCharge; hud(); }));
    if (r.ghostMove === GUARD) guards.push(raiseWard(B, false).then(() => { gCh = r.gCharge; hud(); }));
    if (guards.length) { sfx.ward(); await Promise.all(guards); }
    for (const b of r.beats) {
      const atk = b.who === 'hero' ? A : B, tgt = b.who === 'hero' ? B : A;
      await strike(atk, tgt, b.special, b.dmg, b.blocked, b.targetHp, b.who === 'hero');
      if (b.who === 'hero') { gHp = b.targetHp; if (b.special) hCh = 0; } else { hHp = b.targetHp; if (b.special) gCh = 0; }
      hud();
      if (b.targetHp <= 0) break;
      await stage.wait(120);
    }
    await stage.wait(160);
    await Promise.all([dropWard(A), dropWard(B)]);
    A.aura = r.hCharge >= 2 ? 1 : 0; B.aura = r.gCharge >= 2 ? 1 : 0;
  }

  async function raiseWard(a: Actor, mine: boolean) {
    stage.burst(a.x + a.face * 9, a.y - 12, 8, mine ? ['#9fd8ff', '#ffffff'] : ['#bff9ff', '#8ff6e6'], 30, 0, 400);
    await stage.tween(220, p => { a.ward = ease.outBack(p); a.dx = -a.face * 2 * p; a.sq = 0.3 * p; });
    sfx.charge();
  }
  async function dropWard(a: Actor) { if (a.ward <= 0) return; const w0 = a.ward, d0 = a.dx, s0 = a.sq; await stage.tween(180, p => { a.ward = w0 * (1 - p); a.dx = d0 * (1 - p); a.sq = s0 * (1 - p); }); }

  async function strike(a: Actor, b: Actor, special: boolean, dmg: number, blocked: boolean, left: number, mine: boolean) {
    const dir = a.face;
    if (special) {
      // the build up: everything dims, the attacker glows, time slows
      sfx.specialUp();
      await stage.tween(420, p => { stage.dim = p; a.aura = 1; a.sq = -0.4 * p; });
      stage.burst(a.x, a.y - 14, 26, mine ? ['#f6c453', '#fff1c1'] : ['#8ff6e6', '#ffffff'], 50, -20, 600);
    }
    // anticipation: lean back, weapon up
    sfx.whoosh(special);
    await stage.tween(special ? 140 : 110, p => { a.dx = -dir * 3 * ease.outCubic(p); a.weaponAngle = 0.35 - 1.9 * ease.outCubic(p); a.sq = 0.35 * p; });
    const contact = b.x - a.x - dir * 14;
    if (a.cls === 2) {
      // mages throw a bolt from the staff
      sfx.bolt();
      const sx = a.x + dir * 6, sy = a.y - 20;
      await stage.tween(special ? 240 : 190, p => {
        bolt = { x: sx + (b.x - sx) * ease.inCubic(p), y: sy + (b.y - 14 - sy) * p - Math.sin(p * Math.PI) * 8, c: mine ? '#ff7a3c' : '#8ff6e6' };
        a.weaponAngle = -1.55 + 1.2 * p; a.dx = -dir * 3 * (1 - p);
        if (Math.random() < 0.6) stage.mote(bolt.x, bolt.y, -dir * 10, (Math.random() - 0.5) * 20, mine ? '#ffb15c' : '#bff9ff', 260);
      });
      bolt = null;
    } else {
      // dash in (rogues are quicker and leave a trail)
      const dur = a.cls === 1 ? 90 : 130;
      a.anim = 'run';
      await stage.tween(dur, p => {
        a.dx = -dir * 3 + (contact + dir * 3) * ease.inCubic(p); a.sq = -0.4 * p;
        if (a.cls === 1) stage.mote(a.x + a.dx, a.y - 4 - Math.random() * 18, 0, 0, mine ? '#f6c453' : '#8ff6e6', 180);
      });
      a.anim = 'idle';
      await stage.tween(50, p => { a.weaponAngle = -1.55 + 3.4 * ease.outCubic(p); a.weaponReach = 3 * p; });
    }
    impact(a, b, special, dmg, blocked, left, mine);
    // the target reels back
    const kb = (special ? 9 : 5) * (blocked ? 0.4 : 1) * dir;
    const reel = stage.tween(260, p => { b.dx = kb * (1 - ease.outCubic(p)) * (p < 0.3 ? p / 0.3 : 1); b.sq = blocked ? 0 : -0.3 * (1 - p); });
    if (!blocked) b.anim = 'hit';
    if (special) { await stage.tween(200, p => { stage.dim = 1 - p; }); stage.slow = 1; }
    await stage.wait(90);
    b.anim = 'idle';
    // recover
    const x0 = a.dx;
    await Promise.all([reel, stage.tween(220, p => { a.dx = x0 * (1 - ease.inOut(p)); a.weaponAngle = 1.85 - 1.5 * ease.inOut(p); a.weaponReach = 3 * (1 - p); a.sq = 0; })]);
    a.weaponAngle = 0.35; a.dx = 0; b.dx = 0;
    if (left <= 0) await fall(b, mine);
  }

  function impact(a: Actor, b: Actor, special: boolean, dmg: number, blocked: boolean, left: number, mine: boolean) {
    const kill = left <= 0;
    stage.hitstop(kill ? 220 : special ? 140 : blocked ? 40 : 75);
    stage.shake(kill ? 0.9 : special ? 0.75 : blocked ? 0.18 : 0.38);
    if (special || kill) stage.flashScreen('#ffffff', special ? 0.8 : 0.5);
    b.flash = blocked ? 60 : 110;
    const hx = b.x - a.face * 4, hy = b.y - 14;
    if (blocked) { sfx.clang(); stage.burst(hx, hy, 12, ['#ffffff', '#9fd8ff', '#f6c453'], 80, 160, 300); }
    else { sfx.hit(special || kill); stage.burst(hx, hy, special ? 34 : 16, mine ? ['#ff5a3c', '#ffd36b', '#ffffff'] : ['#8ff6e6', '#ffffff', '#3c9fb0'], special ? 110 : 75, 200, 420); }
    stage.pop(b.x, b.y - 30, String(dmg), blocked ? '#9fd8ff' : special ? '#f6c453' : '#ffffff', special || dmg >= 12);
    if (blocked) stage.pop(b.x, b.y - 40, 'blocked', '#9fd8ff');
    if (special) stage.pop(a.x, a.y - 44, 'Special', mine ? '#f6c453' : '#8ff6e6');
  }

  async function fall(b: Actor, mine: boolean) {
    sfx.ko();
    stage.slow = 0.45;
    stage.burst(b.x, b.y - 10, 40, mine ? ['#8ff6e6', '#ffffff', '#3c9fb0'] : ['#ff5a3c', '#ffd36b'], 50, -30, 1200);
    await stage.tween(500, p => { b.dead = ease.outCubic(p); });
    if (mine) { // a beaten ghost comes apart into light
      for (let i = 0; i < 30; i++) stage.mote(b.x + (Math.random() - 0.5) * 16, b.y - Math.random() * 14, (Math.random() - 0.5) * 8, -10 - Math.random() * 20, Math.random() < 0.5 ? '#8ff6e6' : '#ffffff', 900 + Math.random() * 800);
      await stage.tween(600, p => { b.alpha = 1 - p; });
    }
    stage.slow = 1;
  }

  async function finish(won: boolean, outOfRounds = false) {
    over = true; hud(); setIntensity(0);
    btns.remove();
    const f = app.chain.fees();
    if (!won) {
      sfx.lose();
      center.append(h('div', { class: 'titlecard' }, h('h2', { class: 'drop', style: 'color:var(--ember)' }, 'Fallen'),
        h('p', { class: 'drop' }, outOfRounds ? `${G.name} held out for 12 rounds.` : `${G.name} holds the hall.`)));
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
    stage.burst(stage.W / 2, fy, 60, ['#f6c453', '#fff1c1', '#ff9d3c'], 120, 140, 1400);
    const card = h('div', { class: 'titlecard' }, h('h2', { class: 'drop gold' }, 'Victory'), h('p', { class: 'drop' }, `in ${moves.length} round${moves.length > 1 ? 's' : ''}, ${hHp} HP left`));
    center.append(card);
    await stage.wait(1100);
    await forge(card);
  }

  async function forge(card: HTMLElement) {
    const hero0 = hero!;
    const f = app.chain.fees();
    const seal = h('div', { class: 'seal practice' }, h('span', { class: 'dot' }), isPractice() ? 'Practice · forging in your browser' : 'Forging on Bitcoin Cash');
    const xpI = h('i', {}), xpBar = h('div', { class: 'xpbar' }, xpI);
    const xpL = h('span', {}), xpR = h('span', {});
    const extra = h('div', {});
    const actions = h('div', { class: 'row' });
    const panel = h('div', { class: 'forge scrim-b' }, h('div', { class: 'wrap' }, h('div', { class: 'h2', style: 'font-size:26px' }, 'Forge'), seal, xpBar, h('div', { class: 'xprow' }, xpL, xpR), extra, actions));
    root.querySelector('.screen')!.append(panel);
    xpI.style.width = `${hero0.xp / xpNeed(hero0.level) * 100}%`;
    xpL.textContent = `Level ${hero0.level}`; xpR.textContent = `${hero0.xp} / ${xpNeed(hero0.level)} XP`;
    let res;
    try { res = await app.chain.forge(ticket, moves); }
    catch (e) { seal.textContent = (e as Error).message; actions.append(h('button', { class: 'btn ghost', onClick: () => go('arena') }, 'Arena')); return; }
    seal.innerHTML = '';
    if (res.receipt.explorer) {
      seal.replaceWith(h('a', { class: 'seal', href: res.receipt.explorer, target: '_blank', rel: 'noopener' }, h('span', { class: 'dot' }), 'Sealed on Bitcoin Cash ', icon('link', '#0ac18e', '', 2)));
    } else seal.append(h('span', { class: 'dot' }), 'Practice · not sealed on chain');
    card.style.transition = 'transform 400ms, opacity 400ms'; card.style.transform = 'translateY(-40px) scale(0.7)'; card.style.opacity = '0.0';
    // XP fills in ticks
    const need0 = xpNeed(hero0.level);
    const total = hero0.xp + res.xpGain;
    const steps = Math.min(30, res.xpGain);
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(hero0.xp + (res.xpGain * i) / steps);
      xpI.style.width = `${Math.min(1, x / need0) * 100}%`;
      xpR.textContent = `${Math.min(x, need0)} / ${need0} XP  +${Math.round(res.xpGain * i / steps)}`;
      sfx.xtick(); await stage.wait(28);
    }
    if (res.levelled) {
      xpI.classList.add('flash'); await stage.wait(80); xpI.classList.remove('flash');
      sfx.levelUp(); stage.flashScreen('#f6c453', 0.5); stage.shake(0.4);
      stage.burst(A.x, A.y - 14, 60, ['#f6c453', '#fff1c1', '#ffffff'], 110, 60, 1300);
      stage.tween(600, p => { A.dy = -Math.sin(p * Math.PI) * 10; });
      xpI.style.width = '0%'; await stage.wait(60);
      xpI.style.width = `${res.hero.xp / xpNeed(res.hero.level) * 100}%`;
      xpL.textContent = `Level ${res.hero.level}`; xpR.textContent = `${res.hero.xp} / ${xpNeed(res.hero.level)} XP`;
      const d = (k: 'hp' | 'atk' | 'def' | 'spd', n: string) => res.hero[k] > hero0[k] ? h('span', {}, `${n} +${res.hero[k] - hero0[k]}`) : null;
      extra.append(h('div', { class: 'lvup drop' }, `Level ${res.hero.level}`), h('div', { class: 'gain' }, d('hp', 'HP'), d('atk', 'ATK'), d('def', 'DEF'), d('spd', 'SPD')));
    } else xpR.textContent = `${total} / ${need0} XP  +${res.xpGain}`;
    if (res.gear) {
      await stage.wait(500); sfx.reveal();
      const g = res.gear;
      extra.append(h('div', { class: 'drop-reveal' }, sprite(GEAR_SPRITE(g.kind, g.tier), 0, 3, 'img', [16, 16]),
        h('div', {}, h('div', { class: 'gold', style: 'font-weight:700;font-size:20px' }, `Gear drop: ${GEAR_NAMES[g.kind][Math.min(2, g.tier - 1)]}`),
          h('div', { class: 'dim', style: 'font-size:14px' }, `#${g.id} of a capped 5,000. Yours to keep or sell.`))));
      stage.burst(stage.W / 2, fy + 40, 40, ['#f6c453', '#ffffff'], 90, 100, 900);
    }
    hero = res.hero; renderChrome();
    actions.append(h('button', { class: 'btn ghost', onClick: () => go('hero') }, 'Hero'), h('button', { class: 'btn spirit', onClick: () => go('arena') }, 'Next fight'));
    void f;
  }

  async function rematch() {
    try { app.ticket = await app.chain.challenge(ticket.heroId, G.id); go('duel'); }
    catch (e) { toast((e as Error).message, true); }
  }

  return () => { removeEventListener('keydown', key); setIntensity(0); };
});
