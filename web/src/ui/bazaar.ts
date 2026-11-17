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
      const fy = Math.round(H * (H > W ? 0.2 : 0.26));
      drawHall(ctx, W, H, t, { floorY: fy, camX: 2100, focusY: fy + 20 });
      // one crate per listing, the ware standing on top of it
      const base = fy + 34, n = Math.max(3, Math.min(5, items.length)), step = Math.min(26, (W - 30) / n);
      const x0 = W / 2 - (step * (n - 1)) / 2;
      for (let k = 0; k < n; k++) {
        const x = x0 + k * step, l = items[k];
        spr(ctx, 'crate', 0, x, base);
        const top = base - 18, bob = Math.round(Math.sin(t / 400 + k) * 1);
        if (!l) continue;
        if (l.hero) spr(ctx, `${CLASS_SPRITE(l.hero.cls, l.hero.id % 2 === 1)}_idle`, t / 140, x, top, false, 'img');
        else spr(ctx, GEAR_SPRITE(l.gear!.kind, l.gear!.tier), 0, x, top - 2 + bob, false, 'img');
      }
      keeper.place(Math.min(W - 10, W / 2 + 70), fy + 22); keeper.face = -1; keeper.draw(ctx, t);
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
      const sub = l.hero ? `${l.hero.wins} wins · from ${l.seller}` : `#${l.gear!.id} · from ${l.seller}`;
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
