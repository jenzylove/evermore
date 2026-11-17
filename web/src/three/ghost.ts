// The ghosts: every opponent is the echo of a real player's hero. A body of light (see the fighter shader), soft trails
// that follow its hands and body when it moves, its name and its keeper's written in light on the floor beneath it,
// and on defeat it shatters into fragments of light that drift up into the hall.
import * as THREE from 'three';
import { engine, ease } from './engine';
import { DOT } from './arena';
import { flash, shock, sparks } from './fx';
import { runeDisc, runeMaterial } from './runes';
import type { Fighter } from './fighter';
import { world } from './world';

export const GHOST_LIGHT = '#bfe3ff';
const SHARD_GOLD = '#ffe9bf';

// ---- trails: a camera facing ribbon behind a moving point ----
const TN = 22;
class Trail {
  pts: THREE.Vector3[] = [];
  geo = new THREE.BufferGeometry();
  mesh: THREE.Mesh;
  private pos = new Float32Array(TN * 2 * 3);
  private al = new Float32Array(TN * 2);
  constructor(private src: () => THREE.Vector3, private width: number, color: string, private strength: number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('a', new THREE.BufferAttribute(this.al, 1));
    const idx: number[] = [];
    for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uC: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC * vA, vA); }',
    }));
    this.mesh.frustumCulled = false;
  }
  update(visible: boolean) {
    const p = this.src().clone();
    this.pts.unshift(p); if (this.pts.length > TN) this.pts.pop();
    const cam = engine.camera.position, side = new THREE.Vector3(), tan = new THREE.Vector3(), view = new THREE.Vector3();
    for (let i = 0; i < TN; i++) {
      const a = this.pts[Math.min(i, this.pts.length - 1)], b = this.pts[Math.min(i + 1, this.pts.length - 1)];
      tan.subVectors(a, b); const speed = tan.length() * 60; // metres per second, roughly
      view.subVectors(cam, a).normalize();
      side.crossVectors(tan.lengthSq() > 1e-8 ? tan.normalize() : new THREE.Vector3(0, 1, 0), view).normalize();
      const f = 1 - i / (TN - 1), w = this.width * f;
      this.pos.set([a.x + side.x * w, a.y + side.y * w, a.z + side.z * w, a.x - side.x * w, a.y - side.y * w, a.z - side.z * w], i * 6);
      const k = visible ? Math.min(1, Math.max(0, speed - 0.6) / 3) * f * f * this.strength : 0;
      this.al[i * 2] = this.al[i * 2 + 1] = k;
    }
    this.geo.attributes.position.needsUpdate = true; (this.geo.attributes.a as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** the name of a ghost and its keeper, written round a circle of runes on the floor */
export function nameRing(name: string, owner: string | undefined, color = GHOST_LIGHT, size = 2.3) {
  const text = owner ? `${name.toUpperCase()}  ·  KEPT BY ${owner.toUpperCase()}` : name.toUpperCase();
  const tex = runeDisc({ count: 20, seed: name.length * 7 + name.charCodeAt(0), r0: 0.5, r1: 0.62, lines: [0.48, 0.64, 0.92], text, textR: 0.79, size: 1024 });
  const mat = runeMaterial(tex, color, 20); mat.uniforms.uK.value = 0.9;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2;
  return { mesh: m, mat };
}

/** the hero's name floating above it in light, kept small and faint */
export function nameLabel(name: string, owner?: string, color = GHOST_LIGHT) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d')!;
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  x.shadowColor = '#fff'; x.shadowBlur = 18;
  x.font = '700 96px Cinzel, Georgia, serif';
  (x as unknown as { letterSpacing: string }).letterSpacing = '8px';
  x.fillText(name, 512, owner ? 96 : 128);
  if (owner) { x.font = '600 44px "Barlow Condensed", sans-serif'; (x as unknown as { letterSpacing: string }).letterSpacing = '10px'; x.shadowBlur = 10; x.globalAlpha = 0.8; x.fillText(`KEPT BY ${owner.toUpperCase()}`, 512, 192); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(color).multiplyScalar(1.1), transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  return m;
}

export type GhostFx = { ring: THREE.Mesh | null; label: THREE.Mesh | null; setFocus(k: number): void; shatter(): Promise<void> };

/** dress a fighter as a ghost: trails, its name in light, and the means to shatter it */
export function haunt(f: Fighter, o: { name: string; owner?: string; ring?: boolean; label?: boolean; color?: string; lift?: number }): GhostFx {
  const color = o.color ?? GHOST_LIGHT;
  f.rimColor(color);
  const bone = (n: string) => f.model.getObjectByName(`mixamorig${n}`);
  const wp = (n: string) => { const b = bone(n); const v = new THREE.Vector3(); return () => (b ? b.getWorldPosition(v) : v.copy(f.root.position)); };
  const trails = [new Trail(wp('RightHand'), 0.05, color, 0.55), new Trail(wp('LeftHand'), 0.05, color, 0.55), new Trail(wp('Spine1'), 0.3, color, 0.16), new Trail(wp('Head'), 0.1, color, 0.2)];
  trails.forEach(t => world.extra(t.mesh));
  let ring: THREE.Mesh | null = null, ringMat: THREE.ShaderMaterial | null = null, label: THREE.Mesh | null = null;
  if (o.ring !== false) {
    const r = nameRing(o.name, o.owner, color); ring = r.mesh; ringMat = r.mat;
    world.extra(ring);
  }
  if (o.label) label = world.extra(nameLabel(o.name, o.owner, color));
  let focus = 1, alive = true;
  world.tick((_dt, t) => {
    const vis = f.root.visible && alive;
    trails.forEach(tr => tr.update(vis));
    if (ring && ringMat) {
      ring.visible = vis; ring.position.set(f.root.position.x, 0.012 + (o.lift ?? 0), f.root.position.z);
      ring.rotation.z = t * 0.05; ringMat.uniforms.uT.value = t; ringMat.uniforms.uK.value = 0.35 + focus * 0.55;
    }
    if (label) {
      label.visible = vis;
      const head = f.root.position.clone().setY(f.root.position.y + 2.12 + Math.sin(t * 1.3) * 0.03);
      label.position.copy(head); label.quaternion.copy(engine.camera.quaternion);
      (label.material as THREE.MeshBasicMaterial).opacity = 0.25 + focus * 0.55;
    }
  });
  return {
    ring, label,
    setFocus(k) { focus = k; },
    async shatter() {
      alive = false;
      await shatter(f, color);
    },
  };
}

// ---- the shatter ----
const SHN = 260;
let shardGeo: THREE.BufferGeometry | null = null;
function shardGeometry() {
  if (shardGeo) return shardGeo;
  const g = new THREE.BufferGeometry();
  // a thin sliver of light, longer than it is wide
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.06, 0, -0.022, -0.02, 0.004, 0.026, -0.03, -0.004, 0, 0.06, 0, 0.026, -0.03, -0.004, 0.004, -0.05, 0.0], 3));
  g.computeVertexNormals();
  shardGeo = g; return g;
}

