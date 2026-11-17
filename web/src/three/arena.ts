// The arena: a round stone pit under one shaft of warm light, ringed by pillars, braziers and old banners, falling away into fog.
// Every surface is textured in code (stone, mortar, cloth) so nothing reads as a flat toy colour, and one light rig lights it all:
// a warm key from above, a cool rim from behind, warm fire low on the sides, and a blue hemisphere so shadows go cool, never black.
import * as THREE from 'three';
import { engine } from './engine';

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

/** tiling grain used as bump and roughness on all stone */
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

/** the pit floor: rings of flagstones round a worn bronze sigil */
function floorTexture() {
  const n = 1024, c = canvas(n), x = c.getContext('2d')!;
  const img = x.createImageData(n, n);
  const rings = [0, 0.09, 0.2, 0.33, 0.47, 0.62, 0.78, 0.95, 1.2];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / n * 2 - 1, v = j / n * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    let ri = 0; while (ri < rings.length - 2 && r > rings[ri + 1]) ri++;
    const r0 = rings[ri], r1 = rings[ri + 1];
    const segs = Math.max(1, Math.round((ri + 1) * 7));
    const sa = (a / (Math.PI * 2) + 0.5) * segs + (ri % 2) * 0.5, si = Math.floor(sa), sf = sa - si;
    const edgeR = Math.min(r - r0, r1 - r) * n / 2, edgeA = Math.min(sf, 1 - sf) * (r * Math.PI * 2 / segs) * n / 2;
    const mortar = ri === 0 ? Math.max(0, 1 - (r1 - r) * n / 2 / 3) : Math.max(0, 1 - Math.min(edgeR, edgeA) / 3);
    const tone = 0.55 + 0.45 * hash(si, ri, 11);
    const grime = nz(u * 3 + 1.3, v * 3 + 2.1);
    const wear = nz(u * 11 + 5.7, v * 11 + 3.3);
    let L = (0.16 + 0.1 * tone) * (0.65 + 0.7 * grime) * (0.85 + 0.3 * wear);
    L *= 1 - mortar * 0.75;
    // a darker stain ring where fighters stand
    L *= 1 - 0.18 * Math.exp(-(((r - 0.28) / 0.1) ** 2));
    const k = (j * n + i) * 4;
    img.data[k] = Math.min(255, L * 255 * 1.06); img.data[k + 1] = Math.min(255, L * 255 * 0.98); img.data[k + 2] = Math.min(255, L * 255 * 0.94); img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // the sigil: worn bronze inlay, broken where the stone is chipped
  x.save(); x.translate(n / 2, n / 2);
  x.strokeStyle = 'rgba(176,128,70,0.55)'; x.lineCap = 'round';
  const ring = (r: number, w: number) => { x.lineWidth = w; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); };
  ring(n * 0.185, 5); ring(n * 0.165, 2); ring(n * 0.06, 3);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2; x.lineWidth = i % 3 ? 2 : 4;
    x.beginPath(); x.moveTo(Math.cos(a) * n * 0.165, Math.sin(a) * n * 0.165); x.lineTo(Math.cos(a) * n * (i % 3 ? 0.15 : 0.13), Math.sin(a) * n * (i % 3 ? 0.15 : 0.13)); x.stroke();
  }
  for (let k = 0; k < 3; k++) { // a triangle of three, one per class
    x.lineWidth = 3; x.beginPath();
    for (let i = 0; i <= 3; i++) { const a = (i / 3 + k / 9) * Math.PI * 2 - Math.PI / 2; const p = [Math.cos(a) * n * 0.15, Math.sin(a) * n * 0.15]; if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); }
    x.stroke();
  }
  x.restore();
  // chips and scuffs across the inlay
  x.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 900; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * n * 0.5; x.fillStyle = `rgba(20,16,14,${0.2 + Math.random() * 0.5})`; x.beginPath(); x.arc(n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r, 1 + Math.random() * 4, 0, 7); x.fill(); }
  x.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** stone blocks for pillars and walls (tiles in both directions) */
