// The render loop: a low res world canvas scaled by a whole number, plus a full res overlay for text.
// Game feel lives here: hit stop, trauma shake (Eiserloh), slow motion, flashes, particles, pop numbers.

export interface Scene {
  update(dt: number, t: number): void;
  draw(lo: CanvasRenderingContext2D, W: number, H: number, t: number): void;
  overlay?(hi: CanvasRenderingContext2D, k: number, t: number): void;
  /** framing: virtual px across in portrait, virtual px tall in landscape */
  view?: { pw: number; lh: number };
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; g: number; s: number };
type Pop = { x: number; y: number; text: string; c: string; age: number; big: boolean };
type Job = { dur: number; age: number; fn: (t: number) => void; done: () => void };

export const ease = {
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  outElastic: (t: number) => t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
};

class Stage {
  canvas!: HTMLCanvasElement;
  hi!: CanvasRenderingContext2D;
  loC = document.createElement('canvas');
  lo = this.loC.getContext('2d')!;
  W = 120; H = 200; k = 4; // virtual size and device px per virtual px
  private _scene: Scene | null = null;
  get scene() { return this._scene; }
  set scene(s: Scene | null) { this._scene = s; this.fit?.(); }
  fit?: () => void;
  t = 0;
  trauma = 0;
  stop = 0;          // hit stop remaining, ms of real time
  slow = 1;          // time scale
  flash = 0; flashColor = '#fff';
  dim = 0;           // special move darkening 0..1
  parts: Particle[] = [];
  pops: Pop[] = [];
  jobs: Job[] = [];
  private last = 0;

  mount(c: HTMLCanvasElement) {
    this.canvas = c; this.hi = c.getContext('2d')!;
    const fit = this.fit = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
      c.width = w; c.height = h; c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px';
      // portrait: about 104 virtual px across; landscape: about 160 tall
      const v = this._scene?.view ?? { pw: 104, lh: 160 };
      this.k = Math.max(2, Math.floor(innerWidth < innerHeight ? Math.min(w / v.pw, h / (v.pw * 1.9)) : Math.min(w / (v.lh * 1.4), h / v.lh)));
      this.W = Math.ceil(w / this.k); this.H = Math.ceil(h / this.k);
      this.loC.width = this.W; this.loC.height = this.H;
    };
    fit(); addEventListener('resize', fit);
    const frame = (now: number) => {
      const real = Math.min(50, now - (this.last || now)); this.last = now;
      let dt = real;
      if (this.stop > 0) { this.stop -= real; dt = 0; }
      dt *= this.slow;
      this.t += dt;
      this.tick(dt, real);
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private tick(dt: number, real: number) {
    this.trauma = Math.max(0, this.trauma - real / 600);
    this.flash = Math.max(0, this.flash - real / 160);
    for (const j of [...this.jobs]) {
      j.age += dt; const p = Math.min(1, j.age / j.dur); j.fn(p);
      if (p >= 1) { this.jobs.splice(this.jobs.indexOf(j), 1); j.done(); }
    }
    for (const p of this.parts) { p.life -= dt; p.vy += p.g * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter(p => p.age < 1100);
    this.scene?.update(dt, this.t);
  }

  private render() {
    const { lo, hi, W, H, k } = this;
    lo.imageSmoothingEnabled = false;
    lo.clearRect(0, 0, W, H);
    this.scene?.draw(lo, W, H, this.t);
    for (const p of this.parts) {
      lo.globalAlpha = Math.min(1, p.life / p.max * 1.5); lo.fillStyle = p.c;
      lo.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    lo.globalAlpha = 1;
    if (this.dim > 0) { lo.fillStyle = `rgba(6,4,14,${this.dim * 0.6})`; lo.fillRect(0, 0, W, H); }
    // shake = trauma^2, mostly translation in whole virtual pixels plus a hair of roll
    const s = this.trauma * this.trauma, n = this.t / 16;
    const sx = Math.round(Math.sin(n * 1.7) * Math.cos(n * 0.9) * 5 * s) * k;
    const sy = Math.round(Math.sin(n * 2.3 + 1) * 4 * s) * k;
    const rot = Math.sin(n * 1.1) * 0.02 * s;
    hi.imageSmoothingEnabled = false;
    hi.fillStyle = '#07060d'; hi.fillRect(0, 0, this.canvas.width, this.canvas.height);
    hi.save();
    hi.translate(this.canvas.width / 2 + sx, this.canvas.height / 2 + sy); hi.rotate(rot);
    hi.drawImage(this.loC, -W * k / 2, -H * k / 2, W * k, H * k);
    hi.restore();
    this.scene?.overlay?.(hi, k, this.t);
    this.drawPops();
    if (this.flash > 0) { hi.globalAlpha = this.flash * 0.7; hi.fillStyle = this.flashColor; hi.fillRect(0, 0, this.canvas.width, this.canvas.height); hi.globalAlpha = 1; }
  }

  private drawPops() {
    const { hi, k } = this;
    hi.textAlign = 'center'; hi.textBaseline = 'alphabetic';
    for (const p of this.pops) {
      const a = p.age / 1100;
      const rise = ease.outCubic(Math.min(1, p.age / 500)) * 12 + a * 6;
      const sc = p.age < 140 ? ease.outBack(p.age / 140) : 1;
      const size = Math.round((p.big ? 9 : 6) * k * Math.max(0.1, sc));
      hi.font = `700 ${size}px Pixelify, monospace`;
      const x = p.x * k, y = (p.y - rise) * k;
      hi.globalAlpha = a > 0.75 ? (1 - a) / 0.25 : 1;
      hi.lineWidth = Math.max(2, k * 0.9); hi.strokeStyle = '#0b0712'; hi.lineJoin = 'round';
      hi.strokeText(p.text, x, y); hi.fillStyle = p.c; hi.fillText(p.text, x, y);
    }
    hi.globalAlpha = 1;
  }

  // ---- feel API ----
  shake(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }
  hitstop(ms: number) { this.stop = Math.max(this.stop, ms); }
  flashScreen(c = '#fff', a = 1) { this.flash = a; this.flashColor = c; }
  burst(x: number, y: number, n: number, colors: string[], speed = 60, g = 120, life = 500, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random());
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life: life * (0.6 + Math.random() * 0.6), max: life, c: colors[i % colors.length], g, s: size + (Math.random() < 0.25 ? 1 : 0) });
    }
  }
  mote(x: number, y: number, vx: number, vy: number, c: string, life: number, g = 0) { this.parts.push({ x, y, vx, vy, life, max: life, c, g, s: 1 }); }
  pop(x: number, y: number, text: string, c: string, big = false) { this.pops.push({ x, y, text, c, age: 0, big }); }
  tween(ms: number, fn: (t: number) => void) { return new Promise<void>(done => this.jobs.push({ dur: Math.max(1, ms), age: 0, fn, done })); }
  wait(ms: number) { return this.tween(ms, () => {}); }
  clearFx() { this.parts = []; this.pops = []; this.jobs = []; this.dim = 0; this.slow = 1; this.trauma = 0; }
}

export const stage = new Stage();
