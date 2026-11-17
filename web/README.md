# Evermore game client

Vite + TypeScript, no framework. One WebGL canvas (Three.js) for the arena and the fighters, plain DOM for the words and buttons.

```
npm install
npm run dev        # http://localhost:5190
npm test           # duel sim: trace() agrees with duel() on 3000 random duels
npm run build      # static site in dist/
node --experimental-strip-types scripts/loop-test.ts   # practice loop end to end (dev server running)
node --experimental-strip-types scripts/shots.ts       # phone + desktop screenshots (real GPU)
```

## How it looks

- `src/three/engine.ts`: renderer, post chain (bloom, ACES, grade, vignette, SMAA), quality tiers and game time (hit stop, slow motion, tweens).
  Quality starts at tier 2 on desktop and 1 on phones and steps down by itself if the frame rate cannot hold; `?q=0|1|2` pins it.
- `src/three/arena.ts`: the stone pit, pillars, braziers with live fire, banners, the light shaft and the light rig. Every texture is made in code.
- `src/three/fighter.ts`: Mixamo fighters, class clips and the progression look. Level and gear are worn on the body:
  shoulder plates from level 3, burning veins and a lit weapon hand from 5, an aura and a halo from 7, a crown at 10;
  the best blade, heavy weapon and flask the player owns hang at the hip and on the back. Ghosts are the same fighters, translucent with a cold rim.
- `src/three/fx.ts`: sparks, impact flashes, shock rings, guard wards, bolts, damage numbers and the camera director (shots, cuts, trauma shake).
- Every shader is compiled behind the loading veil, so a fight never stalls on a compile.

Models live in `public/models/` (about 2.2 MB for all three classes). `scripts/build-models.mjs` rebuilds them from the Mixamo FBX files
(not in the repo) with FBX2glTF and glTF Transform.

## Wiring the real chain

`src/chain/types.ts` is the only seam. The sdk implements `GameChain` and the app switches to it:

```ts
import { useRealChain } from './app';
useRealChain(sdkChain); // mode 'chipnet' | 'mainnet'
```

Rules the client relies on:
- `Receipt.explorer` is shown as "Sealed on Bitcoin Cash" only when it is non null. Practice returns null and the UI says so.
- `challenge()` returns the snapshot and the seed `hash256(heroId4 || ghostId4 || beaten4 || defences4)`; the client replays with `src/game/sim.ts`, which must stay identical to the covenant. The 3D duel only animates what `trace()` returns.
- `forge()` is only called with a winning move list that ends exactly on its last move.