function blockTexture() {
  const n = 512, c = canvas(n), x = c.getContext('2d')!, img = x.createImageData(n, n);
  const rows = 8;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const row = Math.floor(j / (n / rows)), off = row % 2 ? 0.5 : 0, bx = i / (n / 3) + off, col = Math.floor(bx);
    const ey = Math.min(j % (n / rows), n / rows - (j % (n / rows))), ex = Math.min(bx - col, col + 1 - bx) * (n / 3);
    const mortar = Math.max(0, 1 - Math.min(ey, ex) / 3);
    const tone = 0.6 + 0.4 * hash(((col % 3) + 3) % 3, row, 4);
    let L = (0.2 + 0.1 * tone) * (0.6 + 0.8 * nz(i / 64 + 2.5, j / 64 + 4.5)) * (1 - mortar * 0.7);
    // grime runs down from the joints
    L *= 1 - 0.25 * nz(i / 16 + 6.1, j / 128 + 1.7);
    const k = (j * n + i) * 4; img.data[k] = L * 255 * 1.04; img.data[k + 1] = L * 255; img.data[k + 2] = L * 255 * 0.95; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

/** a banner: deep oxblood cloth, a gold sigil, frayed hem */
function bannerTexture() {
  const w = 256, hh = 768, c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, '#3a0f12'); g.addColorStop(1, '#1e0709');
  x.fillStyle = g; x.fillRect(0, 0, w, hh);
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; x.fillRect(Math.random() * w, Math.random() * hh, 1, 3 + Math.random() * 8); }
  x.strokeStyle = '#a77a3e'; x.lineWidth = 4; x.strokeRect(14, 14, w - 28, hh - 120);
  x.save(); x.translate(w / 2, 300); x.strokeStyle = '#c49a52'; x.lineWidth = 6;
  x.beginPath(); x.arc(0, 0, 70, 0, Math.PI * 2); x.stroke();
  x.beginPath(); for (let i = 0; i <= 3; i++) { const a = i / 3 * Math.PI * 2 - Math.PI / 2; if (i) x.lineTo(Math.cos(a) * 70, Math.sin(a) * 70); else x.moveTo(Math.cos(a) * 70, Math.sin(a) * 70); } x.stroke();
  x.beginPath(); x.moveTo(0, -110); x.lineTo(0, 110); x.stroke();
  x.restore();
  // ragged hem
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w; i += 6) { const d = 30 + Math.random() * 70; x.fillRect(i, hh - d, 6, d); }
  x.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function softDot() {
  const c = canvas(64), x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
export const DOT = softDot();

// ---- fire: a camera facing card with a noise flame ----
const fireMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uT: { value: 0 }, uSeed: { value: Math.random() * 10 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `varying vec2 vUv; uniform float uT; uniform float uSeed;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    float fb(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
    void main(){
      vec2 uv = vUv; float t = uT*1.6 + uSeed;
      float q = fb(vec2(uv.x*3., uv.y*2.2 - t*1.7));
      float shape = 1. - smoothstep(0., .5 + .25*(1.-uv.y), abs(uv.x-.5)*2.2 + uv.y*0.9 - q*0.55);
      shape *= smoothstep(0., .12, uv.y) * (1. - smoothstep(.55, 1., uv.y + q*.25));
      vec3 c = mix(vec3(1.,.28,.05), vec3(1.,.78,.35), pow(shape, 1.6));
      c = mix(c, vec3(1.,.95,.8), pow(shape, 5.));
      gl_FragColor = vec4(c * shape * 1.8, shape);
    }`,
});

export type Arena = {
  key: THREE.SpotLight; rim: THREE.DirectionalLight; hemi: THREE.HemisphereLight; fires: THREE.PointLight[];
  /** 0 = normal, 1 = the world drops away for a special */
  dim(v: number): void;
  /** where the light shaft points (follows the action a little) */
  focus(x: number, z: number): void;
};

