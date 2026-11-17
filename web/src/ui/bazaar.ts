// Bazaar: heroes and gear for sale. Tap a hero to see it stand in the light. Buying swaps the token and the money in one transaction.
import { ease } from '../three/engine';
import { director, portrait, shot, sparks } from '../three/fx';
import { world } from '../three/world';
import type { Fighter } from '../three/fighter';
import { CLASS_NAMES } from '../game/sim';
import { app, register, renderChrome } from '../app';
import { gearIcon, gearName, h, icon, money, toast } from './kit';
import type { Listing } from '../chain/types';
import { tabs } from './tabs';
import { sfx } from '../audio/sfx';
import * as THREE from 'three';

register('bazaar', root => {
  let items: Listing[] = [];
  let shown: Fighter | null = null, shownId = '';
  director.cut(portrait() ? shot(0, 1.3, 4.8, 0, 1.45, 0, 40) : shot(1.2, 1.2, 5, 1.2, 0.95, 0, 30));
  director.move(portrait() ? shot(0, 1.3, 4.6, 0, 1.5, 0, 40) : shot(1.4, 1.15, 4.8, 1.4, 0.95, 0, 30), 1200, ease.outCubic);
  world.tick(dt => { if (shown) shown.root.rotation.y += dt * 0.3; });

  const list = h('div', { class: 'wrap' });
  root.append(h('section', { class: 'screen bazaar' }, h('div', { class: 'list scrim-b' }, h('div', { class: 'wrap' }, h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Bazaar')), list), h('div', { style: 'background:rgba(7,6,10,0.94)' }, tabs('bazaar'))));

  const load = async () => { items = await app.chain.listings(); paint(); const first = items.find(l => l.hero); if (first && !shown) preview(first); };
  load();

  async function preview(l: Listing) {
    if (!l.hero || shownId === l.id) return;
    shownId = l.id; paint();
    const f = await world.fighter(l.hero.cls, { level: l.hero.level });
    if (shown) world.drop(shown);
    shown = f; f.root.position.set(0, 0, 0); f.root.rotation.y = 0.5; f.flash(0.5);
  }

  function paint() {
    const f = app.chain.fees();
    list.innerHTML = '';
    if (!items.length) list.append(h('p', { class: 'dim' }, 'Nothing for sale right now.'));
    for (const l of items) {
      const pic = l.hero ? icon('crown') : gearIcon(l.gear!.kind, l.gear!.tier);
      const title = l.hero ? `${l.hero.name}, level ${l.hero.level} ${CLASS_NAMES[l.hero.cls]}` : gearName(l.gear!.kind, l.gear!.tier);
      const sub = l.hero ? `${l.hero.wins} wins · from ${l.seller}` : `#${l.gear!.id} · from ${l.seller}`;
      const b = h('button', { class: l.mine ? 'btn ghost' : 'btn', onClick: async (e: Event) => {
        e.stopPropagation();
        b.setAttribute('disabled', '');
        try {
          if (l.mine) { await app.chain.cancel(l.id); toast('Listing cancelled.'); }
          else {
            await app.chain.buy(l.id); sfx.coin();
            if (shown && shownId === l.id) { shown.once('victory', { fade: 0.2 }); sparks(shown.point('chest', new THREE.Vector3()), 50, ['#ffd27a', '#ffffff'], 3, 2, 1); }
            toast(l.hero ? `${l.hero.name} is yours.` : 'Gear is yours.');
          }
          await load(); renderChrome();
        } catch (err) { toast((err as Error).message, true); b.removeAttribute('disabled'); }
      } }, l.mine ? 'Cancel' : money(l.priceSats, f.usdPerBch));
      list.append(h('div', { class: `item${shownId === l.id ? ' on' : ''}`, onClick: () => preview(l) }, pic, h('div', { class: 't' }, h('b', {}, title), h('span', {}, sub)), b));
    }
  }
});
