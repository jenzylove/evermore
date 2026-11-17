# Credits

## Characters and animation
- **Mixamo** (Adobe), used under the Mixamo license, which allows use in games, personal or commercial.
  Characters: Paladin J Nordstrom (Knight), Kachujin G Rosales (Rogue), Vampire A Lusth (Mage).
  Animations: fighting idles, a standing idle (Mage), strikes, guards, specials, hit reaction, knockout, victory and taunt.
  The raw FBX files are not in this repository; they were converted to compressed GLB (`public/models/`,
  meshopt geometry, 1024 px WebP textures) with `scripts/build-models.mjs` (FBX2glTF + glTF Transform).
- Armour plates, crowns, halos, weapons, flasks, auras and the arena itself are built in code (`src/three/`).

## Type
- **Cinzel** by Natanael Gama, SIL Open Font License 1.1. Self hosted from `public/fonts/` (via @fontsource/cinzel).
- **Barlow Condensed** by Jeremy Tribby, SIL Open Font License 1.1. Self hosted from `public/fonts/` (via @fontsource/barlow-condensed).

## Code
- three.js (MIT) and postprocessing by pmndrs (Zlib).

## Sound
- Every sound effect and the music loop are synthesised at runtime with the Web Audio API (`src/audio/sfx.ts`). No samples.

## Icons
- Line icons drawn in `src/ui/kit.ts`.