export function buildArena(): Arena {
  const S = engine.scene;
  const grain = grainTexture();
  const stoneTex = blockTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughnessMap: grain, bumpMap: grain, bumpScale: 1.6, roughness: 0.82, metalness: 0.0 });
  floorMat.roughnessMap!.repeat.set(10, 10); floorMat.bumpMap!.repeat.set(10, 10);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(13, 96), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);

  // a low step ring around the pit
  const stepMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9, bumpMap: grain, bumpScale: 1.2 });
  stepMat.map = stoneTex.clone(); stepMat.map.repeat.set(24, 1); stepMat.map.needsUpdate = true;
  const step = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 9.4, 0.36, 96, 1, true), stepMat);
  step.position.y = 0.18; step.receiveShadow = true; S.add(step);
  const stepTop = new THREE.Mesh(new THREE.RingGeometry(9.4, 13, 96, 1), new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.95, bumpMap: grain, bumpScale: 1.5 }));
  stepTop.rotation.x = -Math.PI / 2; stepTop.position.y = 0.36; stepTop.receiveShadow = true; S.add(stepTop);

  // pillars
  const pillarMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.88, bumpMap: grain, bumpScale: 1.4 });
  pillarMat.map = stoneTex.clone(); pillarMat.map.repeat.set(2, 3); pillarMat.map.needsUpdate = true;
  const shaft = new THREE.CylinderGeometry(0.5, 0.58, 10, 20, 1);
  const cap = new THREE.BoxGeometry(1.5, 0.45, 1.5);
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2 + Math.PI / N, r = 11;
    const g = new THREE.Group(); g.position.set(Math.cos(a) * r, 0.36, Math.sin(a) * r); g.rotation.y = -a;
    const s = new THREE.Mesh(shaft, pillarMat); s.position.y = 5; s.castShadow = true; s.receiveShadow = true;
    const b = new THREE.Mesh(cap, pillarMat); b.position.y = 0.22; b.receiveShadow = true;
    const t = new THREE.Mesh(cap, pillarMat); t.position.y = 7.4; t.scale.set(0.9, 1, 0.9);
    g.add(s, b, t); S.add(g);
  }
  // the outer wall, almost lost in the dark
  const wallMat = new THREE.MeshStandardMaterial({ map: stoneTex.clone(), roughness: 0.95, side: THREE.BackSide, color: '#8a8580' });
  wallMat.map!.repeat.set(16, 3); wallMat.map!.needsUpdate = true;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 16, 64, 1, true), wallMat); wall.position.y = 8; S.add(wall);

  // banners between some pillars, behind the fight
  const bTex = bannerTexture();
  const banners: { m: THREE.Mesh; base: Float32Array; ph: number }[] = [];
  for (const a of [-2.05, -1.57, -1.09, -0.6, -2.55]) {
    const geo = new THREE.PlaneGeometry(1.5, 4.6, 4, 14);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bTex, roughness: 0.95, side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 }));
    m.position.set(Math.cos(a) * 10.4, 6.2, Math.sin(a) * 10.4); m.lookAt(0, 6.2, 0); m.castShadow = false;
    S.add(m); banners.push({ m, base: Float32Array.from(geo.attributes.position.array as Float32Array), ph: a * 3 });
  }

  // braziers: iron bowls on stands with live fire, embers and a flickering light
  const iron = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.55, metalness: 0.85, bumpMap: grain, bumpScale: 2, envMap: engine.env, envMapIntensity: 0.5 });
  const bowlPts = [new THREE.Vector2(0.05, 0), new THREE.Vector2(0.45, 0.05), new THREE.Vector2(0.62, 0.32), new THREE.Vector2(0.58, 0.36), new THREE.Vector2(0.42, 0.12), new THREE.Vector2(0.05, 0.1)];
  const bowlGeo = new THREE.LatheGeometry(bowlPts, 20);
  const fires: THREE.PointLight[] = [];
  const flames: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  const ember = new THREE.BufferGeometry(); const EN = 160;
  const ePos = new Float32Array(EN * 3), eVel = new Float32Array(EN * 3), eLife = new Float32Array(EN);
  ember.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const brazierAt = [new THREE.Vector3(-4.6, 0, -3.6), new THREE.Vector3(4.6, 0, -3.6), new THREE.Vector3(-6.4, 0, 2.6), new THREE.Vector3(6.4, 0, 2.6)];
  brazierAt.forEach((p, i) => {
    const g = new THREE.Group(); g.position.copy(p);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.25, 8), iron); leg.position.y = 0.62; leg.castShadow = true;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.1, 12), iron); foot.position.y = 0.05;
    const bowl = new THREE.Mesh(bowlGeo, iron); bowl.position.y = 1.2; bowl.castShadow = true;
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.7, 0.18) }));
    coals.rotation.x = -Math.PI / 2; coals.position.y = 1.5;
    const mat = fireMat(); const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.0), mat); fl.position.y = 2.35;
    g.add(leg, foot, bowl, coals, fl); S.add(g);
    flames.push({ mesh: fl, mat });
    const L = new THREE.PointLight('#ff8a3a', 16, 11, 1.7); L.position.set(p.x, 2.3, p.z);
    if (i < 2) { S.add(L); fires.push(L); } // two lights; the front fires glow but do not light
  });
  const embers = new THREE.Points(ember, new THREE.PointsMaterial({ map: DOT, color: new THREE.Color(3, 1.2, 0.4), size: 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  S.add(embers);
  const respawn = (k: number) => {
    const b = brazierAt[k % 4]; ePos[k * 3] = b.x + (Math.random() - 0.5) * 0.6; ePos[k * 3 + 1] = 1.7; ePos[k * 3 + 2] = b.z + (Math.random() - 0.5) * 0.6;
    eVel[k * 3] = (Math.random() - 0.5) * 0.3; eVel[k * 3 + 1] = 0.6 + Math.random() * 1.2; eVel[k * 3 + 2] = (Math.random() - 0.5) * 0.3; eLife[k] = 1 + Math.random() * 2.5;
  };
  for (let k = 0; k < EN; k++) { respawn(k); eLife[k] *= Math.random(); }

  // the shaft of light from above, and dust turning in it
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uA: { value: 0.12 }, uC: { value: new THREE.Color('#ffcf94') } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv = modelViewMatrix*vec4(position,1.); vV = -mv.xyz; vN = normalMatrix*normal; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uA; uniform vec3 uC; void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float a = uA * pow(f, 2.2) * smoothstep(0.0, 0.5, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y)); gl_FragColor = vec4(uC * a, a); }',
  });
  const shaftMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.6, 13, 32, 1, true), shaftMat);
  shaftMesh.position.set(0.6, 6.5, 0.4); shaftMesh.rotation.z = -0.08; S.add(shaftMesh);
  const DN = 260, dGeo = new THREE.BufferGeometry(), dPos = new Float32Array(DN * 3), dSeed = new Float32Array(DN);
  for (let i = 0; i < DN; i++) { const a = Math.random() * 7, r = Math.sqrt(Math.random()) * 3.2; dPos[i * 3] = Math.cos(a) * r; dPos[i * 3 + 1] = Math.random() * 6; dPos[i * 3 + 2] = Math.sin(a) * r; dSeed[i] = Math.random() * 100; }
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ map: DOT, color: '#d9b98a', size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  S.add(dust);

  // ---- lights ----
  const key = new THREE.SpotLight('#ffc994', 520, 34, 0.46, 0.7, 1.4);
  key.position.set(2.4, 11, 5.5); key.target.position.set(0, 0.8, 0);
  key.castShadow = true; key.shadow.mapSize.setScalar(engine.tier >= 2 ? 2048 : engine.tier === 1 ? 1024 : 512);
  key.shadow.bias = -0.0002; key.shadow.normalBias = 0.03; key.shadow.camera.near = 4; key.shadow.camera.far = 24; key.shadow.radius = 4;
  S.add(key, key.target);
  const rim = new THREE.DirectionalLight('#86a2ff', 2.2); rim.position.set(-4, 5, -8); S.add(rim);
  const rim2 = new THREE.DirectionalLight('#ffb070', 0.5); rim2.position.set(6, 3, -6); S.add(rim2);
  const hemi = new THREE.HemisphereLight('#56648f', '#24180e', 0.9); S.add(hemi);

  let dimV = 0, dimTarget = 0;
  const base = { key: key.intensity, rim: rim.intensity, hemi: hemi.intensity, fire: 16, shaft: 0.12 };
  engine.onTick((dt, t) => {
    // fire flicker, two incommensurate sines and a little noise
    fires.forEach((L, i) => { L.intensity = base.fire * (1 - dimV * 0.8) * (0.82 + 0.12 * Math.sin(t * 11 + i * 2) + 0.08 * Math.sin(t * 23.7 + i) + 0.05 * Math.random()); });
    flames.forEach(f => { f.mat.uniforms.uT.value = t; f.mesh.quaternion.copy(engine.camera.quaternion); });
    for (let k = 0; k < EN; k++) {
      eLife[k] -= dt; if (eLife[k] <= 0) { respawn(k); continue; }
      ePos[k * 3] += (eVel[k * 3] + Math.sin(t * 2 + k) * 0.2) * dt; ePos[k * 3 + 1] += eVel[k * 3 + 1] * dt; ePos[k * 3 + 2] += eVel[k * 3 + 2] * dt;
    }
    ember.attributes.position.needsUpdate = true;
    for (let i = 0; i < DN; i++) {
      dPos[i * 3 + 1] += Math.sin(t * 0.3 + dSeed[i]) * 0.0015 + 0.0006; if (dPos[i * 3 + 1] > 6) dPos[i * 3 + 1] = 0;
      dPos[i * 3] += Math.cos(t * 0.2 + dSeed[i]) * 0.001;
    }
    dGeo.attributes.position.needsUpdate = true;
    for (const b of banners) {
      const p = b.m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const y = b.base[i * 3 + 1], hang = (2.3 - y) / 4.6; p.setZ(i, Math.sin(t * 1.1 + b.ph + y * 0.9) * 0.12 * hang * hang); }
      p.needsUpdate = true; b.m.geometry.computeVertexNormals();
    }
    dimV += (dimTarget - dimV) * (1 - Math.exp(-dt * 9));
    key.intensity = base.key * (1 - dimV * 0.55); rim.intensity = base.rim * (1 + dimV * 0.4); hemi.intensity = base.hemi * (1 - dimV * 0.7);
    shaftMat.uniforms.uA.value = base.shaft * (1 - dimV * 0.6);
  });

  return {
    key, rim, hemi, fires,
    dim(v) { dimTarget = v; },
    focus(x, z) { key.target.position.set(x, 0.8, z); },
  };
}
