// The Forge: after a win the hero is sealed in a column of moonlight, a ring of runes lights round its feet and what it
// has earned (its level's pieces, its new gear) comes into being one piece at a time, each with a chime, while the
// camera walks slowly round it. This is the moment players screenshot.
import * as THREE from 'three';
import { engine, ease } from './engine';
import { DOT } from './arena';
import { director, flash, portrait, shock, shot, sparks } from './fx';
import { runeDisc, runeMaterial } from './runes';
import type { Fighter } from './fighter';
import { world } from './world';
import { sfx } from '../audio/sfx';

const GOLD = '#ffe2a6', WHITE = '#fff8ea';

const columnMaterial = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uP: { value: 0 }, uK: { value: 1 }, uT: { value: 0 }, uC: { value: new THREE.Color(GOLD) } },
  vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv = modelViewMatrix*vec4(position,1.); vV=-mv.xyz; vN=normalMatrix*normal; gl_Position=projectionMatrix*mv; }',
  fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uP, uK, uT; uniform vec3 uC;
    void main(){
      float f = abs(dot(normalize(vN), normalize(vV)));
      float edge = pow(1.0 - f, 2.0);
      float lines = pow(0.5 + 0.5 * sin(vUv.x * 6.2831 * 18.0 + sin(vUv.y * 9.0 - uT * 1.5) * 0.8), 10.0);
      float flowv = pow(0.5 + 0.5 * sin(vUv.y * 40.0 - uT * 5.0 + vUv.x * 30.0), 6.0);
      float reveal = smoothstep(1.0 - uP - 0.08, 1.0 - uP, vUv.y);
      float fade = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y) * 0.85);
      float a = uK * reveal * fade * (0.07 + edge * 0.5 + lines * 0.2 + flowv * 0.1 * (1.0 - vUv.y));
      gl_FragColor = vec4(mix(uC, vec3(1.0), 0.35 + 0.4 * (1.0 - vUv.y)) * a, a);
    }`,
});

export type Rite = {
  /** light the next glyph of the ring (an XP tick, a sealed step) */
  glyph(): void;
  /** bring the hero's worn pieces into being one by one; resolves when the last is in place */
  materialise(f: Fighter): Promise<void>;
  /** the crest: the column flares once (level up) */
  crest(): void;
  /** end the orbit and let the column settle to a quiet glow */
  settle(final: ReturnType<typeof shot>): void;
};

export function beginRite(f: Fighter): Rite {
  const at = f.root.position.clone();
  const R = 0.95;
  // the column comes down from above
  const colMat = columnMaterial();
  const col = world.extra(new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.08, 14, 64, 1, true), colMat));
  col.position.set(at.x, 7, at.z);
  const core = world.extra(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, R * 0.45, 14, 32, 1, true), columnMaterial()));
  core.position.copy(col.position); (core.material as THREE.ShaderMaterial).uniforms.uC.value.set(WHITE);
  // the pool where it meets the floor
  const pool = world.extra(new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: DOT, color: new THREE.Color(GOLD).multiplyScalar(0.7), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
  pool.rotation.x = -Math.PI / 2; pool.position.set(at.x, 0.015, at.z);
  // two rings of runes: the inner lights glyph by glyph, the outer turns against it
  const N = 18;
  const innerMat = runeMaterial(runeDisc({ count: N, seed: 5, r0: 0.62, r1: 0.82, lines: [0.6, 0.84, 0.88] }), GOLD, N);
  innerMat.uniforms.uLit.value = 0; innerMat.uniforms.uK.value = 0; innerMat.uniforms.uBase.value = 0.12;
  const inner = world.extra(new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), innerMat));
  inner.rotation.x = -Math.PI / 2; inner.position.set(at.x, 0.02, at.z);
  const outerMat = runeMaterial(runeDisc({ count: 40, seed: 9, r0: 0.84, r1: 0.92, lines: [0.82, 0.94] }), '#cfe0ff', 40);
  outerMat.uniforms.uK.value = 0;
  const outer = world.extra(new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), outerMat));
  outer.rotation.x = -Math.PI / 2; outer.position.set(at.x, 0.018, at.z);
  // motes rising inside the column
  const MN = 90, mGeo = new THREE.BufferGeometry(), mPos = new Float32Array(MN * 3), mSeed = new Float32Array(MN);
  for (let i = 0; i < MN; i++) { mSeed[i] = Math.random() * 100; mPos[i * 3 + 1] = Math.random() * 5; }
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  const motes = world.extra(new THREE.Points(mGeo, new THREE.PointsMaterial({ map: DOT, color: new THREE.Color(GOLD).multiplyScalar(2.2), size: 0.05, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
  motes.frustumCulled = false;

  let lit = 0, k = 0, flare = 0;
  world.tick((dt, t) => {
    colMat.uniforms.uT.value = t; (core.material as THREE.ShaderMaterial).uniforms.uT.value = t;
    innerMat.uniforms.uT.value = t; outerMat.uniforms.uT.value = t;
    inner.rotation.z = t * 0.12; outer.rotation.z = -t * 0.05;
    flare = Math.max(0, flare - dt * 1.4);
    colMat.uniforms.uK.value = k * (1 + flare * 0.8);
    (core.material as THREE.ShaderMaterial).uniforms.uK.value = k * (0.35 + flare * 1.2);
    (pool.material as THREE.MeshBasicMaterial).opacity = k * (0.2 + flare * 0.2);
    (motes.material as THREE.PointsMaterial).opacity = k;
    for (let i = 0; i < MN; i++) {
      let y = mPos[i * 3 + 1] + dt * (0.5 + (mSeed[i] % 1) * 0.9) * (1 + flare * 2);
      if (y > 5) y = 0;
      const a = mSeed[i] + t * (0.6 + (mSeed[i] % 0.5)), r = 0.25 + (mSeed[i] % 0.6);
      mPos[i * 3] = at.x + Math.cos(a) * r; mPos[i * 3 + 1] = y; mPos[i * 3 + 2] = at.z + Math.sin(a) * r;
    }
    mGeo.attributes.position.needsUpdate = true;
  });

  // the descent and the ring coming up
  sfx.seal();
  engine.tween(900, p => { colMat.uniforms.uP.value = ease.outCubic(p); (core.material as THREE.ShaderMaterial).uniforms.uP.value = ease.outCubic(p); k = Math.min(1, p * 1.6); });
  engine.tween(1200, p => { innerMat.uniforms.uK.value = p * 1.1; outerMat.uniforms.uK.value = p * 0.45; });
  shock(at.clone().setY(0.03), GOLD, 3.6, 0.9);
  world.arena.dim(0.55);

  // a slow walk round the hero, starting from where the camera already is
  const P = portrait();
  const c0 = director.cur.pos.clone().sub(at); const a0 = Math.atan2(c0.x, c0.z);
  const t0 = engine.t;
  director.drift = 0;
  director.orbit = t => {
    const a = a0 + (t - t0) * 0.22, d = P ? 4.8 : 3.9, y = P ? 1.5 : 1.15;
    return shot(at.x + Math.sin(a) * d, y + Math.sin((t - t0) * 0.5) * 0.06, at.z + Math.cos(a) * d, at.x, P ? 0.2 : 0.98, at.z, P ? 46 : 34);
  };

  return {
    glyph() {
      if (lit >= N) return;
      lit++; innerMat.uniforms.uLit.value = lit;
    },
    async materialise(fig) {
      const pieces = [...fig.pieces];
      const keep = pieces.map(p => p.scale.clone());
      pieces.forEach(p => { p.scale.setScalar(0.0001); });
      let i = 0;
      for (const p of pieces) {
        const where = p.getWorldPosition(new THREE.Vector3());
        if (where.y < 0.1) where.y = 0.3;
        sfx.chime(i);
        flash(where, GOLD, 0.9, 0.35);
        sparks(where, 18, [GOLD, WHITE], 1.4, -0.6, 0.9);
        lit = Math.min(N, lit + 2); innerMat.uniforms.uLit.value = lit;
        flare = Math.max(flare, 0.5);
        const s = keep[i];
        await engine.tween(380, q => { p.scale.copy(s).multiplyScalar(Math.max(0.0001, ease.outBack(q))); });
        await engine.wait(170);
        i++;
      }
      fig.flash(0.6);
    },
    crest() {
      flare = 1; lit = N; innerMat.uniforms.uLit.value = N;
      shock(at.clone().setY(0.05), WHITE, 4.2, 0.8);
      sparks(at.clone().setY(0.4), 70, [GOLD, WHITE, '#cfe0ff'], 3, -1.2, 1.8);
    },
    settle(final) {
      director.orbit = null; director.drift = 0.4;
      director.move(final, 1400, ease.inOut);
      world.arena.dim(0.2);
      engine.tween(1600, p => { k = 1 - p * 0.55; });
    },
  };
}

/** the rite's materials, compiled behind the loading veil */
export function forgeWarmup(): THREE.Object3D[] {
  const a = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), columnMaterial());
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), runeMaterial(runeDisc({ count: 4, r0: 0.5, r1: 0.6, size: 64 }), GOLD, 4));
  return [a, b];
}
