// One renderer, one scene, one grade. Everything on screen is lit by the same rig and goes through the same post chain,
// so the fighters, the stone and the effects read as one world.
// Game time lives here too: hit stop freezes it, slow motion scales it, tweens and waits run on it.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BloomEffect, BrightnessContrastEffect, EffectComposer, EffectPass, HueSaturationEffect, RenderPass,
  SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';

type Job = { dur: number; age: number; fn: (t: number) => void; done: () => void };
export type Tier = 0 | 1 | 2;

export const ease = {
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  outQuint: (t: number) => 1 - (1 - t) ** 5,
};

const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;

class Engine {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  composer!: EffectComposer;
  env: THREE.Texture | null = null;
  bloom!: BloomEffect;
  vignette!: VignetteEffect;
  tier: Tier = (params.has('q') ? Math.max(0, Math.min(2, Number(params.get('q')))) : coarse ? 1 : 2) as Tier;
  /** scaled game time in seconds */
  t = 0;
  stop = 0;     // hit stop left, ms of real time
  slow = 1;     // time scale
  private jobs: Job[] = [];
  private ticks = new Set<(dt: number, t: number) => void>();
  private realTicks = new Set<(real: number) => void>();
  private last = 0;
  private frames: number[] = [];
  private settled = false;
  ready = false;

  mount(canvas: HTMLCanvasElement) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping; // tone mapping happens in the composer
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const pm = new THREE.PMREMGenerator(r);
    // reflections only on metal (set per material), so the many plain materials stay cheap to compile
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.background = new THREE.Color('#070b16');
    this.scene.fog = new THREE.Fog('#0d1526', 14, 46);
    this.buildComposer();
    this.fit();
    addEventListener('resize', () => this.fit());
    const frame = (now: number) => {
      const real = Math.min(50, now - (this.last || now)); this.last = now;
      let dt = real;
      if (this.stop > 0) { this.stop -= real; dt = 0; }
      dt *= this.slow;
      this.t += dt / 1000;
      for (const j of [...this.jobs]) {
        j.age += dt; const p = Math.min(1, j.age / j.dur); j.fn(p);
        if (p >= 1) { this.jobs.splice(this.jobs.indexOf(j), 1); j.done(); }
      }
      for (const f of this.ticks) f(dt / 1000, this.t);
      for (const f of this.realTicks) f(real / 1000);
      if (this.ready) { if (params.has('nofx')) this.renderer.render(this.scene, this.camera); else this.composer.render(real / 1000); }
      this.watch(real);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private buildComposer() {
    const r = this.renderer;
    this.composer?.dispose();
    const c = this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.82, luminanceSmoothing: 0.18, intensity: 0.9, radius: 0.72 });
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
    const fx: import('postprocessing').Effect[] = [this.bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new HueSaturationEffect({ saturation: -0.08 }),
      new BrightnessContrastEffect({ contrast: 0.09, brightness: 0.0 }), this.vignette];
    if (this.tier >= 1) fx.push(new SMAAEffect({ preset: this.tier >= 2 ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }));
    c.addPass(new EffectPass(this.camera, ...fx));
  }

  fit() {
    const r = this.renderer; if (!r) return;
    const dpr = Math.min(devicePixelRatio || 1, [1, 1.5, 1.75][this.tier]);
    r.setPixelRatio(dpr);
    r.setSize(innerWidth, innerHeight, false);
    this.composer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Watch the frame rate for the first seconds of each scene; step quality down if the device cannot hold ~50 fps. */
  private watch(real: number) {
    if (!this.ready || this.settled || document.hidden) return;
    this.frames.push(real);
    if (this.frames.length < 90) return;
    const avg = this.frames.slice(30).reduce((a, b) => a + b, 0) / (this.frames.length - 30);
    this.frames = [];
    if (avg > 21 && this.tier > 0 && !params.has('q')) { this.setTier((this.tier - 1) as Tier); }
    else this.settled = true;
  }
  setTier(t: Tier) {
    this.tier = t;
    this.renderer.shadowMap.enabled = true;
    this.scene.traverse(o => { const l = o as THREE.Light; if (l.isLight && l.shadow) { l.shadow.mapSize.setScalar(t >= 2 ? 2048 : t === 1 ? 1024 : 512); l.shadow.map?.dispose(); (l.shadow as unknown as { map: null }).map = null; } });
    this.buildComposer(); this.fit();
    for (const f of this.tierListeners) f(t);
  }
  tierListeners = new Set<(t: Tier) => void>();
  /** a fresh scene gets a fresh look at the frame rate */
  rewatch() { this.settled = false; this.frames = []; }

  onTick(f: (dt: number, t: number) => void) { this.ticks.add(f); return () => { this.ticks.delete(f); }; }
  onReal(f: (real: number) => void) { this.realTicks.add(f); return () => { this.realTicks.delete(f); }; }
  tween(ms: number, fn: (t: number) => void) { return new Promise<void>(done => this.jobs.push({ dur: Math.max(1, ms), age: 0, fn, done })); }
  wait(ms: number) { return this.tween(ms, () => {}); }
  hitstop(ms: number) { this.stop = Math.max(this.stop, ms); }
  /** a screen change drops pending tweens without resolving them, so a left screen never acts again */
  clearJobs() { this.jobs = []; this.slow = 1; this.stop = 0; }
}

export const engine = new Engine();
