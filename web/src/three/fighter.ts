// A fighter on the stone: a rigged Mixamo character, its class clips, and everything that shows how far it has come.
// Level and gear are worn on the body: plates on the shoulders, glowing veins under the skin, a lit weapon hand,
// an aura at the feet, a halo, and at level 10 a crown. Gear the player owns hangs where it would be carried.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { engine } from './engine';
import { DOT } from './arena';

export type Clip = 'idle' | 'strike' | 'guard' | 'special' | 'hit' | 'ko' | 'victory' | 'taunt';
const FILES = ['knight', 'rogue', 'mage'];
/** where in each clip the blow lands (fraction of the clip), and how fast we play it */
export const CONTACT: Record<string, { strike: number; special: number; speed: number; sspeed: number }> = {
  knight: { strike: 0.36, special: 0.5, speed: 1.35, sspeed: 1.25 },
  rogue: { strike: 0.38, special: 0.42, speed: 1.4, sspeed: 1.3 },
  mage: { strike: 0.42, special: 0.5, speed: 1.3, sspeed: 1.25 },
};
const ANIM_HIP_Y = 0.956; // the clips are packed in the knight's hip space (see scripts/build-models.mjs)
/** the Vampire mage stands about 2.2 m; bring every class to roughly one height */
const BASE_SCALE = [1, 1, 0.84];

type Kit = { scene: THREE.Object3D; clips: Map<Clip, THREE.AnimationClip>; hipY: number };
const kits = new Map<number, Promise<Kit>>();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export function loadKit(cls: number): Promise<Kit> {
  let p = kits.get(cls);
  if (!p) {
    p = (async () => {
      const [m, a] = await Promise.all([loader.loadAsync(`/models/${FILES[cls]}.glb`), loader.loadAsync(`/models/anims-${FILES[cls]}.glb`)]);
      const hips = m.scene.getObjectByName('mixamorigHips')!;
      const hipY = hips.position.y, k = hipY / ANIM_HIP_Y;
      const clips = new Map<Clip, THREE.AnimationClip>();
      for (const c of a.animations) {
        const clip = c.clone();
        for (const t of clip.tracks) {
          if (!t.name.endsWith('.position')) continue;
          const v = t.values, x0 = v[0], z0 = v[2], keep = clip.name === 'ko';
          for (let i = 0; i < v.length; i += 3) {
            v[i] = hips.position.x + (keep ? (v[i] - x0) * k : 0);
            v[i + 1] = v[i + 1] * k;
            v[i + 2] = hips.position.z + (keep ? (v[i + 2] - z0) * k : 0);
          }
        }
        clips.set(clip.name as Clip, clip);
      }
      return { scene: m.scene, clips, hipY };
    })();
    kits.set(cls, p);
  }
  return p;
}

// ---- progression ----
export type Look = { level: number; gear?: { kind: number; tier: number }[] };
export const tierOf = (level: number) => (level >= 10 ? 4 : level >= 7 ? 3 : level >= 5 ? 2 : level >= 3 ? 1 : 0);
export const TIER_COLOR = ['#ffffff', '#ff7a2e', '#ffb43a', '#a983ff', '#ffcf6a'];
export const TIER_NAME = ['', 'Blooded', 'Tempered', 'Exalted', 'Crowned'];

const M = (color: string, metalness: number, roughness: number) => new THREE.MeshStandardMaterial({ color, metalness, roughness, envMap: engine.env, envMapIntensity: 0.6 });
const metal = {
  iron: () => M('#7a756e', 1, 0.38),
  dark: () => M('#4a4540', 1, 0.3),
  gold: () => M('#d7a548', 1, 0.24),
  leather: () => M('#3b2618', 0, 0.8),
};
const glow = (c: string, k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: true });

