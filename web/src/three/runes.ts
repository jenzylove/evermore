// The hall's own script: every glyph is a stem with one to three branches on a small lattice, made from a seed.
// It is used everywhere light is written: the floor rings, the ghosts' plinths, the forge and the duel's round pips.
import * as THREE from 'three';

type Seg = [number, number, number, number];
const cache = new Map<number, Seg[]>();
const rnd = (i: number, k: number) => { let h = (i * 2654435761 + k * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };

/** line segments of glyph i in a 1 wide by 1 tall box, (0,0) top left */
export function glyph(i: number): Seg[] {
  let g = cache.get(i);
  if (g) return g;
  g = [[0.5, 0, 0.5, 1]];
  const n = 1 + Math.floor(rnd(i, 1) * 3);
  const ys = [0, 1 / 3, 2 / 3, 1];
  for (let k = 0; k < n; k++) {
    const y0 = ys[Math.floor(rnd(i, 10 + k) * 3)], side = rnd(i, 20 + k) < 0.5 ? 0.08 : 0.92;
    const dy = rnd(i, 30 + k) < 0.5 ? 1 / 3 : -1 / 3;
    const y1 = Math.max(0, Math.min(1, y0 + dy));
    g.push([0.5, y0, side, y1 === y0 ? y0 + 1 / 3 : y1]);
    if (rnd(i, 40 + k) < 0.25) g.push([side, y1 === y0 ? y0 + 1 / 3 : y1, 0.5, Math.min(1, (y1 === y0 ? y0 + 1 / 3 : y1) + 1 / 3)]);
  }
  cache.set(i, g);
  return g;
}

export function drawGlyph(x: CanvasRenderingContext2D, i: number, cx: number, cy: number, h: number) {
  const w = h * 0.55;
  x.beginPath();
  for (const [a, b, c, d] of glyph(i)) { x.moveTo(cx + (a - 0.5) * w, cy + (b - 0.5) * h); x.lineTo(cx + (c - 0.5) * w, cy + (d - 0.5) * h); }
  x.stroke();
}

export function glyphSvg(i: number) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '-0.2 -0.1 1.4 1.2'); s.setAttribute('class', 'rune');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', glyph(i).map(([a, b, c, d]) => `M${(a - 0.5) * 0.55 + 0.5} ${b}L${(c - 0.5) * 0.55 + 0.5} ${d}`).join(''));
  s.append(p); return s;
}

/**
 * A disc of written light for the floor: hairline circles, a band of glyphs and, optionally, words written round it.
 * Radii are fractions of the disc's half width. Glyph j sits at angle (j + 0.5) / count of a turn, counter clockwise
 * from +x as seen from above, so a shader can light them one by one.
 */
export function runeDisc(o: { count: number; seed?: number; r0: number; r1: number; text?: string; textR?: number; lines?: number[]; size?: number }) {
  const S = o.size ?? 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!, R = S / 2;
  x.translate(R, R);
  x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineCap = 'round';
  for (const r of o.lines ?? [o.r0, o.r1]) { x.lineWidth = S / 700; x.beginPath(); x.arc(0, 0, r * R, 0, Math.PI * 2); x.stroke(); }
  const gh = (o.r1 - o.r0) * R * 0.62, gr = (o.r0 + o.r1) / 2 * R;
  x.lineWidth = Math.max(1.5, gh * 0.09);
  for (let j = 0; j < o.count; j++) {
    const a = (j + 0.5) / o.count * Math.PI * 2;
    x.save(); x.rotate(-a); x.translate(gr, 0); x.rotate(Math.PI / 2);
    drawGlyph(x, (o.seed ?? 0) * 97 + j, 0, 0, gh);
    x.restore();
  }
  if (o.text) {
    const tr = (o.textR ?? o.r1 + 0.06) * R, fs = S * 0.032;
    x.font = `700 ${fs}px Cinzel, Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    // written so it reads upright at the near side of the ring (+y on the canvas, toward the viewer)
    const chars = [...o.text];
    const widths = chars.map(ch => x.measureText(ch).width + fs * 0.18);
    const total = widths.reduce((a, b) => a + b, 0);
    let a = Math.PI / 2 + total / tr / 2;
    chars.forEach((ch, i) => {
      const w = widths[i]; a -= w / tr / 2;
      x.save(); x.rotate(a); x.translate(tr, 0); x.rotate(-Math.PI / 2); x.fillText(ch, 0, 0); x.restore();
      a -= w / tr / 2;
    });
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}

/** an additive disc on the floor that can light its glyphs one by one (uLit = glyphs lit, uK = overall strength) */
export function runeMaterial(tex: THREE.Texture, color: string, count: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: tex }, uC: { value: new THREE.Color(color) }, uK: { value: 1 }, uLit: { value: count + 1 }, uN: { value: count }, uT: { value: 0 }, uBase: { value: 0.18 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec2 vUv; uniform sampler2D uMap; uniform vec3 uC; uniform float uK, uLit, uN, uT, uBase;
      void main(){
        vec2 d = vUv - 0.5; float a = atan(d.y, d.x); a = a < 0.0 ? a + 6.2831853 : a;
        float idx = floor(a / 6.2831853 * uN);
        float lit = 1.0 - step(uLit, idx + 0.5);
        float m = texture2D(uMap, vUv).r;
        float shimmer = 0.85 + 0.15 * sin(uT * 1.7 + idx * 1.3);
        float k = m * uK * mix(uBase, 1.0, lit) * shimmer;
        gl_FragColor = vec4(uC * k, k);
      }`,
  });
}
