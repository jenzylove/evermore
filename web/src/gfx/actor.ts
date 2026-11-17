// A hero on screen: body, weapon, shadow, guard ward, charge aura. Ghosts use the spectral layer.
import { CLASS_SPRITE, CLASS_WEAPON, R, spr, sprRot, type Layer } from './atlas';

export class Actor {
  x = 0; y = 0;         // feet position (virtual px)
  homeX = 0; homeY = 0;
  dx = 0; dy = 0;       // animated offsets
  sq = 0;               // squash (+) / stretch (-)
  face = 1;             // 1 faces right
  anim: 'idle' | 'run' | 'hit' = 'idle';
  weaponAngle = 0;      // radians; rests upright so the blade stays pixel crisp
  weaponReach = 0;
  flash = 0;            // white flash ms left
  ward = 0;             // guard bubble 0..1
  aura = 0;             // special charge glow 0..1
  alpha = 1;
  dead = 0;             // 0..1 fall
  phase = Math.random() * 1000;
  body: string; weapon: string;
  constructor(public cls: number, public fem: boolean, public layer: Layer = 'img') {
    this.body = CLASS_SPRITE(cls, fem); this.weapon = CLASS_WEAPON(cls, fem);
  }
  place(x: number, y: number) { this.x = this.homeX = x; this.y = this.homeY = y; }

  update(dt: number) { this.flash = Math.max(0, this.flash - dt); this.phase += dt; }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const x = this.x + this.dx, y = this.y + this.dy;
    const flip = this.face < 0;
    // shadow
    ctx.globalAlpha = 0.35 * this.alpha;
    ctx.fillStyle = '#05030a';
    const sw = 7 + Math.round(this.sq * 2);
    ctx.fillRect(Math.round(this.x + this.dx * 0.6 - sw), Math.round(this.y - 1), sw * 2, 2);
    ctx.fillRect(Math.round(this.x + this.dx * 0.6 - sw + 2), Math.round(this.y - 2), sw * 2 - 4, 1);
    ctx.globalAlpha = this.alpha;
    const frames = R[`${this.body}_${this.anim}`]?.[4] ?? 1;
    const fr = this.anim === 'hit' ? 0 : Math.floor(this.phase / (this.anim === 'run' ? 80 : 140)) % frames;
    const layer: Layer = this.flash > 0 ? 'white' : this.layer;
    // weapon behind for idle when facing away from viewer side
    const hand = { x: x + 5 * this.face, y: y - 7 };
    const bob = this.anim === 'idle' ? (fr === 1 || fr === 2 ? 1 : 0) : 0;
    ctx.save();
    if (this.dead > 0) {
      ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(-this.face * this.dead * 1.45); ctx.translate(-Math.round(x), -Math.round(y));
      ctx.globalAlpha = this.alpha * (1 - this.dead * 0.4);
    }
    if (this.sq) {
      const s = 1 + this.sq * 0.12;
      ctx.translate(Math.round(x), Math.round(y)); ctx.scale(1 / s, s); ctx.translate(-Math.round(x), -Math.round(y));
    }
    // charged: a one pixel outline that pulses, the sprite's own silhouette
    if (this.aura > 0.01) {
      const glow: Layer = this.layer === 'ghost' ? 'spirit' : 'gold';
      ctx.globalAlpha = this.alpha * this.aura * (0.55 + 0.45 * Math.sin(t / 90));
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) spr(ctx, `${this.body}_${this.anim}`, fr, x + ox, y + oy, flip, glow);
      ctx.globalAlpha = this.alpha * (this.dead > 0 ? 1 - this.dead * 0.4 : 1);
    }
    spr(ctx, `${this.body}_${this.anim}`, fr, x, y, flip, layer);
    // weapon: pivot near the grip
    const wr = R[this.weapon];
    if (wr && this.dead < 0.5) {
      const grip = this.cls === 2 ? wr[3] - 10 : wr[3] - 3;
      sprRot(ctx, this.weapon, hand.x + this.face * this.weaponReach, hand.y + bob, wr[2] / 2, grip, this.weaponAngle * this.face, false, this.flash > 0 ? 'white' : this.layer);
    }
    ctx.restore();
    // guard ward: a pixel arc in front
    if (this.ward > 0.01) {
      const c = this.layer === 'ghost' ? '#bff9ff' : '#9fd8ff';
      ctx.globalAlpha = this.alpha * this.ward;
      ctx.fillStyle = c;
      const fx = Math.round(x + this.face * 9);
      for (let i = -12; i <= 0; i++) {
        const off = Math.round(Math.sqrt(Math.max(0, 1 - ((i + 6) / 7) ** 2)) * 2.5);
        ctx.fillRect(fx + this.face * off, Math.round(y - 4 + i - 4), 1, 1);
      }
      ctx.globalAlpha = this.alpha * this.ward * 0.25;
      for (let i = -12; i <= 0; i++) ctx.fillRect(fx + this.face * -1, Math.round(y - 8 + i), 1, 1);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }
}
