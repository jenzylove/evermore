// Front door: the hall, three heroes idling, ghosts drifting past behind them, one button.
import { Actor } from '../gfx/actor';
import { drawHall } from '../gfx/hall';
import { ease, stage } from '../gfx/stage';
import { app, go, hasRealChain, register } from '../app';
import { h } from './kit';

register('front', root => {
  const heroes = [new Actor(1, false), new Actor(0, false), new Actor(2, true)];
  const ghosts = Array.from({ length: 5 }, (_, i) => { const a = new Actor(i % 3, i % 2 === 0, 'ghost'); a.alpha = 0; a.anim = 'run'; return { a, x: -40 - i * 70, sp: 9 + i * 2.5 }; });
  let intro = 0;
  const scene = {
    update(dt: number) {
      intro = Math.min(1, intro + dt / 2200);
      heroes.forEach(a => a.update(dt));
      for (const g of ghosts) {
        g.a.update(dt); g.x += g.sp * dt / 1000;
        if (g.x > stage.W + 40) g.x = -40 - Math.random() * 60;
        g.a.alpha = 0.32 + 0.1 * Math.sin(stage.t / 400 + g.sp);
      }
      // a hero now and then swings at the air
      if (Math.random() < dt / 3000) {
        const a = heroes[Math.floor(Math.random() * 3)];
        stage.tween(380, t => { a.weaponAngle = Math.sin(t * Math.PI) * (a.cls === 2 ? -0.6 : 1.6); });
      }
    },
    draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
      const portrait = H > W;
      const fy = Math.round(H * (portrait ? 0.54 : 0.5));
      const cam = Math.round((1 - ease.outCubic(intro)) * 160);
      drawHall(ctx, W, H, t, { floorY: fy, camX: cam, focusY: fy + 20 });
      for (const g of ghosts) { g.a.place(g.x, fy + 10); g.a.draw(ctx, t); }
      const cx = W / 2, gap = portrait ? 24 : 30, base = fy + (portrait ? 34 : 30);
      heroes[0].place(cx - gap, base - 4); heroes[1].place(cx, base + 2); heroes[2].place(cx + gap, base - 4);
      heroes[0].face = 1; heroes[2].face = -1; heroes[1].face = 1;
      // a soft pool of light where the heroes stand
      const lg = ctx.createRadialGradient(cx, base, 0, cx, base, 50);
      lg.addColorStop(0, 'rgba(246,196,83,0.20)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = lg; ctx.fillRect(cx - 50, base - 50, 100, 100); ctx.globalCompositeOperation = 'source-over';
      heroes.forEach(a => { a.dy = -Math.round((1 - ease.outBack(Math.min(1, intro * 1.4))) * 6); a.draw(ctx, t); });
    },
  };
  stage.scene = scene;

  const title = h('h1', { class: 'drop' }, ...[...'Evermore'].map((ch, i) => { const s = h('span', {}, ch); s.style.animationDelay = `${300 + i * 60}ms`; return s; }));
  const raise = h('button', { class: 'btn', onClick: () => start() }, 'Raise a hero');
  const practiceLink = h('button', { class: 'link', onClick: () => start() }, hasRealChain() ? 'or practice first, no wallet' : 'Practice runs in your browser, no wallet');
  root.append(h('section', { class: 'screen front' },
    h('div', { class: 'title' }, title, h('div', { class: 'line drop' }, "Games die. Heroes don't.")),
    h('div', { class: 'cta scrim-b' }, raise, practiceLink)));

  async function start() {
    const mine = await app.chain.myHeroes();
    go(mine.length ? 'arena' : 'raise');
  }
});
