// Bazaar: heroes and gear for sale. Buying swaps the token and the money in one transaction.
import { Actor } from '../gfx/actor';
import { drawHall } from '../gfx/hall';
import { stage } from '../gfx/stage';
import { CLASS_NAMES } from '../game/sim';
import { app, go, register, renderChrome } from '../app';
import { h, money, sprite, toast } from './kit';
import { CLASS_SPRITE, GEAR_NAMES, GEAR_SPRITE, spr } from '../gfx/atlas';
import type { Listing } from '../chain/types';
import { tabs } from './tabs';
import { sfx } from '../audio/sfx';

register('bazaar', root => {
  let items: Listing[] = [];
  const keeper = new Actor(1, true); keeper.face = 1;
  stage.scene = {
    update(dt) { keeper.update(dt); },
    draw(ctx, W, H, t) {
      const fy = Math.round(H * (H > W ? 0.16 : 0.26));
      drawHall(ctx, W, H, t, { floorY: fy, camX: 2100, focusY: fy + 20 });
      // stalls: chests and crates with wares on top
      const base = fy + 30;
      for (let k = 0; k < 4; k++) {
        const x = W / 2 - 42 + k * 28;
        spr(ctx, 'crate', 0, x, base + 4);
        spr(ctx, k % 2 ? 'chest_full_open' : 'chest_empty_open', Math.floor(t / 600 + k) % 3 === 0 ? 2 : 0, x, base - 18);
      }
      items.slice(0, 3).forEach((l, k) => {
        const x = W / 2 - 42 + k * 28;
        if (l.hero) spr(ctx, `${CLASS_SPRITE(l.hero.cls, l.hero.id % 2 === 1)}_idle`, t / 140, x, base + 26, false, 'img');
      });
      keeper.place(W / 2 + 64, base + 20); keeper.draw(ctx, t);
    },
  };
  const list = h('div', { class: 'wrap' });
  root.append(h('section', { class: 'screen bazaar' }, h('div', { class: 'list scrim-b' }, h('div', { class: 'wrap' }, h('div', { class: 'h2 drop', style: 'margin-bottom:6px' }, 'Bazaar')), list), h('div', { style: 'background:rgba(7,6,13,0.97)' }, tabs('bazaar'))));

  const load = async () => { items = await app.chain.listings(); paint(); };
  load();

  function paint() {
    const f = app.chain.fees();
    list.innerHTML = '';
    if (!items.length) list.append(h('p', { class: 'dim' }, 'Nothing for sale right now.'));
    for (const l of items) {
      const pic = l.hero ? sprite(`${CLASS_SPRITE(l.hero.cls, l.hero.id % 2 === 1)}_idle`, 0, 2, 'img', [20, 28]) : sprite(GEAR_SPRITE(l.gear!.kind, l.gear!.tier), 0, 2, 'img', [20, 28]);
      const title = l.hero ? `${l.hero.name}, level ${l.hero.level} ${CLASS_NAMES[l.hero.cls]}` : GEAR_NAMES[l.gear!.kind][Math.min(2, l.gear!.tier - 1)];
      const sub = l.hero ? `${l.hero.wins} wins · defended ${l.hero.defences} · from ${l.seller}` : `Gear #${l.gear!.id} · from ${l.seller}`;
      const b = h('button', { class: l.mine ? 'btn ghost' : 'btn', onClick: async () => {
        b.setAttribute('disabled', '');
        try {
          if (l.mine) { await app.chain.cancel(l.id); toast('Listing cancelled.'); }
          else { await app.chain.buy(l.id); sfx.coin(); stage.burst(stage.W / 2, stage.H * 0.25, 30, ['#f6c453', '#ffffff'], 80, 100, 800); toast(l.hero ? `${l.hero.name} is yours.` : 'Gear is yours.'); }
          await load(); renderChrome();
        } catch (e) { toast((e as Error).message, true); b.removeAttribute('disabled'); }
      } }, l.mine ? 'Cancel' : money(l.priceSats, f.usdPerBch));
      list.append(h('div', { class: 'item' }, pic, h('div', { class: 't' }, h('b', {}, title), h('span', {}, sub)), b));
    }
    void go;
  }
});
