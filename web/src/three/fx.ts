// Impact language: sparks, a flash at the point of contact, a shock ring, a guard ward, a mage's bolt, damage numbers
// and screen flashes. Then the camera: framed shots, cuts, pushes and trauma shake (shake = trauma squared, mostly roll).
import * as THREE from 'three';
import { engine, ease } from './engine';
import { DOT } from './arena';

// ---- sparks: one pooled point cloud with per particle colour ----
const SN = 600;
const sGeo = new THREE.BufferGeometry();
const sPos = new Float32Array(SN * 3), sCol = new Float32Array(SN * 3), sVel = new Float32Array(SN * 3), sLife = new Float32Array(SN), sMax = new Float32Array(SN), sBase = new Float32Array(SN * 3), sG = new Float32Array(SN);
sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
let sNext = 0;

const flashes: { s: THREE.Sprite; age: number; life: number; size: number }[] = [];
const rings: { m: THREE.Mesh; age: number; life: number; size: number }[] = [];

export function initFx() {
  const pts = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: DOT, size: 0.07, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; engine.scene.add(pts);
  for (let i = 0; i < SN; i++) sPos[i * 3 + 1] = -99;
  engine.onTick(dt => {
    for (let i = 0; i < SN; i++) {
      if (sLife[i] <= 0) continue;
      sLife[i] -= dt;
      if (sLife[i] <= 0) { sPos[i * 3 + 1] = -99; continue; }
      sVel[i * 3 + 1] -= sG[i] * dt;
      const drag = Math.exp(-dt * 2.2);
      for (let k = 0; k < 3; k++) { sVel[i * 3 + k] *= drag; sPos[i * 3 + k] += sVel[i * 3 + k] * dt; }
      if (sPos[i * 3 + 1] < 0.02) { sPos[i * 3 + 1] = 0.02; sVel[i * 3 + 1] *= -0.3; }
      const f = sLife[i] / sMax[i];
      for (let k = 0; k < 3; k++) sCol[i * 3 + k] = sBase[i * 3 + k] * f;
    }
    sGeo.attributes.position.needsUpdate = true; sGeo.attributes.color.needsUpdate = true;
    for (const f of [...flashes]) {
      f.age += dt; const p = f.age / f.life;
      if (p >= 1) { f.s.removeFromParent(); flashes.splice(flashes.indexOf(f), 1); continue; }
      f.s.scale.setScalar(f.size * (0.4 + ease.outCubic(p) * 0.9)); (f.s.material as THREE.SpriteMaterial).opacity = (1 - p) ** 2;
    }
    for (const r of [...rings]) {
      r.age += dt; const p = r.age / r.life;
      if (p >= 1) { r.m.removeFromParent(); rings.splice(rings.indexOf(r), 1); continue; }
      r.m.scale.setScalar(0.1 + ease.outCubic(p) * r.size); (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - p) ** 2 * 0.7;
      r.m.quaternion.copy(engine.camera.quaternion);
    }
  });
}

export function sparks(at: THREE.Vector3, n: number, colors: string[], speed = 4, g = 6, life = 0.6, dir?: THREE.Vector3) {
  const c = colors.map(x => new THREE.Color(x));
  for (let j = 0; j < n; j++) {
    const i = sNext = (sNext + 1) % SN;
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
    if (dir) v.addScaledVector(dir, speed * 0.6);
    sPos.set([at.x, at.y, at.z], i * 3); sVel.set([v.x, v.y, v.z], i * 3);
    const col = c[j % c.length]; const k = 1.5 + Math.random() * 2;
    sBase.set([col.r * k, col.g * k, col.b * k], i * 3);
    sLife[i] = sMax[i] = life * (0.5 + Math.random() * 0.8); sG[i] = g;
  }
}
export function flash(at: THREE.Vector3, color: string, size = 1.2, life = 0.22) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color(color).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
  s.position.copy(at); engine.scene.add(s); flashes.push({ s, age: 0, life, size });
}
export function shock(at: THREE.Vector3, color: string, size = 2.2, life = 0.4) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.5, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.position.copy(at); engine.scene.add(m); rings.push({ m, age: 0, life, size });
}

/** a dome of light in front of a guarding fighter */
export function ward(color: string) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uC: { value: new THREE.Color(color) }, uA: { value: 0 }, uT: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.); vV=-mv.xyz; vN=normalMatrix*normal; gl_Position=projectionMatrix*mv; }',
    fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform vec3 uC; uniform float uA; uniform float uT;
      void main(){ float f = max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))); float hex = 0.5 + 0.5*sin(vP.y*40.0 + uT*6.0) * sin(vP.x*40.0);
        float a = uA * (pow(f, 3.0) * 0.8 + 0.03 + 0.08*hex*f); gl_FragColor = vec4(uC * a * 2.0, a); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 16, -Math.PI / 2.4, Math.PI / 1.2, 0.15, Math.PI * 0.75), mat);
  m.scale.set(0.7, 0.95, 0.5);
  return { mesh: m, mat };
}

