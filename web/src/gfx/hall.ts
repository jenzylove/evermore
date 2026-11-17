// The arena hall backdrop: one stone hall that scrolls, built from the 0x72 tiles, lit by its fountains.
import { tile } from './atlas';
import { stage } from './stage';

const h2 = (a: number, b: number) => { let x = (a * 374761393 + b * 668265263) | 0; x = (x ^ (x >>> 13)) * 1274126177; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export type HallOpts = { floorY: number; camX?: number; light?: number; focusX?: number; focusY?: number };

/** Draw the hall. Feature columns every 6 tiles so a scrolling lineup has rhythm. */
export function drawHall(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, o: HallOpts) {
  const cam = Math.round(o.camX ?? 0);
  const fy = Math.round(o.floorY);
  const top = fy - 48;
  // the wall rises off the top of the screen; upper courses fall into darkness
  const c0p = Math.floor(cam / 16) - 1, c1p = Math.ceil((cam + W) / 16) + 1;
  ctx.fillStyle = '#0d0a15'; ctx.fillRect(0, 0, W, top + 1);
  for (let y = top - 16; y > -16; y -= 16) for (let c = c0p; c < c1p; c++) {
    const v = h2(c, Math.round(y / 16) + 900);
    tile(ctx, v < 0.06 ? 'wall_hole_1' : 'wall_mid', 0, c * 16 - cam, y);
  }
  // a ledge course and banners hung high
  for (let c = c0p; c < c1p; c++) {
    const x = c * 16 - cam, f = ((c % 6) + 6) % 6;
    if (top - 64 > -16) tile(ctx, 'wall_top_mid', 0, x, top - 64);
    if ((f === 1 || f === 5) && top - 48 > -16) tile(ctx, ['wall_banner_red', 'wall_banner_blue'][f === 1 ? 0 : 1], 0, x, top - 48);
  }
  const g = ctx.createLinearGradient(0, 0, 0, top + 8);
  g.addColorStop(0, 'rgba(7,5,12,0.97)'); g.addColorStop(0.55, 'rgba(7,5,12,0.75)'); g.addColorStop(1, 'rgba(7,5,12,0.15)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, top + 8);
  const c0 = Math.floor(cam / 16) - 1, c1 = Math.ceil((cam + W) / 16) + 1;
  for (let c = c0; c < c1; c++) {
    const x = c * 16 - cam;
    const feat = ((c % 6) + 6) % 6;
    tile(ctx, 'wall_top_mid', 0, x, top);
    if (feat === 0) {
      tile(ctx, 'wall_fountain_top', 0, x, top);
      const blue = ((Math.floor(c / 6) % 2) + 2) % 2 === 0;
      tile(ctx, blue ? 'wall_fountain_mid_blue' : 'wall_fountain_mid_red', t / 160 + c, x, top + 16);
      tile(ctx, blue ? 'wall_fountain_basin_blue' : 'wall_fountain_basin_red', t / 160 + c, x, top + 32);
    } else if (feat === 2 || feat === 4) {
      tile(ctx, 'wall_mid', 0, x, top + 16);
      const b = ['wall_banner_red', 'wall_banner_blue', 'wall_banner_green', 'wall_banner_yellow'][Math.floor(h2(c, 3) * 4)];
      tile(ctx, b, 0, x, top + 16);
      tile(ctx, h2(c, 9) < 0.2 ? 'wall_hole_1' : 'wall_mid', 0, x, top + 32);
    } else {
      tile(ctx, 'wall_mid', 0, x, top + 16);
      tile(ctx, h2(c, 5) < 0.12 ? 'wall_hole_1' : 'wall_mid', 0, x, top + 32);
    }
  }
  // floor
  const rows = Math.ceil((H - fy) / 16) + 1;
  for (let r = 0; r < rows; r++) for (let c = c0; c < c1; c++) {
    const v = h2(c, r + 40);
    const n = v < 0.62 ? 'floor_1' : `floor_${2 + Math.floor((v - 0.62) / 0.38 * 7)}`;
    tile(ctx, n, 0, c * 16 - cam, fy + r * 16);
  }
  // contact shadow under the wall
  ctx.fillStyle = 'rgba(5,3,10,0.45)'; ctx.fillRect(0, fy, W, 2);
  ctx.fillStyle = 'rgba(5,3,10,0.25)'; ctx.fillRect(0, fy + 2, W, 2);
  // fountain light pools
  ctx.globalCompositeOperation = 'lighter';
  for (let c = c0 - 6; c < c1 + 6; c++) {
    if ((((c % 6) + 6) % 6) !== 0) continue;
    const blue = ((Math.floor(c / 6) % 2) + 2) % 2 === 0;
    const x = c * 16 - cam + 8, fl = 0.85 + 0.15 * Math.sin(t / 230 + c);
    const lg = ctx.createRadialGradient(x, fy + 4, 0, x, fy + 4, 46);
    lg.addColorStop(0, blue ? `rgba(70,120,255,${0.22 * fl})` : `rgba(255,80,60,${0.2 * fl})`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg; ctx.fillRect(x - 46, fy - 50, 92, 100);
  }
  ctx.globalCompositeOperation = 'source-over';
  // vignette toward the focus
  const fx = o.focusX ?? W / 2, fyy = o.focusY ?? fy + 10;
  const vg = ctx.createRadialGradient(fx, fyy, Math.min(W, H) * 0.25, fx, fyy, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(7,5,12,0)'); vg.addColorStop(1, `rgba(7,5,12,${0.82 * (o.light ?? 1)})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  // drifting embers / dust
  if (Math.random() < 0.08) stage.mote(Math.random() * W, H * (0.3 + Math.random() * 0.6), (Math.random() - 0.5) * 4, -6 - Math.random() * 6, Math.random() < 0.5 ? '#f6c453' : '#8ff6e6', 3000);
}
