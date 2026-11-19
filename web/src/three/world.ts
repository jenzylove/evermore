// The one 3D world every screen shares (the Hall of Evermore). A screen borrows fighters and cameras; leaving the screen gives them back.
import * as THREE from 'three';
import { engine } from './engine';
import { buildArena, DOT, type Arena } from './arena';
import { director, initFx, ward as wardMesh } from './fx';
import { loadKit, makeFighter, type Fighter, type Look } from './fighter';
import { ghostWarmup } from './ghost';
import { forgeWarmup } from './forge';

let arena: Arena;
let owned: Fighter[] = [];
let extras: THREE.Object3D[] = [];
let ticks: (() => void)[] = [];
let gen = 0;
let warmed: Promise<void> | null = null;

/** the trio on the front door, exactly as front.ts dresses them */
export const FRONT_TRIO: [number, Look][] = [
  [1, { level: 7, gear: [{ kind: 0, tier: 2 }] }],
  [0, { level: 10, gear: [{ kind: 1, tier: 3 }] }],
  [2, { level: 5, gear: [{ kind: 2, tier: 2 }] }],
];

const idle = () => new Promise<void>(r => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 30)));

export const world = {
  get arena() { return arena; },
  /**
   * First light: the hall, the statues and the front door's three fighters, compiled and on screen. Everything else the
   * game will use is compiled afterwards in the background (see warmRest), so the front door does not wait on it.
   */
  async boot(canvas: HTMLCanvasElement) {
    const kits = Promise.all([0, 1, 2].map(loadKit)); // fetch while the stone is cut
    performance.mark('a'); engine.mount(canvas); performance.measure('mount', 'a');
    performance.mark('b'); arena = buildArena(); performance.measure('arena', 'b');
    initFx();
    performance.mark('c');
    arena.statues(await kits); performance.measure('kits', 'c');
    performance.mark('d');
    const fs = await Promise.all(FRONT_TRIO.map(([c, l]) => makeFighter(c, l)));
    const g = new THREE.Group(); fs.forEach(f => g.add(f.root));
    engine.camera.position.set(0, 1.5, 7); engine.camera.lookAt(0, 1, 0);
    await engine.precompile(engine.scene);
    await engine.precompile(g);
    fs.forEach(f => f.dispose());
    performance.measure('warm', 'd');
    engine.ready = true;
  },
  /**
   * Compile every other shader the game uses (fighters in every look, ghosts, wards, flashes, rings, the Forge), a batch
   * at a time while the player looks at the front door, so no fight ever stalls on a compile.
   */
  warmRest() {
    if (warmed) return warmed;
    warmed = (async () => {
      performance.mark('r');
      const all = { level: 10, gear: [{ kind: 0, tier: 3 }, { kind: 1, tier: 1 }, { kind: 1, tier: 2 }, { kind: 1, tier: 3 }, { kind: 2, tier: 2 }] };
      for (const c of [0, 1, 2]) {
        await idle();
        const fs = await Promise.all([makeFighter(c, all), makeFighter(c, { level: 1 }, 1), makeFighter(c, { level: 3 }, 1)]);
        const g = new THREE.Group(); fs.forEach(f => g.add(f.root));
        await engine.precompile(g);
        fs.forEach(f => f.dispose());
      }
      await idle();
      const g = new THREE.Group();
      // the sprites and rings that impacts make on the fly, one of each
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.5, 8), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      g.add(wardMesh('#ffffff').mesh, spr, ring, ...ghostWarmup(), ...forgeWarmup());
      await engine.precompile(g);
      performance.measure('warm-rest', 'r');
    })();
    return warmed;
  },
  /** a fighter that lives until the screen changes */
  async fighter(cls: number, look: Look, spectral = 0): Promise<Fighter> {
    const g = gen;
    const f = await makeFighter(cls, look, spectral);
    // the screen was left while this loaded: drop it, and never resume the screen's code
    if (g !== gen) { f.dispose(); return new Promise<Fighter>(() => {}); }
    owned.push(f); engine.scene.add(f.root);
    return f;
  },
  drop(f: Fighter) { owned = owned.filter(x => x !== f); f.dispose(); },
  extra<T extends THREE.Object3D>(o: T) { extras.push(o); engine.scene.add(o); return o; },
  /** give back one extra before the screen ends */
  unextra(o: THREE.Object3D) { extras = extras.filter(x => x !== o); o.removeFromParent(); },
  /** a per frame callback that lives until the screen changes; returns a function that stops it sooner */
  tick(f: (dt: number, t: number) => void) {
    const off = engine.onTick(f); ticks.push(off);
    return () => { off(); ticks = ticks.filter(x => x !== off); };
  },
  /** called on every route change */
  reset() {
    gen++;
    owned.forEach(f => f.dispose()); owned = [];
    extras.forEach(o => o.removeFromParent()); extras = [];
    ticks.forEach(off => off()); ticks = [];
    engine.clearJobs(); arena?.dim(0); arena?.focus(0, 0);
    director.trauma = 0; director.drift = 0.6; director.orbit = null;
    const fx = document.getElementById('fx'); if (fx) fx.innerHTML = '';
    engine.rewatch();
  },
};
