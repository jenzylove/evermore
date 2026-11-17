// Hero: your hero large on a lit plinth, its record, its earnings; send it home or sell it.
import { Actor } from '../gfx/actor';
import { drawHall } from '../gfx/hall';
import { stage } from '../gfx/stage';
import { CLASS_NAMES, xpNeed } from '../game/sim';
import { app, go, isPractice, register, renderChrome, setHero } from '../app';
import { h, icon, money, sprite, toast } from './kit';
import { GEAR_NAMES, GEAR_SPRITE } from '../gfx/atlas';
import type { HeroView } from '../chain/types';
import { tabs } from './tabs';

register('hero', root => {
  let heroes: HeroView[] = [];
  let i = 0;
  let actor: Actor | null = null;
  stage.scene = {
    view: { pw: 52, lh: 84 },
    update(dt) { actor?.update(dt); },
    draw(ctx, W, H, t) {
      const fy = Math.round(H * (H > W ? 0.2 : 0.26));
      drawHall(ctx, W, H, t, { floorY: fy, camX: 1300, focusY: fy + 40 });
      if (!actor) return;
      const cx = W / 2, base = fy + 24;
      const lg = ctx.createRadialGradient(cx, base, 0, cx, base, 30);
      lg.addColorStop(0, 'rgba(246,196,83,0.25)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = lg; ctx.fillRect(cx - 30, base - 30, 60, 60); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#2b2140'; ctx.fillRect(Math.round(cx - 11), base - 1, 22, 2);
      ctx.fillStyle = '#120d1d'; ctx.fillRect(Math.round(cx - 11), base + 1, 22, 2);
      actor.place(cx - 1, base); actor.draw(ctx, t);
    },
  };

  const info = h('div', { class: 'wrap' });
  root.append(h('section', { class: 'screen hero' }, h('div', { class: 'info scrim-b' }, info, tabs('hero'))));

  const load = async () => {
    heroes = (await app.chain.myHeroes());
    i = Math.max(0, heroes.findIndex(x => x.id === app.heroId));
    paint();
  };
  load();

  async function paint() {
    info.innerHTML = '';
    const hero = heroes[i];
    if (!hero) {
      actor = null;
      info.append(h('p', { class: 'dim' }, 'No hero yet.'), h('button', { class: 'btn', style: 'width:100%;margin-bottom:8px', onClick: () => go('raise') }, 'Raise a hero'));
      return;
    }
    actor = new Actor(hero.cls, hero.id % 2 === 1); actor.face = 1;
    if (hero.where === 'satchel') setHero(hero.id);
    const f = app.chain.fees();
    const gear = await app.chain.myGear();
    const pick = h('div', { class: 'pick' },
      heroes.length > 1 ? h('button', { class: 'arrow', 'aria-label': 'Previous hero', onClick: () => { i = (i + heroes.length - 1) % heroes.length; paint(); } }, icon('left', '#a99cb8', '', 3)) : h('span', {}),
      h('div', { style: 'text-align:center' }, h('div', { class: 'h2 drop' }, hero.name), h('div', { class: 'dim', style: 'font-size:16px' }, `Level ${hero.level} ${CLASS_NAMES[hero.cls]}${hero.where === 'home' ? ' · at home' : ''}`)),
      heroes.length > 1 ? h('button', { class: 'arrow', 'aria-label': 'Next hero', onClick: () => { i = (i + 1) % heroes.length; paint(); } }, icon('right', '#a99cb8', '', 3)) : h('span', {}));
    const xp = h('div', { class: 'xpbar', style: 'height:8px;margin:12px 0 4px' }, h('i', { style: `width:${hero.xp / xpNeed(hero.level) * 100}%` }));
    const stats = h('div', { class: 'vs', style: 'justify-content:center;margin:8px 0 4px' },
      ...(['hp', 'atk', 'def', 'spd'] as const).map(k => h('span', {}, `${k.toUpperCase()} `, h('b', {}, String(hero[k])))));
    const earned = h('div', { class: 'earned', style: 'text-align:center' },
      hero.defences ? h('span', {}, `Defended ${hero.defences} times, `, h('b', {}, `+${money(hero.earnedSats, f.usdPerBch)}`)) : h('span', { class: 'dim' }, 'Its ghost stands in the Arena. Every challenge pays you.'),
      h('div', { class: 'dim', style: 'font-size:15px;margin-top:4px' }, `${hero.wins} wins · ${hero.xp}/${xpNeed(hero.level)} XP`));
    info.append(pick, xp, stats, earned);
    if (gear.length) info.append(h('div', { class: 'gearline' }, 'Gear', ...gear.slice(0, 6).map(g => { const c = sprite(GEAR_SPRITE(g.kind, g.tier), 0, 2, 'img', [16, 16]); c.title = GEAR_NAMES[g.kind][Math.min(2, g.tier - 1)]; return c; })));
    const home = h('button', { class: 'btn ghost small', onClick: async () => {
      try { await app.chain.sendHome(hero.id); toast(hero.where === 'home' ? `${hero.name} is back in your satchel.` : isPractice() ? `${hero.name} is resting (practice).` : `${hero.name} is in your wallet.`); await load(); renderChrome(); }
      catch (e) { toast((e as Error).message, true); }
    } }, hero.where === 'home' ? 'Bring back' : 'Send home');
    const sell = h('button', { class: 'btn small', onClick: () => sellSheet(hero) }, 'Sell');
    info.append(h('div', { class: 'row', style: 'margin:6px 0 4px' }, home, sell));
  }

  function sellSheet(hero: HeroView) {
    const f = app.chain.fees();
    const price = h('input', { class: 'name', inputmode: 'decimal', value: '1.00', 'aria-label': 'Price in dollars' }) as HTMLInputElement;
    const bg = h('div', { class: 'sheet-bg', onClick: () => { bg.remove(); sh.remove(); } });
    const sh = h('div', { class: 'sheet' }, h('div', { class: 'wrap' },
      h('div', { class: 'h2' }, `Sell ${hero.name}`),
      h('p', {}, 'Set a price. Anyone can buy it; hero and money swap in one transaction. You can cancel any time before.'),
      h('div', { class: 'namerow' }, h('span', { style: 'font-size:28px;align-self:center' }, '$'), price),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onClick: () => { bg.remove(); sh.remove(); } }, 'Cancel'),
        h('button', { class: 'btn', onClick: async () => {
          const usd = Number(price.value); if (!(usd > 0)) { toast('Enter a price.', true); return; }
          try { await app.chain.list('hero', hero.id, Math.round(usd / f.usdPerBch * 1e8)); bg.remove(); sh.remove(); toast(`${hero.name} is in the Bazaar.`); go('bazaar'); }
          catch (e) { toast((e as Error).message, true); }
        } }, 'List it'))));
    document.body.append(bg, sh); price.focus(); price.select();
  }
});