function bladeMesh(tier: number) {
  const g = new THREE.Group();
  const s = new THREE.Shape(); s.moveTo(-0.028, 0); s.lineTo(0.028, 0); s.lineTo(0.022, 0.6); s.lineTo(0, 0.7); s.lineTo(-0.022, 0.6); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }); geo.translate(0, 0, -0.003);
  const blade = new THREE.Mesh(geo, tier >= 3 ? metal.gold() : metal.iron()); blade.position.y = 0.06;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), tier >= 2 ? metal.gold() : metal.dark());
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.15, 8), metal.leather()); grip.position.y = -0.08;
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), tier >= 2 ? glow(tier >= 3 ? '#ffd27a' : '#ff3b3b', 3) : metal.dark()); pom.position.y = -0.17;
  g.add(blade, guard, grip, pom);
  return g;
}
function heavyMesh(tier: number) {
  const g = new THREE.Group();
  const len = tier >= 3 ? 0.95 : 0.75;
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, len, 8), metal.leather()); g.add(haft);
  if (tier <= 1) { // old mace: a studded iron head
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), metal.dark()); head.position.y = len / 2 + 0.04; g.add(head);
    for (let i = 0; i < 8; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 6), metal.iron()); const a = i / 8 * Math.PI * 2; sp.position.set(Math.cos(a) * 0.08, len / 2 + 0.04 + (i % 2 ? 0.03 : -0.03), Math.sin(a) * 0.08); sp.lookAt(sp.position.clone().multiplyScalar(2)); sp.rotateX(Math.PI / 2); g.add(sp); }
  } else if (tier === 2) { // war axe: a bearded blade
    const s = new THREE.Shape(); s.moveTo(0, 0.06); s.quadraticCurveTo(0.12, 0.12, 0.2, 0.16); s.quadraticCurveTo(0.17, 0, 0.2, -0.16); s.quadraticCurveTo(0.1, -0.08, 0, -0.06); s.closePath();
    const ax = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 1 }), metal.iron());
    ax.position.set(0.01, len / 2 - 0.1, -0.006); g.add(ax);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.3, 0.02), glow('#ff6a2a', 2.5)); edge.position.set(0.205, len / 2 - 0.1, 0); g.add(edge);
  } else { // long spear: a gold leaf tip
    const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.05, 0.08, 0, 0.26); s.quadraticCurveTo(-0.05, 0.08, 0, 0);
    const tip = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), metal.gold());
    tip.position.set(0, len / 2, -0.005); g.add(tip);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 14), metal.gold()); ring.rotation.x = Math.PI / 2; ring.position.y = len / 2 - 0.02; g.add(ring);
  }
  return g;
}
function flaskMesh(tier: number) {
  const g = new THREE.Group();
  const col = ['#ff3048', '#3f8cff', '#ffc040'][Math.max(0, Math.min(2, tier - 1))];
  const pts = [[0, 0], [0.05, 0.004], [0.062, 0.04], [0.058, 0.08], [0.024, 0.11], [0.02, 0.15], [0, 0.15]].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), Object.assign(M('#d8e4ff', 0, 0.08), { transparent: true, opacity: 0.35 }));
  const liquid = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), glow(col, 2.6)); liquid.position.y = 0.05; liquid.scale.y = 0.85;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.03, 8), metal.leather()); cork.position.y = 0.16;
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.006, 6, 18), metal.leather()); strap.rotation.x = Math.PI / 2; strap.position.y = 0.06;
  g.add(glass, liquid, cork, strap);
  return g;
}
function pauldron(tier: number, side: 1 | -1, scale: number) {
  const g = new THREE.Group();
  const m = tier >= 3 ? metal.gold() : tier >= 2 ? metal.iron() : metal.dark();
  for (let i = 0; i < 3; i++) { // three overlapping lames
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.095 - i * 0.01, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), m);
    d.scale.set(1.1, 0.42, 1.0); d.position.set(side * i * 0.022, -i * 0.032, 0); d.castShadow = true; g.add(d);
  }
  if (tier >= 2) { // a raised spine of lit metal along the top
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.008, 0.008), glow(TIER_COLOR[tier], 2.2)); ridge.position.y = 0.04; g.add(ridge);
  }
  g.scale.setScalar(scale);
  g.rotation.z = -side * 0.42;
  return g;
}
function crown(color: string) {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.11, 0.05, 24, 1, true), metal.gold()); band.material.side = THREE.DoubleSide; g.add(band);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, tall = i % 2 ? 0.07 : 0.12;
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.018, tall, 5), metal.gold()); sp.position.set(Math.cos(a) * 0.105, 0.025 + tall / 2, Math.sin(a) * 0.105); g.add(sp);
    if (!(i % 2)) { const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.014), glow(color, 3)); gem.position.set(Math.cos(a) * 0.112, 0.0, Math.sin(a) * 0.112); g.add(gem); }
  }
  return g;
}

