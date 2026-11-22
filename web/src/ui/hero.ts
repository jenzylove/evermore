// Hero: your fighter on a slow turntable in the shaft of light, wearing its level and its gear. Its record, its earnings;
// send it home or sell it.
import { ease } from '../three/engine';
import { director, portrait, shot } from '../three/fx';
import { world } from '../three/world';
import { TIER_NAME, tierOf, type Fighter } from '../three/fighter';
import { CLASS_NAMES, xpNeed } from '../game/sim';
import { app, go, isPractice, register, renderChrome, setHero } from '../app';
import { gearIcon, gearName, h, icon, money, toast } from './kit';
import type { HeroView } from '../chain/types';
import { tabs } from './tabs';

register('hero', root => {
  let heroes: HeroView[] = [];
  let i = 0;
  let fig: Fighter | null = null;
  let spin = 0.4, dragging = false, lastX = 0, vel = 0;
  const frame = () => portrait() ? shot(0, 1.2, 4.6, 0, 0.55, 0, 40) : shot(-1.0, 1.15, 6.0, -1.0, 0.95, 0, 30);
  director.cut(shot(0, 2.6, 7, 0, 1, 0, 30));
  director.move(frame(), 1200, ease.outCubic);
  world.tick(dt => {
    if (!dragging) { vel *= Math.exp(-dt * 3); spin += dt * 0.3 + vel * dt; }
    if (fig) fig.root.rotation.y = spin;
  });
  const cv = document.getElementById('world')!;
  const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; };
  const mv = (e: PointerEvent) => { if (!dragging) return; const d = e.clientX - lastX; lastX = e.clientX; spin += d * 0.012; vel = d * 0.6; };
  const up = () => { dragging = false; };
  cv.addEventListener('pointerdown', down); addEventListener('pointermove', mv); addEventListener('pointerup', up);

  const info = h('div', { class: 'wrap' });
  root.append(h('section', { class: 'screen hero' }, h('div', { class: 'info scrim-b' }, info, tabs('hero'))));

  const load = async () => {
    heroes = await app.chain.myHeroes();
    i = Math.max(0, heroes.findIndex(x => x.id === app.heroId));
    paint();
  };
  load();

  async function paint() {
    info.innerHTML = '';
    const hero = heroes[i];
    if (!hero) {
      info.append(h('p', { class: 'dim' }, 'No hero yet.'), h('button', { class: 'btn', style: 'width:100%;margin-bottom:8px', onClick: () => go('raise') }, 'Raise a hero'));
      return;
    }
    if (hero.where === 'satchel') setHero(hero.id);
    const f = app.chain.fees();
    const gear = (await app.chain.myGear()).filter(g => g.where === 'satchel');
    const old = fig;
    world.fighter(hero.cls, { level: hero.level, gear: hero.where === 'satchel' ? gear : [] }).then(nf => {
      if (old) world.drop(old);
      fig = nf; nf.root.position.set(0, 0, 0); nf.flash(0.5);
    });
    const t = tierOf(hero.level);
    const pick = h('div', { class: 'pick' },
      heroes.length > 1 ? h('button', { class: 'arrow', 'aria-label': 'Previous hero', onClick: () => { i = (i + heroes.length - 1) % heroes.length; paint(); } }, icon('left')) : h('span', {}),
      h('div', { style: 'text-align:center' }, h('button', { class: 'h2 rename', 'aria-label': 'Rename hero', onClick: () => renameSheet(hero) }, hero.name, h('span', { class: 'pen' }, '\u270e')),
        h('div', { class: 'rank' }, `Level ${hero.level} ${CLASS_NAMES[hero.cls]}`, t ? h('span', {}, ' · ', h('b', {}, TIER_NAME[t])) : null, hero.where === 'home' ? ' · at home' : '')),
      heroes.length > 1 ? h('button', { class: 'arrow', 'aria-label': 'Next hero', onClick: () => { i = (i + 1) % heroes.length; paint(); } }, icon('right')) : h('span', {}));
    const xp = h('div', { class: 'xpbar' }, h('i', { style: `width:${hero.xp / xpNeed(hero.level) * 100}%` }));
    const stats = h('div', { class: 'vs', style: 'justify-content:center;margin:8px 0 4px' },
      ...(['hp', 'atk', 'def', 'spd'] as const).map(k => h('span', {}, `${k.toUpperCase()} `, h('b', {}, String(hero[k])))));
    const next = [3, 5, 7, 10].find(l => l > hero.level);
    const earned = h('div', { class: 'earned', style: 'text-align:center' },
      isPractice() ? h('span', { class: 'dim' }, 'Its echo stands in the Arena and fights for you while you are away.') : hero.defences ? h('span', {}, 'Your echo earned ', h('b', { class: isPractice() ? '' : 'bch-t' }, money(hero.earnedSats, f.usdPerBch)), ` from ${hero.defences} challenger${hero.defences === 1 ? '' : 's'}`)
        : h('span', { class: 'dim' }, `Its echo stands in the Arena. Every challenge pays you ${money(f.challengeSats, f.usdPerBch)}${isPractice() ? ' (practice purse)' : ''}.`),
      h('div', { class: 'dim', style: 'font-size:14px;margin-top:4px' }, `${hero.wins} win${hero.wins === 1 ? '' : 's'} · ${hero.xp} of ${xpNeed(hero.level)} XP${next ? ` · new look at level ${next}` : ''}`));
    // a new hero is welcomed and told what to do next
    if (app.justRaised) {
      app.justRaised = false;
      info.append(h('p', { class: 'welcome' }, `${hero.name} is yours. Win fights in the Arena to level up, earn gear, and get paid when others fight your echo.`));
    }
    info.append(pick, xp, stats, earned);
    if (gear.length) info.append(h('div', { class: 'gearline' }, 'Wearing', ...gear.slice(0, 6).map(g => { const c = gearIcon(g.kind, g.tier); c.setAttribute('aria-label', gearName(g.kind, g.tier)); const s = h('span', { title: gearName(g.kind, g.tier) }); s.append(c); return s; })));
    if (hero.where === 'satchel') info.append(h('button', { class: 'btn prime', style: 'width:100%;margin:12px 0 2px', onClick: () => go('arena') }, 'Enter the arena'));
    const home = h('button', { class: 'btn ghost small', onClick: () => confirmSheet(
      hero.where === 'home' ? `Bring ${hero.name} back to play` : `Send ${hero.name} home`,
      hero.where === 'home'
        ? [`${hero.name} moves from your wallet back into this browser's Satchel, so it can fight again.`, 'One approval in your wallet. It stays yours.']
        : [`${hero.name} moves into your own wallet, where it is safe even if this browser is cleared.`, 'Its echo keeps fighting in the Arena, and every challenge pays your wallet.', 'To fight with it again, tap Bring back (one approval in your wallet). Network fee: under a cent.'],
      hero.where === 'home' ? 'Bring back' : 'Send home', async () => {
      try { await app.chain.sendHome(hero.id); toast(hero.where === 'home' ? `${hero.name} is back in your satchel.` : isPractice() ? `${hero.name} is resting (practice).` : `${hero.name} is in your wallet.`); await load(); renderChrome(); }
      catch (e) { toast((e as Error).message, true); }
    }) }, hero.where === 'home' ? 'Bring back' : 'Send home');
    const sell = h('button', { class: 'btn small', onClick: () => sellSheet(hero) }, 'Sell');
    // wallet things (send home, sell) belong to real play; free practice stays clean
    if (!isPractice()) info.append(h('div', { class: 'row', style: 'margin:10px 0 4px' }, home, sell));
  }

  function confirmSheet(title: string, lines: string[], ok: string, act: () => Promise<void>) {
    const close = () => { bg.remove(); sh.remove(); };
    const bg = h('div', { class: 'sheet-bg', onClick: close });
    const yes = h('button', { class: 'btn', onClick: async () => { yes.setAttribute('disabled', ''); await act(); close(); } }, ok);
    const sh = h('div', { class: 'sheet' }, h('div', { class: 'wrap' }, h('div', { class: 'h2' }, title), ...lines.map(l => h('p', {}, l)),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onClick: close }, 'Not now'), yes)));
    document.body.append(bg, sh);
  }
  function renameSheet(hero: HeroView) {
    const close = () => { bg.remove(); sh.remove(); };
    const bg = h('div', { class: 'sheet-bg', onClick: close });
    const nm = h('input', { class: 'name', maxlength: 14, value: hero.name, 'aria-label': 'Hero name', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
    const save = () => { const v = nm.value.trim(); if (!v) { toast('Enter a name.', true); return; } app.chain.rename(hero.id, v); close(); toast(`Renamed to ${v}.`); load(); };
    nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const sh = h('div', { class: 'sheet' }, h('div', { class: 'wrap' }, h('div', { class: 'h2' }, 'Rename your hero'),
      h('p', { class: 'dim' }, 'Free. The name is kept by the game, not on chain.'), nm,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onClick: close }, 'Cancel'), h('button', { class: 'btn', onClick: save }, 'Save'))));
    document.body.append(bg, sh); nm.focus(); nm.select();
  }

  function sellSheet(hero: HeroView) {
    const f = app.chain.fees();
    const price = h('input', { class: 'name', inputmode: 'decimal', value: '1.00', 'aria-label': 'Price in dollars' }) as HTMLInputElement;
    // get paid in dollars (PUSD, a Bitcoin Cash stablecoin) or in BCH at today's rate
    const canPusd = !!app.chain.hasPusd?.();
    let inPusd = canPusd;
    const opt = (label: string, sub: string, v: boolean) => h('button', { class: `pay${inPusd === v ? ' on' : ''}`, onClick: (e: Event) => { inPusd = v; (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('.pay').forEach((b, i) => b.classList.toggle('on', (i === 0) === v)); } }, h('b', {}, label), h('small', {}, sub));
    const payIn = canPusd ? h('div', { class: 'payin' }, opt('Dollars', 'PUSD, stays $1', true), opt('BCH', 'at today\u2019s rate', false)) : null;
    const bg = h('div', { class: 'sheet-bg', onClick: () => { bg.remove(); sh.remove(); } });
    const sh = h('div', { class: 'sheet' }, h('div', { class: 'wrap' },
      h('div', { class: 'h2' }, `Sell ${hero.name}`),
      h('p', {}, 'Set a price. Anyone can buy it: the hero and the money swap in one transaction. While it is listed it cannot fight, and you can cancel any time before it sells.'),
      h('div', { class: 'namerow' }, h('span', { style: 'font:700 28px var(--display);color:var(--gold)' }, '$'), price),
      payIn && h('div', { class: 'dim', style: 'margin:10px 0 6px;font-size:14px;letter-spacing:.14em;text-transform:uppercase' }, 'Get paid in'), payIn,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onClick: () => { bg.remove(); sh.remove(); } }, 'Cancel'),
        h('button', { class: 'btn', onClick: async () => {
          const usd = Number(price.value); if (!(usd > 0)) { toast('Enter a price.', true); return; }
          try { if (inPusd) await app.chain.list('hero', hero.id, 0, Math.round(usd * 100)); else await app.chain.list('hero', hero.id, Math.round(usd / f.usdPerBch * 1e8)); bg.remove(); sh.remove(); toast(`${hero.name} is in the Bazaar.`); go('bazaar'); }
          catch (e) { toast((e as Error).message, true); }
        } }, 'List it'))));
    document.body.append(bg, sh); price.focus(); price.select();
  }
  return () => { cv.removeEventListener('pointerdown', down); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
});