async function shatter(f: Fighter, color: string) {
  const bones: THREE.Object3D[] = [];
  f.model.traverse(o => { if ((o as THREE.Bone).isBone && !/End|Toe|Index|Middle|Ring|Pinky|Thumb/.test(o.name)) bones.push(o); });
  const col = new THREE.Color(color), gold = new THREE.Color(SHARD_GOLD), white = new THREE.Color('#ffffff');
  const mesh = new THREE.InstancedMesh(shardGeometry(), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), SHN);
  mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  world.extra(mesh);
  const P = new Float32Array(SHN * 3), V = new Float32Array(SHN * 3), R = new Float32Array(SHN * 3), W = new Float32Array(SHN * 3), L = new Float32Array(SHN), M = new Float32Array(SHN), Sz = new Float32Array(SHN), C: THREE.Color[] = [];
  const centre = f.point('chest');
  const v = new THREE.Vector3();
  const spawn = (i: number) => {
    const b = bones[Math.floor(Math.random() * bones.length)];
    b.getWorldPosition(v); v.x += (Math.random() - 0.5) * 0.16; v.y += (Math.random() - 0.5) * 0.16; v.z += (Math.random() - 0.5) * 0.16;
    P.set([v.x, v.y, v.z], i * 3);
    const out = v.clone().sub(centre); out.y *= 0.3; out.normalize();
    const sp = 0.6 + Math.random() * 1.8;
    V.set([out.x * sp + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 1.2, out.z * sp + (Math.random() - 0.5) * 0.6], i * 3);
    R.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    W.set([(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9], i * 3);
    L[i] = M[i] = 1.8 + Math.random() * 1.8; Sz[i] = 0.6 + Math.random() * 1.4;
    C[i] = (Math.random() < 0.3 ? gold : Math.random() < 0.3 ? white : col).clone();
  };
  for (let i = 0; i < SHN; i++) L[i] = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), c3 = new THREE.Color();
  for (let i = 0; i < SHN; i++) mesh.setColorAt(i, new THREE.Color(0, 0, 0));
  let next = 0, done = false;
  world.tick((dt, t) => {
    if (done) return;
    for (let i = 0; i < SHN; i++) {
      if (L[i] <= 0) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); continue; }
      L[i] -= dt;
      const k = i * 3, drag = Math.exp(-dt * 1.6);
      V[k] *= drag; V[k + 2] *= drag; V[k + 1] = V[k + 1] * Math.exp(-dt * 0.9) + dt * 0.55; // buoyant: light rises
      V[k] += Math.sin(t * 1.3 + i) * dt * 0.2; V[k + 2] += Math.cos(t * 1.1 + i * 1.7) * dt * 0.2;
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      R[k] += W[k] * dt; R[k + 1] += W[k + 1] * dt; R[k + 2] += W[k + 2] * dt;
      W[k] *= Math.exp(-dt * 0.8); W[k + 1] *= Math.exp(-dt * 0.8); W[k + 2] *= Math.exp(-dt * 0.8);
      const life = L[i] / M[i], a = Math.min(1, (1 - life) * 8) * life ** 1.4;
      q.setFromEuler(e.set(R[k], R[k + 1], R[k + 2])); s3.setScalar(Sz[i] * 0.7 * (0.6 + 0.4 * life)); p3.set(P[k], P[k + 1], P[k + 2]);
      m4.compose(p3, q, s3); mesh.setMatrixAt(i, m4);
      c3.copy(C[i]).multiplyScalar(a * 3.2 * (0.75 + 0.25 * Math.sin(t * 9 + i))); mesh.setColorAt(i, c3);
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  const burst = (n: number) => { for (let j = 0; j < n && next < SHN; j++) spawn(next++); };
  // the crack: a held breath of white light running through the body
  f.flash(1.4); f.ghostGlow(1);
  f.dissolve(0.02);
  flash(centre, '#ffffff', 0.9, 0.2);
  await engine.wait(110);
  // the break: the body comes apart along its cracks and the pieces lift away
  shock(f.root.position.clone().setY(0.04), color, 3.2, 0.7);
  flash(centre, color, 1.5, 0.4);
  burst(150);
  sparks(centre, 50, [color, '#ffffff', SHARD_GOLD], 2.2, -1.2, 2.2);
  const hide = f.pieces;
  await engine.tween(900, p => {
    const k = ease.outCubic(p);
    f.dissolve(0.02 + k * 1.0);
    if (Math.random() < 0.5) burst(4);
    hide.forEach(o => o.traverse(c => { const m = (c as THREE.Mesh).material as THREE.Material | undefined; if (m) { m.transparent = true; m.opacity = Math.min(m.opacity, 1 - k); } }));
    for (let j = 0; j < 2; j++) { const b = bones[Math.floor(Math.random() * bones.length)]; sparks(b.getWorldPosition(new THREE.Vector3()), 1, [color, '#ffffff'], 0.4, -1.5, 2); }
  });
  f.root.visible = false;
  // what is left: a soft column of light where it stood, fading
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.copy(f.root.position).setY(1); glow.scale.set(1.2, 3.2, 1); world.extra(glow);
  engine.tween(1600, p => { (glow.material as THREE.SpriteMaterial).opacity = (1 - p) ** 2; glow.scale.set(1.2 * (1 - p * 0.6), 3.2 + p * 1.5, 1); glow.position.y = 1 + p * 0.6; }).then(() => glow.removeFromParent());
  engine.wait(4200).then(() => { done = true; mesh.visible = false; });
}

/** objects that use every ghost material, for the loading veil to compile up front */
export function ghostWarmup(): THREE.Object3D[] {
  const t = new Trail(() => new THREE.Vector3(), 0.1, GHOST_LIGHT, 1);
  const r = nameRing('Warm', 'up');
  const m = new THREE.InstancedMesh(shardGeometry(), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 2);
  m.setColorAt(0, new THREE.Color(1, 1, 1));
  return [t.mesh, r.mesh, nameLabel('Warm', 'up'), m];
}