/** a bolt of light thrown across the pit */
export async function bolt(from: THREE.Vector3, to: THREE.Vector3, color: string, ms = 260, big = false) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color(color).multiplyScalar(5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(big ? 0.75 : 0.45); engine.scene.add(s);
  const p = new THREE.Vector3();
  await engine.tween(ms, t => {
    p.lerpVectors(from, to, ease.inCubic(t)); p.y += Math.sin(t * Math.PI) * 0.35; s.position.copy(p);
    sparks(p, big ? 3 : 2, [color, '#ffffff'], 0.6, 0, 0.35);
  });
  s.removeFromParent();
}

// ---- DOM overlay: damage numbers, labels, screen flash ----
const layer = () => document.getElementById('fx')!;
const proj = new THREE.Vector3();
export function toScreen(p: THREE.Vector3) { proj.copy(p).project(engine.camera); return { x: (proj.x + 1) / 2 * innerWidth, y: (1 - proj.y) / 2 * innerHeight, behind: proj.z > 1 }; }

export function pop(at: THREE.Vector3, text: string, kind: string = 'dmg') {
  const s = toScreen(at); if (s.behind) return;
  const el = document.createElement('div'); el.className = `pop ${kind}`; el.textContent = text;
  el.style.left = `${s.x}px`; el.style.top = `${s.y}px`;
  layer().append(el); setTimeout(() => el.remove(), 1400);
}
export function screenFlash(color = '#ffffff', a = 0.7) {
  const el = document.getElementById('flash')!;
  el.style.transition = 'none'; el.style.background = color; el.style.opacity = String(a);
  void el.offsetWidth; el.style.transition = 'opacity 260ms ease-out'; el.style.opacity = '0';
}
/** a DOM element that follows a point in the world each frame */
export function pin(el: HTMLElement, at: () => THREE.Vector3) {
  layer().append(el);
  const off = engine.onReal(() => { const s = toScreen(at()); el.style.transform = `translate(${s.x}px, ${s.y}px)`; el.style.visibility = s.behind ? 'hidden' : 'visible'; });
  return () => { off(); el.remove(); };
}

// ---- the camera director ----
export type Shot = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
export const shot = (px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 32): Shot => ({ pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz), fov });

class Director {
  cur: Shot = shot(0, 2, 9, 0, 1, 0);
  private from: Shot | null = null; private to: Shot | null = null; private p = 1; private dur = 1; private curve = ease.inOut;
  trauma = 0;
  drift = 0.6;            // handheld breathing, 0 for locked off
  orbit: ((t: number) => Shot) | null = null;
  constructor() {
    engine.onReal(real => {
      this.trauma = Math.max(0, this.trauma - real * 1.6);
      if (this.to && this.from) {
        this.p = Math.min(1, this.p + real / this.dur);
        const k = this.curve(this.p);
        this.cur.pos.lerpVectors(this.from.pos, this.to.pos, k); this.cur.look.lerpVectors(this.from.look, this.to.look, k); this.cur.fov = this.from.fov + (this.to.fov - this.from.fov) * k;
        if (this.p >= 1) { this.from = null; }
      }
      if (this.orbit && !this.from) { const o = this.orbit(engine.t); this.cur.pos.copy(o.pos); this.cur.look.copy(o.look); this.cur.fov = o.fov; }
      this.apply();
    });
  }
  private apply() {
    const c = engine.camera, t = performance.now() / 1000, s = this.trauma * this.trauma;
    c.position.copy(this.cur.pos);
    c.position.x += Math.sin(t * 0.7) * 0.03 * this.drift + (Math.sin(t * 41) * 0.5 + Math.sin(t * 67) * 0.5) * 0.09 * s;
    c.position.y += Math.sin(t * 0.9 + 1) * 0.02 * this.drift + Math.sin(t * 53 + 2) * 0.07 * s;
    c.lookAt(this.cur.look);
    c.rotateZ(Math.sin(t * 47 + 4) * 0.035 * s + Math.sin(t * 0.5) * 0.004 * this.drift);
    if (Math.abs(c.fov - this.cur.fov) > 0.01) { c.fov = this.cur.fov; c.updateProjectionMatrix(); }
  }
  cut(s: Shot) { this.from = this.to = null; this.orbit = null; this.cur = { pos: s.pos.clone(), look: s.look.clone(), fov: s.fov }; this.apply(); }
  move(s: Shot, ms: number, curve = ease.inOut) {
    this.orbit = null;
    this.from = { pos: this.cur.pos.clone(), look: this.cur.look.clone(), fov: this.cur.fov };
    this.to = { pos: s.pos.clone(), look: s.look.clone(), fov: s.fov }; this.p = 0; this.dur = Math.max(0.001, ms / 1000); this.curve = curve;
  }
  shake(k: number) { this.trauma = Math.min(1, this.trauma + k); }
}
export const director = new Director();

/** how far back a camera with this fov must sit to fit `width` metres across the current screen */
export function fitDistance(width: number, fov: number) {
  const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * engine.camera.aspect);
  return (width / 2) / Math.tan(hf / 2);
}
export const portrait = () => innerHeight > innerWidth;