// ---- the one shader patch every fighter wears: veins, hit flash, spectral rim ----
type U = { uT: { value: number }; uVein: { value: number }; uVeinC: { value: THREE.Color }; uFlash: { value: number }; uGhost: { value: number }; uRim: { value: THREE.Color }; uRimK: { value: number } };
function patch(mat: THREE.MeshStandardMaterial, u: U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObj; uniform float uT, uVein, uFlash, uGhost, uRimK; uniform vec3 uVeinC, uRim;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float fr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.5);
        vec3 p = vObj * 9.0;
        float w = sin(p.y * 2.3 + sin(p.x * 1.7 + p.z * 1.3) * 2.2) + 0.6 * sin(p.x * 3.1 - p.y * 1.1 + sin(p.z * 2.0) * 1.5);
        float mask = smoothstep(0.15, 0.7, sin(vObj.x * 13.0 + 1.3) * sin(vObj.y * 7.0 - 0.4) * sin(vObj.z * 11.0 + 2.1) * 0.5 + 0.5);
        float vein = (1.0 - smoothstep(0.0, 0.07, abs(w))) * mask;
        float pulse = 0.55 + 0.45 * sin(uT * 2.6 - vObj.y * 5.0);
        totalEmissiveRadiance += uVeinC * vein * pulse * uVein;
        totalEmissiveRadiance += uRim * fr * uRimK;
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.9) * uFlash;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.25, 0.42, 0.5), uGhost);
        diffuseColor.a *= mix(1.0, 0.16 + fr * 0.9, uGhost);
      }`);
  };
  mat.customProgramCacheKey = () => 'evermore-fighter';
}

const _v = new THREE.Vector3();

export class Fighter {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private cur: THREE.AnimationAction | null = null;
  private u: U = { uT: { value: 0 }, uVein: { value: 0 }, uVeinC: { value: new THREE.Color() }, uFlash: { value: 0 }, uGhost: { value: 0 }, uRim: { value: new THREE.Color('#7fe9ff') }, uRimK: { value: 0 } };
  private anchors: Record<string, THREE.Object3D> = {};
  private lookGroup: THREE.Object3D[] = [];
  private aura: { pts: THREE.Points; seed: Float32Array; ring: THREE.Mesh; halo?: THREE.Object3D; hand?: THREE.Sprite } | null = null;
  private waits: { act: THREE.AnimationAction; at: number; fire: () => void }[] = [];
  mats: THREE.MeshStandardMaterial[] = [];
  flashT = 0;
  contact: THREE.Mesh | null = null;
  look: Look = { level: 1 };
  spectral = 0;
  private off: () => void;

  constructor(public cls: number, kit: Kit) {
    this.model = SkeletonUtils.clone(kit.scene);
    this.root.add(this.model);
    // contact shadow: soft dark pool where the feet meet the stone (stands in for ambient occlusion)
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: DOT, color: '#000000', transparent: true, opacity: 0.75, depthWrite: false }));
    cs.rotation.x = -Math.PI / 2; cs.position.y = 0.012; cs.renderOrder = -1; this.root.add(cs); this.contact = cs;
    this.model.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.roughness = cls === 0 ? 0.55 : 0.72; mat.metalness = cls === 0 ? 0.35 : 0.05;
      if (mat.emissiveMap) { mat.emissive.set('#ffffff'); mat.emissiveIntensity = 0.5; } // the vampire's eyes and sigils
      if (cls === 0) { mat.envMap = engine.env; mat.envMapIntensity = 0.5; }
      patch(mat, this.u); m.material = mat; this.mats.push(mat);
    });
    // anchors: empties that sit on the bones but keep the model's own axes, so attachments are placed in plain body space
    this.root.updateMatrixWorld(true);
    const bone = (n: string) => this.model.getObjectByName(`mixamorig${n}`)!;
    for (const [k, n] of Object.entries({ head: 'HeadTop_End', neck: 'Head', lArm: 'LeftArm', rArm: 'RightArm', spine: 'Spine2', hips: 'Hips', rHand: 'RightHand', lHand: 'LeftHand' })) {
      const b = bone(n); if (!b) continue;
      const a = new THREE.Object3D(); a.position.copy(b.getWorldPosition(_v)); this.root.add(a); this.root.updateMatrixWorld(true); b.attach(a); this.anchors[k] = a;
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of kit.clips) this.actions.set(name, this.mixer.clipAction(clip));
    this.play('idle', 0);
    this.mixer.update(Math.random() * 3); // fighters never idle in step
    this.off = engine.onTick(dt => this.update(dt));
  }

  /** loop a clip, cross faded from whatever was playing */
  play(name: Clip, fade = 0.25, speed = 1) {
    const a = this.actions.get(name)!;
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.timeScale = speed; a.enabled = true; a.setEffectiveWeight(1);
    if (this.cur && this.cur !== a && fade > 0) a.crossFadeFrom(this.cur, fade, true);
    a.play(); this.cur = a;
  }
  /** play once; `hit` resolves at the contact fraction, `done` at the end (then back to idle unless held) */
  once(name: Clip, opts: { fade?: number; speed?: number; at?: number; hold?: boolean } = {}) {
    const a = this.actions.get(name)!;
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = opts.speed ?? 1; a.enabled = true; a.setEffectiveWeight(1);
    if (this.cur && this.cur !== a) a.crossFadeFrom(this.cur, opts.fade ?? 0.12, true);
    a.play(); this.cur = a;
    const dur = a.getClip().duration;
    const hit = new Promise<void>(r => this.waits.push({ act: a, at: (opts.at ?? 0.5) * dur, fire: r }));
    const done = new Promise<void>(r => this.waits.push({ act: a, at: dur - (opts.hold ? 0 : 0.22 * (opts.speed ?? 1)), fire: () => { if (!opts.hold && this.cur === a) this.play('idle', 0.3); r(); } }));
    return { hit, done, ms: dur / (opts.speed ?? 1) * 1000 };
  }
  get clipName() { return this.cur?.getClip().name as Clip | undefined; }

  face(x: number, z: number) { this.root.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z); }
  flash(k = 1) { this.flashT = k; }
  /** a world point on the body: 'head' | 'chest' | 'hand' */
  point(at: 'head' | 'chest' | 'hand', out = new THREE.Vector3()) {
    const a = at === 'head' ? this.anchors.head : at === 'hand' ? this.anchors.rHand : this.anchors.spine;
    return a ? a.getWorldPosition(out) : out.copy(this.root.position).setY(1.3);
  }

  update(dt: number) {
    this.mixer.update(dt);
    for (const w of [...this.waits]) if (w.act.time >= w.at || !w.act.isRunning() && w.act.time > 0) { this.waits.splice(this.waits.indexOf(w), 1); w.fire(); }
    this.u.uT.value = engine.t;
    this.flashT = Math.max(0, this.flashT - dt * 7); this.u.uFlash.value = this.flashT * 1.6;
    if (this.aura) {
      const p = this.aura.pts.geometry.attributes.position as THREE.BufferAttribute, s = this.aura.seed, n = p.count;
      for (let i = 0; i < n; i++) {
        let y = p.getY(i) + dt * (0.35 + s[i] % 0.4);
        if (y > 2.2) y = 0.05;
        const a = s[i] + engine.t * (0.4 + (s[i] % 1) * 0.3), r = 0.45 + 0.25 * Math.sin(s[i] * 3 + y);
        p.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
      }
      p.needsUpdate = true;
      this.aura.ring.rotation.z += dt * 0.4;
      if (this.aura.halo) this.aura.halo.rotation.y += dt * 0.6;
      if (this.aura.hand) { this.aura.hand.scale.setScalar(0.15 + 0.03 * Math.sin(engine.t * 6)); }
    }
  }

  /** wear level and gear on the body */
  setLook(look: Look) {
    this.look = look;
    for (const o of this.lookGroup) o.removeFromParent();
    this.lookGroup = []; this.aura = null;
    const t = tierOf(look.level), col = TIER_COLOR[t];
    const add = (anchor: string, o: THREE.Object3D) => { o.traverse(c => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; }); this.anchors[anchor]?.add(o); this.lookGroup.push(o); };
    const size = [1, 0.85, 0.95][this.cls];
    // bigger with every level, a little, up to level 10
    this.model.scale.setScalar(BASE_SCALE[this.cls] * (1 + Math.min(10, look.level - 1) * 0.008));
    if (t >= 1) {
      const l = pauldron(t, 1, size), r = pauldron(t, -1, size);
      l.position.set(0.03, 0.07, -0.01); r.position.set(-0.03, 0.07, -0.01);
      add('lArm', l); add('rArm', r);
    }
    this.u.uVein.value = [0, 0, 0.7, 1.0, 1.3][t]; this.u.uVeinC.value.set(col);
    if (t >= 2) { // the weapon hand burns
      const hand = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color(col).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      hand.scale.setScalar(0.16); add('rHand', hand);
    }
    if (t >= 3) {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(t >= 4 ? 0.15 : 0.13, 0.005, 8, 64), glow(col, t >= 4 ? 2.2 : 1.6));
      halo.rotation.x = Math.PI / 2 - 0.25; halo.position.set(0, t >= 4 ? 0.16 : 0.1, -0.06);
      const hg = new THREE.Group(); hg.add(halo); add('head', hg);
    }
    if (t >= 4) { const c = crown(col); c.position.set(0, -0.03, 0); c.scale.setScalar(size * 1.05); add('head', c); }
    if (t >= 2) { // aura: rising motes and a slow ring of light on the floor
      const n = t >= 4 ? 90 : t >= 3 ? 60 : 30;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const seed = new Float32Array(n).map(() => Math.random() * 100);
      for (let i = 0; i < n; i++) (geo.attributes.position as THREE.BufferAttribute).setY(i, Math.random() * 2);
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: DOT, color: new THREE.Color(col).multiplyScalar(2), size: t >= 4 ? 0.07 : 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 64), new THREE.MeshBasicMaterial({ map: ringTex(), color: new THREE.Color(col).multiplyScalar(t >= 4 ? 1.8 : 1.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.scale.setScalar(t >= 4 ? 1.35 : 1);
      this.root.add(pts, ring); this.lookGroup.push(pts, ring);
      this.aura = { pts, seed, ring, halo: this.lookGroup.find(o => (o as THREE.Group).isGroup && o.children[0] && (o.children[0] as THREE.Mesh).geometry instanceof THREE.TorusGeometry), hand: this.lookGroup.find(o => (o as THREE.Sprite).isSprite) as THREE.Sprite | undefined };
    }
    // gear: the best piece of each kind, carried where it would be
    const best = new Map<number, number>();
    for (const g of look.gear ?? []) best.set(g.kind, Math.max(best.get(g.kind) ?? 0, g.tier));
    if (best.has(0)) { const b = bladeMesh(best.get(0)!); b.position.set(0.17 * size, -0.04, 0.02); b.rotation.set(0.35, 0, Math.PI - 0.25); add('hips', b); }
    if (best.has(1)) { const w = heavyMesh(best.get(1)!); w.position.set(0, -0.05, -0.16 * size); w.rotation.set(0, 0, 0.3); add('spine', w); }
    if (best.has(2)) { const f = flaskMesh(best.get(2)!); f.position.set(-0.16 * size, -0.06, 0.07); add('hips', f); }
    this.setSpectral(this.spectral);
  }

  /** 0 = flesh and steel, 1 = a ghost in the arena (translucent, cold rim); in between for a ghost met in a duel */
  setSpectral(k: number) {
    this.spectral = k;
    const ghost = k >= 0.99;
    this.u.uGhost.value = ghost ? 1 : 0;
    this.u.uRimK.value = k * (ghost ? 3.2 : 1.6);
    for (const m of this.mats) { m.transparent = ghost; m.depthWrite = true; m.needsUpdate = true; }
    this.model.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = !ghost; });
    if (this.contact) this.contact.visible = !ghost;
    for (const o of this.lookGroup) o.traverse(c => {
      const mm = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!mm || !(c as THREE.Mesh).isMesh) return;
      if (ghost && mm.isMeshStandardMaterial) { mm.transparent = true; mm.opacity = 0.35; mm.emissive = new THREE.Color('#3fb6c9'); mm.emissiveIntensity = 0.5; }
    });
  }

  rimColor(c: string) { this.u.uRim.value.set(c); }
  /** spectral opacity / glow for a ghost that is (1) or is not (0) the one in focus */
  ghostGlow(k: number) { this.u.uRimK.value = 1.6 + k * 2.4; }

  dispose() {
    this.off(); this.root.removeFromParent(); this.mixer.stopAllAction();
    this.mats.forEach(m => m.dispose());
  }
}

let _ring: THREE.Texture | null = null;
function ringTex() {
  if (_ring) return _ring;
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!;
  x.translate(128, 128);
  for (let i = 0; i < 36; i++) { x.rotate(Math.PI * 2 / 36); x.fillStyle = `rgba(255,255,255,${i % 3 ? 0.35 : 0.9})`; x.fillRect(96, -2, i % 3 ? 10 : 22, 4); }
  const g = x.createRadialGradient(0, 0, 80, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 128, 0, 7); x.fill();
  _ring = new THREE.CanvasTexture(c); return _ring;
}

export async function makeFighter(cls: number, look: Look = { level: 1 }, spectral = 0) {
  const f = new Fighter(cls, await loadKit(cls));
  f.spectral = spectral;
  f.setLook(look);
  return f;
}
