// The Hall of Evermore: a round marble hall under moonlight, where heroes that never die are remembered.
// Pale columns and arches ring a floor written with faint runes; beyond them colossal statues of past champions stand
// in the blue night. Shafts of moonlight fall through, motes drift in them. Every texture is made in code.
// The light rig: a cold moon key from above, a pale gold rim from behind, a deep blue hemisphere so nothing goes black.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { engine } from './engine';
import { runeDisc, runeMaterial } from './runes';

// ---- small noise kit for canvas textures ----
const hash = (x: number, y: number, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, s = 0, wrap = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = (v: number) => (wrap ? ((v % wrap) + wrap) % wrap : v);
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 4, s = 0, wrap = 0) { let f = 0, a = 0.5, k = 1; for (let i = 0; i < oct; i++) { f += a * vnoise(x * k, y * k, s + i, wrap ? wrap * k : 0); k *= 2; a *= 0.5; } return f; }
/** one tileable fbm field, sampled bilinearly: 1 unit = 32 cells, repeats every 8 units */
let GRID: Float32Array | null = null;
function nz(x: number, y: number) {
  if (!GRID) { GRID = new Float32Array(256 * 256); for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) GRID[j * 256 + i] = fbm(i / 32, j / 32, 5, 7, 8); }
  const fx = x * 32, fy = y * 32, xi = Math.floor(fx), yi = Math.floor(fy), tx = fx - xi, ty = fy - yi;
  const g = (a: number, b: number) => GRID![((b & 255) << 8) | (a & 255)];
  const a0 = g(xi, yi), a1 = g(xi + 1, yi), b0 = g(xi, yi + 1), b1 = g(xi + 1, yi + 1);
  return a0 + (a1 - a0) * tx + (b0 - a0) * ty + (a0 - a1 - b0 + b1) * tx * ty;
}
function canvas(n: number) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }

