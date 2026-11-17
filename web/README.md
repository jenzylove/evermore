# Evermore game client

Vite + TypeScript, no framework. One canvas for the world (drawn at low resolution and scaled by a whole number) and plain DOM for the words and buttons.

```
npm install
npm run dev        # http://localhost:5190
npm test           # duel sim: trace() agrees with duel() on 3000 random duels
npm run build      # static site in dist/
node --experimental-strip-types scripts/loop-test.ts   # practice loop end to end (dev server running)
node --experimental-strip-types scripts/shots.ts       # phone + desktop screenshots
```

## Wiring the real chain

`src/chain/types.ts` is the only seam. The sdk implements `GameChain` and the app switches to it:

```ts
import { useRealChain } from './app';
useRealChain(sdkChain); // mode 'chipnet' | 'mainnet'
```

Rules the client relies on:
- `Receipt.explorer` is shown as "Sealed on Bitcoin Cash" only when it is non null. Practice returns null and the UI says so.
- `challenge()` returns the snapshot and the seed `hash256(heroId4 || ghostId4 || beaten4 || defences4)`; the client replays with `src/game/sim.ts`, which must stay identical to the covenant.
- `forge()` is only called with a winning move list that ends exactly on its last move.
