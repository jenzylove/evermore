// Mixamo FBX (converted by FBX2glTF) -> small GLBs for the Evermore client.
// Characters: drop the 1 frame bind clip, textures to 1024 WebP, meshopt geometry.
// Animations: one GLB per class with only the clips that class plays, named, resampled, meshopt.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, meshopt, weld, quantize, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const out = process.argv[2] ?? 'out';
fs.mkdirSync(out, { recursive: true });

for (const n of ['knight', 'rogue', 'mage']) {
  const d = await io.read(`raw/${n}.glb`);
  d.getRoot().listAnimations().forEach(a => a.dispose());
  await d.transform(
    prune(), dedup(), weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(`${out}/${n}.glb`, d);
}

const CLIPS = {
  knight: { idle: 'idle-knight', strike: 'strike-knight', guard: 'guard-knight', special: 'special-knight' },
  rogue: { idle: 'idle-rogue', strike: 'strike-rogue', guard: 'guard', special: 'special-rogue' },
  mage: { idle: 'idle-rogue', strike: 'strike-mage', guard: 'guard', special: 'special-mage' },
};
const COMMON = { hit: 'hit', ko: 'ko', victory: 'victory', taunt: 'taunt' };
for (const [cls, map] of Object.entries(CLIPS)) {
  const all = { ...map, ...COMMON };
  let doc = null;
  for (const [clip, file] of Object.entries(all)) {
    const d = await io.read(`raw/${file}.glb`);
    d.getRoot().listAnimations().forEach(a => a.setName(clip));
    if (!doc) doc = d; else mergeDocuments(doc, d);
  }
  { // every clip onto the first skeleton (by bone name); only the hips keep translation, nobody keeps scale
    const root = doc.getRoot(); const base = new Map();
    root.listScenes()[0].traverse(n => base.set(n.getName(), n));
    for (const a of root.listAnimations()) for (const c of a.listChannels()) {
      const nm = c.getTargetNode()?.getName(); const t = base.get(nm);
      if (!t || c.getTargetPath() === 'scale' || (c.getTargetPath() === 'translation' && nm !== 'mixamorig:Hips')) { c.getSampler()?.dispose(); c.dispose(); }
      else c.setTargetNode(t);
    }
    root.listScenes().slice(1).forEach(sc => { sc.listChildren().forEach(ch => ch.dispose()); sc.dispose(); });
  }
  await doc.transform(unpartition(), resample({ tolerance: 0.0008 }), prune({ keepLeaves: true, keepAttributes: false }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`${out}/anims-${cls}.glb`, doc);
}
for (const f of fs.readdirSync(out)) console.log(f, Math.round(fs.statSync(`${out}/${f}`).size / 1024) + 'K');