/** tiling grain used as bump and roughness on stone */
function grainTexture() {
  const n = 256, c = canvas(n), x = c.getContext('2d')!, img = x.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = nz(i / 32, j / 32) * 0.75 + hash(i, j, 3) * 0.25;
    const k = (j * n + i) * 4; const g = Math.round(v * 255);
    img.data[k] = img.data[k + 1] = img.data[k + 2] = g; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** marble: cool pale stone with soft veins */
const marble = (u: number, v: number, s: number) => {
  const warp = nz(u * 0.7 + s, v * 0.7 + s * 1.3) * 5;
  const vein = Math.pow(Math.abs(Math.sin((u * 1.4 + v * 0.6) * 3 + warp * 2.2)), 0.18);
  const fine = Math.pow(Math.abs(Math.sin((u * 0.5 - v * 1.6) * 7 + warp * 3.1)), 0.35);
  return 0.78 + 0.22 * vein * fine - 0.08 * nz(u * 3 + 2, v * 3 + 5);
};

/** the hall floor: rings of marble slabs with pale gold seams, round a quiet centre stone */
function floorTexture() {
  const n = 1024, c = canvas(n), x = c.getContext('2d')!;
  const img = x.createImageData(n, n);
  const rings = [0, 0.16, 0.3, 0.46, 0.62, 0.8, 0.96, 1.3];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / n * 2 - 1, v = j / n * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    let ri = 0; while (ri < rings.length - 2 && r > rings[ri + 1]) ri++;
    const r0 = rings[ri], r1 = rings[ri + 1];
    const segs = ri === 0 ? 1 : Math.round(ri * 9);
    const sa = (a / (Math.PI * 2) + 0.5) * segs + (ri % 2) * 0.5, si = Math.floor(sa), sf = sa - si;
    const edgeR = Math.min(r - r0, r1 - r) * n / 2, edgeA = ri === 0 ? 99 : Math.min(sf, 1 - sf) * (r * Math.PI * 2 / segs) * n / 2;
    const seam = Math.max(0, 1 - Math.min(ri === 0 ? (r1 - r) * n / 2 : edgeR, edgeA) / 1.6);
    const tone = 0.9 + 0.1 * hash(si, ri, 11);
    const m = marble(u * 4 + si * 0.37, v * 4 + ri * 1.7, si + ri * 7);
    let L = 0.2 * tone * m;
    L *= 0.92 + 0.08 * nz(u * 9 + 5.7, v * 9 + 3.3);
    const k = (j * n + i) * 4;
    // seams are a thread of pale gold inlay with a dark hairline either side
    const R = L * 0.93 * (1 - seam * 0.4) + seam * 0.92 * (seam > 0.6 ? 1 : 0), G = L * 1.0 * (1 - seam * 0.4) + seam * 0.7 * (seam > 0.6 ? 1 : 0), B = L * 1.12 * (1 - seam * 0.4) + seam * 0.3 * (seam > 0.6 ? 1 : 0);
    img.data[k] = Math.min(255, R * 255); img.data[k + 1] = Math.min(255, G * 255); img.data[k + 2] = Math.min(255, B * 255); img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** fluted column marble (tiles round and up) */
function columnTexture() {
  const n = 512, c = canvas(n), x = c.getContext('2d')!, img = x.createImageData(n, n);
  const flutes = 16;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const f = (i / n) * flutes, ff = f - Math.floor(f);
    const groove = 0.72 + 0.28 * Math.sin(ff * Math.PI);
    const m = marble(i / 64, j / 128, 3);
    const L = 0.42 * m * groove;
    const k = (j * n + i) * 4; img.data[k] = L * 255 * 0.97; img.data[k + 1] = L * 255; img.data[k + 2] = L * 255 * 1.06; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

function softDot() {
  const c = canvas(64), x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
export const DOT = softDot();

/**
 * The stone's textures are made in code (floorTexture and friends) but baked to WebP once (scripts/bake-textures.ts),
 * so a phone downloads 200 KB instead of spending seconds of main thread on a million pixels of noise.
 * If a baked file is missing the texture is made in code as before.
 */
const texLoader = new THREE.TextureLoader();
function baked(name: string, make: () => THREE.Texture) {
  const t = texLoader.load(`/tex/${name}.webp`, undefined, undefined, () => { t.image = make().image; t.needsUpdate = true; });
  return t;
}
/** the canvases behind the baked textures (dev only, used by the bake script) */
export const bakeCanvases = () => ({ floor: floorTexture().image as HTMLCanvasElement, column: columnTexture().image as HTMLCanvasElement, grain: grainTexture().image as HTMLCanvasElement });

/** a shaft of light: a soft open cone, bright at its core, fading top and bottom */
export const shaftMaterial = (color: string, a: number) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uA: { value: a }, uC: { value: new THREE.Color(color) }, uT: { value: 0 } },
  vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv = modelViewMatrix*vec4(position,1.); vV = -mv.xyz; vN = normalMatrix*normal; gl_Position = projectionMatrix*mv; }',
  fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uA, uT; uniform vec3 uC;
    void main(){ float f = abs(dot(normalize(vN), normalize(vV)));
      float streak = 0.75 + 0.25 * sin(vUv.x * 60.0 + sin(vUv.x * 23.0) * 3.0 + uT * 0.3);
      float a = uA * pow(f, 2.4) * streak * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
      gl_FragColor = vec4(uC * a, a); }`,
});

export type Arena = {
  key: THREE.SpotLight; rim: THREE.DirectionalLight; hemi: THREE.HemisphereLight;
  /** 0 = normal, 1 = the hall drops away for a special */
  dim(v: number): void;
  /** where the moon's key light points (follows the action a little) */
  focus(x: number, z: number): void;
  /** raise the colossal statues of past champions (needs the fighter kits) */
  statues(kits: { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip> }[]): void;
};

const MOON = '#b8d2ff', GOLD = '#ffc874', CYAN = '#6fe6ff';

export function buildArena(): Arena {
  const S = engine.scene;
  const grain = baked('grain', grainTexture); grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  const floorTex = baked('floor', floorTexture); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.anisotropy = 8;

  // ---- floor: a wide marble hall, polished enough to catch the moon ----
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, color: '#c4cfee', roughnessMap: grain, bumpMap: grain, bumpScale: 0.35, roughness: 0.3, metalness: 0.0, envMap: engine.env, envMapIntensity: 0.3 });
  floorMat.roughnessMap!.repeat.set(10, 10); floorMat.bumpMap!.repeat.set(10, 10);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(13, 128), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
  // the outer court, where the statues stand: darker, plainer stone
  const court = new THREE.Mesh(new THREE.RingGeometry(12.98, 70, 96, 1), new THREE.MeshStandardMaterial({ color: '#283458', roughness: 0.9, bumpMap: grain, bumpScale: 0.8 }));
  court.rotation.x = -Math.PI / 2; court.position.y = -0.005; court.receiveShadow = true; S.add(court);

  // ---- runes written in the floor: a wide outer band and the duel circle ----
  const ringTex = runeDisc({ count: 48, seed: 3, r0: 0.86, r1: 0.94, lines: [0.84, 0.96, 0.985, 0.42, 0.44] });
  const ringMat = runeMaterial(ringTex, GOLD, 48); ringMat.uniforms.uK.value = 0.85; ringMat.uniforms.uBase.value = 0.4;
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(19, 19), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.006; S.add(ring);
  const innerTex = runeDisc({ count: 24, seed: 11, r0: 0.78, r1: 0.92, lines: [0.76, 0.94] });
  const innerMat = runeMaterial(innerTex, CYAN, 24); innerMat.uniforms.uK.value = 1.0; innerMat.uniforms.uBase.value = 0.45;
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.4), innerMat);
  inner.rotation.x = -Math.PI / 2; inner.position.y = 0.008; S.add(inner);

  // ---- the colonnade: twelve fluted columns joined by arches ----
  const colTex = baked('column', columnTexture); colTex.colorSpace = THREE.SRGBColorSpace; colTex.wrapS = colTex.wrapT = THREE.RepeatWrapping; colTex.anisotropy = 4;
  const colMat = new THREE.MeshStandardMaterial({ map: colTex, roughness: 0.55, bumpMap: grain, bumpScale: 0.4 });
  colMat.map!.repeat.set(1, 3);
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#8d93a0', roughness: 0.7, bumpMap: grain, bumpScale: 0.6 });
  const N = 12, CR = 11.2, CH = 8.6;
  const shaft = new THREE.CylinderGeometry(0.42, 0.48, CH, 32, 1);
  const base = new THREE.CylinderGeometry(0.66, 0.72, 0.36, 32);
  const capital = new THREE.CylinderGeometry(0.7, 0.46, 0.5, 32);
  const abacus = new THREE.BoxGeometry(1.5, 0.22, 1.5);
  const chord = 2 * CR * Math.sin(Math.PI / N);
  const archGeo = new THREE.TorusGeometry(chord / 2, 0.22, 10, 40, Math.PI);
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2 + Math.PI / N;
    const g = new THREE.Group(); g.position.set(Math.cos(a) * CR, 0, Math.sin(a) * CR);
    const s = new THREE.Mesh(shaft, colMat); s.position.y = 0.36 + CH / 2; s.castShadow = true; s.receiveShadow = true;
    const b = new THREE.Mesh(base, stoneMat); b.position.y = 0.18; b.receiveShadow = true;
    const c = new THREE.Mesh(capital, stoneMat); c.position.y = 0.36 + CH + 0.25;
    const ab = new THREE.Mesh(abacus, stoneMat); ab.position.y = 0.36 + CH + 0.6; ab.rotation.y = -a;
    g.add(s, b, c, ab); S.add(g);
    // the arch to the next column
    const a2 = a + Math.PI / N;
    const arch = new THREE.Mesh(archGeo, stoneMat);
    arch.position.set(Math.cos(a2) * CR * Math.cos(Math.PI / N), 0.36 + CH + 0.7, Math.sin(a2) * CR * Math.cos(Math.PI / N));
    arch.rotation.y = -a2 + Math.PI / 2; S.add(arch);
  }
  // a ring beam above the arches
  const beam = new THREE.Mesh(new THREE.TorusGeometry(CR, 0.35, 10, 96), stoneMat);
  beam.rotation.x = Math.PI / 2; beam.position.y = 0.36 + CH + 0.7 + chord / 2 + 0.2; S.add(beam);

  // ---- moonlight: one wide shaft over the centre and slanting shafts between the columns ----
  const shafts: THREE.ShaderMaterial[] = [];
  const addShaft = (x: number, z: number, r0: number, r1: number, len: number, tiltX: number, tiltZ: number, a: number, col = MOON) => {
    const m = shaftMaterial(col, a); shafts.push(m);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 40, 1, true), m);
    mesh.position.set(x, len / 2 - 0.2, z); mesh.rotation.set(tiltX, 0, tiltZ); S.add(mesh);
    return mesh;
  };
  addShaft(0.6, -0.4, 1.8, 3.4, 16, 0.05, -0.12, 0.12);
  [[-6.5, -6.2, 0.18], [6.8, -5.6, -0.2], [-8.4, 2.6, 0.24], [8.2, 3.4, -0.22]].forEach(([x, z, t], i) => addShaft(x, z, 0.6, 1.3, 15, 0.12 * (i % 2 ? 1 : -1), t, 0.085, i % 2 ? '#8fdcff' : MOON));
  // pools of moonlight on the floor where the shafts land
  const pool = (x: number, z: number, s: number, a: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: DOT, color: new THREE.Color(MOON).multiplyScalar(a), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); S.add(m);
  };
  pool(0, 0, 9, 0.17);

  // ---- motes drifting through the hall: pale gold and moon blue, twinkling ----
  const DN = 520, dGeo = new THREE.BufferGeometry(), dPos = new Float32Array(DN * 3), dCol = new Float32Array(DN * 3), dSeed = new Float32Array(DN), dBase = new Float32Array(DN * 3);
  const gold = new THREE.Color(GOLD), moon = new THREE.Color(MOON), cyan = new THREE.Color(CYAN);
  for (let i = 0; i < DN; i++) {
    const a = Math.random() * 7, r = Math.sqrt(Math.random()) * 10.5;
    dPos[i * 3] = Math.cos(a) * r; dPos[i * 3 + 1] = Math.random() * 8; dPos[i * 3 + 2] = Math.sin(a) * r; dSeed[i] = Math.random() * 100;
    const u = Math.random(), c = u < 0.42 ? gold : u < 0.72 ? cyan : moon; const k = 0.9 + Math.random() * 1.6;
    dBase.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ map: DOT, vertexColors: true, size: 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false; S.add(dust);

  // ---- a moon, low behind the hall, with a halo ----
  const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color('#dfe8ff').multiplyScalar(1.6), fog: false, depthWrite: false, transparent: true }));
  moonDisc.scale.setScalar(9); moonDisc.position.set(-14, 24, -46); S.add(moonDisc);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color('#4f86ff').multiplyScalar(0.75), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(40); halo.position.copy(moonDisc.position).add(new THREE.Vector3(0, 0, -1)); S.add(halo);

  // ---- lights ----
  const key = new THREE.SpotLight(MOON, 640, 36, 0.5, 0.75, 1.4);
  key.position.set(-2.6, 12, 5.2); key.target.position.set(0, 0.8, 0);
  key.castShadow = true; key.shadow.mapSize.setScalar(engine.tier >= 2 ? 2048 : engine.tier === 1 ? 1024 : 512);
  key.shadow.bias = -0.0002; key.shadow.normalBias = 0.03; key.shadow.camera.near = 4; key.shadow.camera.far = 26; key.shadow.radius = 4;
  S.add(key, key.target);
  const rim = new THREE.DirectionalLight(GOLD, 2.6); rim.position.set(4, 5, -8); S.add(rim);
  const rim2 = new THREE.DirectionalLight('#4fb4ff', 1.5); rim2.position.set(-6, 3, -6); S.add(rim2);
  const hemi = new THREE.HemisphereLight('#6f92f0', '#1b2448', 1.2); S.add(hemi);
  // the statues catch a cold wash so they read in the fog
  const wash = new THREE.DirectionalLight('#a8c4ff', 2.8); wash.position.set(0, 10, 12); wash.target.position.set(0, 4, -24); S.add(wash, wash.target);

  let dimV = 0, dimTarget = 0;
  const base0 = { key: key.intensity, rim: rim.intensity, hemi: hemi.intensity, shaft: shafts.map(m => m.uniforms.uA.value as number) };
  engine.onTick((dt, t) => {
    for (let i = 0; i < DN; i++) {
      const s = dSeed[i];
      dPos[i * 3 + 1] += (0.05 + (s % 1) * 0.08) * dt; if (dPos[i * 3 + 1] > 8) dPos[i * 3 + 1] = 0;
      dPos[i * 3] += Math.cos(t * 0.21 + s) * 0.06 * dt; dPos[i * 3 + 2] += Math.sin(t * 0.17 + s * 1.3) * 0.06 * dt;
      const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * (0.6 + (s % 0.7)) + s)) ** 3;
      const fade = Math.min(1, dPos[i * 3 + 1] * 1.5) * Math.min(1, (8 - dPos[i * 3 + 1]) * 0.5);
      const k = tw * fade * (1 - dimV * 0.5);
      dCol[i * 3] = dBase[i * 3] * k; dCol[i * 3 + 1] = dBase[i * 3 + 1] * k; dCol[i * 3 + 2] = dBase[i * 3 + 2] * k;
    }
    dGeo.attributes.position.needsUpdate = true; dGeo.attributes.color.needsUpdate = true;
    ringMat.uniforms.uT.value = t; innerMat.uniforms.uT.value = t;
    inner.rotation.z = t * 0.02; ring.rotation.z = -t * 0.006;
    dimV += (dimTarget - dimV) * (1 - Math.exp(-dt * 9));
    key.intensity = base0.key * (1 - dimV * 0.55); rim.intensity = base0.rim * (1 + dimV * 0.4); hemi.intensity = base0.hemi * (1 - dimV * 0.6);
    shafts.forEach((m, i) => { m.uniforms.uA.value = base0.shaft[i] * (1 - dimV * 0.6); m.uniforms.uT.value = t; });
    innerMat.uniforms.uK.value = 1.0 + dimV * 0.4;
  });

  let raised = false;
  return {
    key, rim, hemi,
    dim(v) { dimTarget = v; },
    focus(x, z) { key.target.position.set(x, 0.8, z); },
    statues(kits) {
      if (raised) return; raised = true;
      // past champions, carved twelve times life size, each frozen in its moment
      const stone = new THREE.MeshStandardMaterial({ color: '#c8d2e6', emissive: '#203a78', roughness: 0.75, metalness: 0, bumpMap: grain, bumpScale: 1.2 });
      const plinthMat = new THREE.MeshStandardMaterial({ color: '#6a7182', roughness: 0.85, bumpMap: grain, bumpScale: 1 });
      const spots: [number, number, string, number][] = [[-Math.PI / 2 - 0.62, 1, 'taunt', 0.5], [-Math.PI / 2 + 0.62, 2, 'victory', 1.4],
        [-Math.PI / 2 + 1.5, 0, 'taunt', 1.0], [-Math.PI / 2 - 1.5, 1, 'victory', 1.1], [Math.PI / 2 - 0.5, 2, 'taunt', 0.8], [Math.PI / 2 + 0.5, 0, 'victory', 1.6]];
      for (const [a, cls, clipName, at] of spots) {
        const kit = kits[cls]; if (!kit) continue;
        const m = SkeletonUtils.clone(kit.scene);
        m.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.material = stone; mm.castShadow = false; mm.receiveShadow = false; mm.frustumCulled = false; } });
        const clip = kit.clips.get(clipName);
        if (clip) { const mx = new THREE.AnimationMixer(m); mx.clipAction(clip).play(); mx.update(at); }
        const r = 25, g = new THREE.Group();
        g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.rotation.y = Math.atan2(-g.position.x, -g.position.z);
        const pl = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 2.2, 32), plinthMat); pl.position.y = 1.1;
        m.scale.setScalar(cls === 2 ? 5.6 : 6.6); m.position.y = 2.2;
        g.add(pl, m); S.add(g);
      }
    },
  };
}
