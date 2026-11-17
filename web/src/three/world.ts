// The one 3D world every screen shares (the Hall of Evermore). A screen borrows fighters and cameras; leaving the screen gives them back.
import * as THREE from 'three';
import { engine } from './engine';
import { buildArena, type Arena } from './arena';
import { director, flash, initFx, shock, ward as wardMesh } from './fx';
import { loadKit, makeFighter, type Fighter, type Look } from './fighter';
import { ghostWarmup } from './ghost';
import { forgeWarmup } from './forge';

let arena: Arena;
let owned: Fighter[] = [];
let extras: THREE.Object3D[] = [];
let ticks: (() => void)[] = [];
let gen = 0;

export const world = {
  get arena() { return arena; },
  async boot(canvas: HTMLCanvasElement) {
    const kits = Promise.all([0, 1, 2].map(loadKit)); // fetch while the stone is cut
    performance.mark('a'); engine.mount(canvas); performance.measure('mount', 'a');
    performance.mark('b'); arena = buildArena(); performance.measure('arena', 'b');
    initFx();
    performance.mark('c');
    arena.statues(await kits); performance.measure('kits', 'c');
    // Compile every shader the game will use behind the loading veil (fighters in every look, ghosts, wards,
    // flashes, rings), so no fight ever stalls on a compile. D3D compiles are slow; this pays them once.
    performance.mark('d');
    const warm: THREE.Object3D[] = [];
    const all = { level: 10, gear: [{ kind: 0, tier: 3 }, { kind: 1, tier: 1 }, { kind: 1, tier: 2 }, { kind: 1, tier: 3 }, { kind: 2, tier: 2 }] };
    const fs = await Promise.all([0, 1, 2].flatMap(c => [makeFighter(c, all), makeFighter(c, { level: 1 }, 1)]));
    fs.forEach((f, i) => { f.root.position.set(i - 2.5, 0, 0); warm.push(f.root); });
    const w = wardMesh('#ffffff'); warm.push(w.mesh);
    flash(new THREE.Vector3(0, 1, 0), '#ffffff', 1, 0.01); shock(new THREE.Vector3(0, 1, 0), '#ffffff', 1, 0.01);
    warm.push(...ghostWarmup(), ...forgeWarmup());
    warm.forEach(o => engine.scene.add(o));
    engine.camera.position.set(0, 1.5, 7); engine.camera.lookAt(0, 1, 0);
    // compile for the composer's linear target, the one every frame really renders into
    engine.renderer.setRenderTarget(engine.composer.inputBuffer);
    await engine.renderer.compileAsync(engine.scene, engine.camera);
    engine.renderer.setRenderTarget(null);
    engine.composer.render(0.016);
    fs.forEach(f => f.dispose()); warm.forEach(o => o.removeFromParent());
    performance.measure('warm', 'd');
    engine.ready = true;
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
  tick(f: (dt: number, t: number) => void) { ticks.push(engine.onTick(f)); },
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
