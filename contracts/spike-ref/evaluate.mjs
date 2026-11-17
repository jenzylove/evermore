// Relic S3: raise, challenge, forge (+ ghost refresh, gear drop), lanes, sale in the
// BCH 2026 VM (libauth 3.1.0-next.8, standard mode). Run: node evaluate.mjs
import fs from 'fs';
import { Contract, MockNetworkProvider, SignatureTemplate } from 'cashscript';
import {
  createVirtualMachineBch2026, hexToBin, binToHex, hash160, hash256, secp256k1,
  encodeTransaction, generatePrivateKey, cashAssemblyToBin,
} from '@bitauth/libauth';
import * as S from './sim.ts';

const vm = createVirtualMachineBch2026(true); // standard
const rev = (b) => Uint8Array.from(b).reverse();
const out = [];
const log = (s) => { console.log(s); out.push(s); };
const art = (n) => JSON.parse(fs.readFileSync(`${n}.json`, 'utf8'));

const key = () => { const k = generatePrivateKey(); const pub = secp256k1.derivePublicKeyCompressed(k); return { k, pub, pkh: hash160(pub) }; };
const A = key(), A2 = key(), B = key(), T = key(), X = key(), seller = key(), buyer = key();
const p2pkh = (kk) => cashAssemblyToBin(`OP_DUP OP_HASH160 <0x${binToHex(kk.pkh)}> OP_EQUALVERIFY OP_CHECKSIG`);

const CATEGORY = hash256(Uint8Array.of(0x52, 0x4c)); // display order, as libauth keeps it
const CAT_INTERNAL = binToHex(rev(CATEGORY));
const provider = new MockNetworkProvider();
const opt = { provider, addressType: 'p2sh32' };
const RAISE = 50000n, CFEE = 4000n, FFEE = 2000n, GEARCAP = 3n;
const arena = new Contract(art('Arena'), [CAT_INTERNAL], opt);
const counter = new Contract(art('Counter'), [CAT_INTERNAL], opt);
const arenaLock = hexToBin(arena.lockingBytecode), counterLock = hexToBin(counter.lockingBytecode);
const lane = new Contract(art('Lane'), [binToHex(T.pkh), binToHex(arenaLock), binToHex(counterLock), RAISE, CFEE, FFEE, GEARCAP], opt);
const laneLock = hexToBin(lane.lockingBytecode);
const nft = (capability, commitment) => ({ category: CATEGORY, amount: 0n, nft: { capability, commitment } });

let nonce = 0;
const freshOp = () => ({ hash: hash256(Uint8Array.of(++nonce & 255, nonce >> 8, 7)), index: 0 });
const U = (lock, value, token, op) => ({ lock, value: BigInt(value), token, op: op ?? freshOp() });
const so = (u) => ({ lockingBytecode: u.lock, valueSatoshis: u.value, ...(u.token ? { token: u.token } : {}) });
const O = (lock, value, token) => ({ lockingBytecode: lock, valueSatoshis: BigInt(value), ...(token ? { token } : {}) });

// unlockers
const C = (contract, fn, ...args) => ({ contract, fn, args });
const K = (kk) => ({ key: kk });

// Build, sign and verify. ins: [{u, w}] where w is C(...) or K(...). Change (no token) appended
// to `change` lock if given. Returns validity, size, per covenant input op cost.
function run(ins, outs, { change } = {}) {
  outs = outs.map((o) => ({ ...o }));
  if (change) {
    const inSum = ins.reduce((a, i) => a + i.u.value, 0n), outSum = outs.reduce((a, o) => a + o.valueSatoshis, 0n);
    outs.push(O(change, inSum - outSum - 4000n));
  }
  const sourceOutputs = ins.map((i) => so(i.u));
  const inputs = ins.map((i) => ({ outpointTransactionHash: i.u.op.hash, outpointIndex: i.u.op.index, sequenceNumber: 0, unlockingBytecode: Uint8Array.of() }));
  const tx = { version: 2, locktime: 0, inputs, outputs: outs };
  ins.forEach((i, idx) => {
    const ctx = { transaction: tx, sourceOutputs, inputIndex: idx };
    if (i.w.key) inputs[idx].unlockingBytecode = new SignatureTemplate(i.w.key.k).unlockP2PKH().generateUnlockingBytecode(ctx);
    else inputs[idx].unlockingBytecode = i.w.contract.unlock[i.w.fn](...i.w.args).generateUnlockingBytecode(ctx);
  });
  const res = vm.verify({ transaction: tx, sourceOutputs });
  const enc = encodeTransaction(tx);
  const metrics = ins.map((i, idx) => {
    if (i.w.key) return null;
    const st = vm.evaluate({ inputIndex: idx, sourceOutputs, transaction: tx });
    const ul = inputs[idx].unlockingBytecode.length;
    return { name: `${i.w.contract.name}.${i.w.fn}`, ul, op: st.metrics.operationCost, budget: (41 + ul) * 800, hashIt: st.metrics.hashDigestIterations };
  }).filter(Boolean);
  const txidInternal = hash256(enc);
  return { ok: res === true, err: res === true ? '' : String(res), size: enc.length, metrics, txidInternal, txid: rev(txidInternal), outs, ins };
}
// a new UTXO created by tx r at output index i
const made = (r, i) => U(r.outs[i].lockingBytecode, r.outs[i].valueSatoshis, r.outs[i].token, { hash: r.txid, index: i });

let pass = 0, fail = 0;
const check = (label, r, expect) => {
  const good = r.ok === expect; good ? pass++ : fail++;
  const m = r.metrics.map((x) => `${x.name} ${x.op}/${x.budget} (${(100 * x.op / x.budget).toFixed(1)}%) ul ${x.ul} B`).join('; ');
  log(`${good ? 'PASS' : 'FAIL'} | ${label} | ${r.ok ? 'valid' : 'rejected (' + r.err.replace(/\s+/g, ' ').slice(0, 90) + ')'} | tx ${r.size} B${r.ok ? ' | ' + m : ''}`);
  return r;
};
const fund = (kk, v = 200000) => ({ u: U(p2pkh(kk), v), w: K(kk) });

// ---------------------------------------------------------------- genesis state
const lanes = Array.from({ length: 16 }, (_, n) => U(laneLock, 1000, nft('minting', S.encodeLane(n, 0))));
const counterU = (minted) => U(counterLock, 1000, nft('none', S.encodeCounter(minted)));
const L = (u, fn, ...a) => ({ u, w: C(lane, fn, ...a) });
const G = (u) => ({ u, w: C(arena, 'fight') });

log(`contracts: Lane redeem ${hexToBin(lane.bytecode).length} B, Arena ${hexToBin(arena.bytecode).length} B, Counter ${hexToBin(counter.bytecode).length} B, Sale ${hexToBin(new Contract(art('Sale'), [binToHex(seller.pkh), 1n], opt).bytecode).length} B`);

// ================================================================ 1. RAISE
log('\n## 1 Raise');
function raiseTx(laneU, cls, owner, mut = (o) => o, extraIns = []) {
  const [l, ctr] = [laneU.token.nft.commitment[1], laneU.token.nft.commitment[2] + laneU.token.nft.commitment[3] * 256];
  const hero = S.starterHero(ctr * 16 + l, cls);
  let outs = [
    O(laneLock, 1000, nft('minting', S.encodeLane(l, ctr + 1))),
    O(p2pkh(owner), 1000, nft('none', S.encodeHero(hero))),
    O(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(hero, owner.pkh)))),
    O(p2pkh(T), RAISE),
  ];
  outs = mut(outs);
  return { r: run([L(laneU, 'raise', BigInt(cls)), fund(owner), ...extraIns], outs, { change: p2pkh(owner) }), hero };
}
const rA = raiseTx(lanes[3], 0, A); check('raise Knight on lane 3 (id 3)', rA.r, true);
const rB = raiseTx(lanes[9], 2, B); check('raise Mage on lane 9 (id 9), built against the same UTXO set', rB.r, true);
const shared = rA.r.ins.filter((i) => rB.r.ins.some((j) => binToHex(j.u.op.hash) === binToHex(i.u.op.hash) && j.u.op.index === i.u.op.index));
log(`  lanes 3 and 9 raise in parallel: shared inputs ${shared.length} -> both can confirm in one block`);
const heroA = made(rA.r, 1), ghostA = made(rA.r, 2), heroB = made(rB.r, 1), ghostB = made(rB.r, 2);
const lane3b = made(rA.r, 0);
const rA2 = raiseTx(lane3b, 1, A); check('second raise on lane 3, chained (counter 1 -> id 19)', rA2.r, true);
log(`  ids: ${S.decodeHero(rA.r.outs[1].token.nft.commitment).id}, ${S.decodeHero(rB.r.outs[1].token.nft.commitment).id}, ${S.decodeHero(rA2.r.outs[1].token.nft.commitment).id}`);
const bad = (label, fn) => check(label, fn(), false);
bad('raise: starter HP +1', () => raiseTx(lanes[3], 0, A, (o) => { o[1] = O(p2pkh(A), 1000, nft('none', S.encodeHero({ ...rA.hero, hp: 61 }))); return o; }).r);
bad('raise: lane counter not bumped', () => raiseTx(lanes[3], 0, A, (o) => { o[0] = O(laneLock, 1000, nft('minting', S.encodeLane(3, 0))); return o; }).r);
bad('raise: price 1 sat short', () => raiseTx(lanes[3], 0, A, (o) => { o[3] = O(p2pkh(T), RAISE - 1n); return o; }).r);
bad('raise: claims another id (99)', () => raiseTx(lanes[3], 0, A, (o) => { const h = { ...rA.hero, id: 99 }; o[1] = O(p2pkh(A), 1000, nft('none', S.encodeHero(h))); o[2] = O(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(h, A.pkh)))); return o; }).r);
bad('raise: ghost owner is not the hero owner', () => raiseTx(lanes[3], 0, A, (o) => { o[2] = O(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(rA.hero, X.pkh)))); return o; }).r);
bad('raise: no ghost minted (ghost sent to player)', () => raiseTx(lanes[3], 0, A, (o) => { o[2] = { ...o[2], lockingBytecode: p2pkh(A) }; return o; }).r);
bad('raise: hero to a non P2PKH lock', () => raiseTx(lanes[3], 0, A, (o) => { o[1] = { ...o[1], lockingBytecode: arenaLock }; return o; }).r);
bad('raise: class 3', () => run([L(lanes[3], 'raise', 3n), fund(A)], raiseTx(lanes[3], 0, A).r.outs));
bad('raise: extra hero NFT minted into change', () => raiseTx(lanes[3], 0, A, (o) => [...o, O(p2pkh(A), 1000, nft('none', S.encodeHero({ ...rA.hero, level: 99 })))]).r);
bad('raise: lane output made immutable (minting dropped)', () => raiseTx(lanes[3], 0, A, (o) => { o[0] = O(laneLock, 1000, nft('none', S.encodeLane(3, 1))); return o; }).r);
bad('grief: victim ghost slipped in as a raise input (burn attempt)', () => raiseTx(lanes[4], 0, X, (o) => o, [G(ghostB)]).r);

// ================================================================ 2. CHALLENGE
log('\n## 2 Challenge');
function challengeTx(laneU, ghostU, heroId, who, mut = (o) => o, ticketSalt) {
  const g = S.decodeGhost(ghostU.token.nft.commitment);
  const salt = ticketSalt ?? rev(ghostU.op.hash);
  let outs = [
    O(laneLock, laneU.value, laneU.token),
    O(arenaLock, ghostU.value, nft('none', S.encodeGhost({ ...g, defences: g.defences + 1 }))),
    O(p2pkh({ pkh: g.ownerPkh }), CFEE),
    O(p2pkh(who), 1000, nft('none', S.encodeTicket(heroId, g, salt))),
  ];
  outs = mut(outs, g);
  return run([L(laneU, 'challenge', BigInt(heroId)), G(ghostU), fund(who)], outs, { change: p2pkh(who) });
}
const lane5 = lanes[5];
const cOk = check('A (hero 3) challenges ghost 9: fee to B, defences + 1, ticket', challengeTx(lane5, ghostB, 3, A), true);
bad('challenge: fee paid to someone else', () => challengeTx(lane5, ghostB, 3, A, (o) => { o[2] = O(p2pkh(X), CFEE); return o; }));
bad('challenge: fee 1 sat short', () => challengeTx(lane5, ghostB, 3, A, (o) => { o[2] = O(o[2].lockingBytecode, CFEE - 1n); return o; }));
bad('challenge: defences not bumped', () => challengeTx(lane5, ghostB, 3, A, (o, g) => { o[1] = O(arenaLock, 1000, nft('none', S.encodeGhost(g))); return o; }));
bad('challenge: ticket snapshot with ghost HP lowered', () => challengeTx(lane5, ghostB, 3, A, (o, g) => { o[3] = O(p2pkh(A), 1000, nft('none', S.encodeTicket(3, { ...g, hp: 1 }, rev(ghostB.op.hash)))); return o; }));
bad('challenge: ticket with a chosen salt', () => challengeTx(lane5, ghostB, 3, A, (o) => o, new Uint8Array(32)));
bad('challenge: own ghost (hero 9 vs ghost 9)', () => challengeTx(lane5, ghostB, 9, B));
bad('challenge: ghost kept by the challenger', () => challengeTx(lane5, ghostB, 3, A, (o) => { o[1] = { ...o[1], lockingBytecode: p2pkh(A) }; return o; }));
bad('arena: ghost spent with no lane input', () => run([fund(X), G(ghostB)], [O(p2pkh(X), 100000), O(arenaLock, 1000, ghostB.token)]));
bad('grief: second ghost slipped into a challenge as input 2 (burn attempt)', () => run([L(lane5, 'challenge', 3n), G(ghostB), G(ghostA), fund(A)], cOk.outs));

// ================================================================ 3. FORGE + ghost refresh + gear
log('\n## 3 Forge (ticket seed, own ghost refresh, gear drop)');
// solve a duel from a real challenge; if the style is unwinnable, rebuild the challenge with a
// different change amount (this IS seed grinding, counted for the report)
function challengeUntilWinnable(laneU, ghostU, hero, who, want = () => true, maxTries = 400) {
  for (let t = 0; t < maxTries; t++) {
    const g = S.decodeGhost(ghostU.token.nft.commitment);
    const salt = rev(ghostU.op.hash);
    const outs = [
      O(laneLock, laneU.value, laneU.token),
      O(arenaLock, ghostU.value, nft('none', S.encodeGhost({ ...g, defences: g.defences + 1 }))),
      O(p2pkh({ pkh: g.ownerPkh }), CFEE),
      O(p2pkh(who), 1000, nft('none', S.encodeTicket(hero.id, g, salt))),
      O(p2pkh(who), 150000 - t),
    ];
    const r = run([L(laneU, 'challenge', BigInt(hero.id)), G(ghostU), fund(who)], outs);
    const h = S.seedHash(r.txidInternal, salt);
    const moves = S.solve(hero, g, S.seedOf(h));
    if (moves && want(S.forgeHero(hero, g, S.duel(hero, g, S.seedOf(h), moves).hHp, moves.length))) return { r, g, h, moves, tries: t + 1 };
  }
  return null;
}
function forgeTx({ laneU, heroU, ghostU, ticketU, ownU, counterInU, moves, drop = 0, mut = (o) => o, heroOut, change = true }) {
  const hero = S.decodeHero(heroU.token.nft.commitment);
  const ghost = S.decodeGhost(ghostU.token.nft.commitment);
  const t = ticketU.token.nft.commitment;
  const snap = { ...S.decodeGhost(Uint8Array.from([0x47, ...t.slice(5, 19), ...new Uint8Array(28)])), beaten: ghost.beaten };
  const h = S.seedHash(rev(ticketU.op.hash), t.slice(19));
  const d = S.duel(hero, snap, S.seedOf(h), moves);
  const f = S.forgeHero(hero, snap, Math.max(1, d.hHp), d.rounds);
  const heroLock = heroU.lock;
  let outs = [
    O(laneLock, laneU.value, laneU.token),
    O(heroLock, heroU.value, nft('none', heroOut ?? S.encodeHero(f.hero))),
    O(arenaLock, ghostU.value, nft('none', S.encodeGhost({ ...ghost, beaten: ghost.beaten + 1 }))),
    O(p2pkh(T), FFEE),
  ];
  const ins = [L(laneU, 'forge', S.packMoves(moves), BigInt(moves.length), BigInt(drop)), { u: heroU, w: K(heroU.key) }, G(ghostU), { u: ticketU, w: K(ticketU.key) }];
  if (ownU) {
    const own = S.decodeGhost(ownU.token.nft.commitment);
    ins.push(G(ownU));
    outs.push(O(arenaLock, ownU.value, nft('none', S.encodeGhost({ ...S.ghostOf(f.hero, heroLock.slice(3, 23)), beaten: own.beaten, defences: own.defences }))));
  }
  if (counterInU) {
    const minted = counterInU.token.nft.commitment[1] + counterInU.token.nft.commitment[2] * 256;
    ins.push({ u: counterInU, w: C(counter, 'tick') });
    outs.push(O(counterLock, counterInU.value, nft('none', S.encodeCounter(minted + 1))));
    outs.push(O(heroLock, 1000, nft('none', S.encodeGear(minted, S.gearKindOf(h), snap.level - hero.level))));
  }
  outs = mut(outs, { f, h, snap });
  ins.push({ u: U(heroLock, 200000), w: K(heroU.key) });
  const inSum = ins.reduce((a, i) => a + i.u.value, 0n), outSum = outs.reduce((a, o) => a + o.valueSatoshis, 0n);
  if (change) outs.push(O(heroLock, inSum - outSum - 4000n));
  return { r: run(ins, outs), f, d };
}
const own = (u, kk) => ({ ...u, key: kk }); // attach signer to a P2PKH utxo

// 3a. real chain: raise -> challenge -> forge with level up (L1 -> L2), own ghost refreshed
const ch = challengeUntilWinnable(lane5, ghostB, rA.hero, A, (f) => f.levelled);
check(`challenge for the forge (style winnable after ${ch.tries} build(s))`, ch.r, true);
const ticket1 = own(made(ch.r, 3), A), ghostB2 = made(ch.r, 1), lane5b = made(ch.r, 0);
const base = { laneU: lanes[11], heroU: own(heroA, A), ghostU: ghostB2, ticketU: ticket1, ownU: ghostA, moves: ch.moves };
const fLv = forgeTx(base);
check(`forge on lane 11 (hero raised on lane 3): win in ${fLv.d.rounds}, L1 -> L${fLv.f.hero.level}, own ghost 3 refreshed`, fLv.r, true);
bad('forge level up without the own ghost', () => forgeTx({ ...base, ownU: undefined }).r);
bad('forge level up, own ghost kept at old stats', () => forgeTx({ ...base, mut: (o) => { o[4] = O(arenaLock, 1000, ghostA.token); return o; } }).r);
bad('forge level up, someone else\'s ghost passed as own', () => forgeTx({ ...base, ownU: made(raiseTx(lanes[6], 1, X).r, 2) }).r);
// hero sent home to Selene (A2): the refresh moves the ghost's fee address to the new owner
const heroAhome = own(U(p2pkh(A2), 1000, heroA.token), A2);
const ticketHome = own(U(p2pkh(A2), 1000, ticket1.token, ticket1.op), A2);
check('forge level up after Send home: ghost owner refreshed to the new pkh', forgeTx({ ...base, heroU: heroAhome, ticketU: ticketHome }).r, true);
bad('forge level up after Send home, ghost owner left stale', () => forgeTx({ ...base, heroU: heroAhome, ticketU: ticketHome, mut: (o, { f }) => { o[4] = O(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(f.hero, A.pkh)))); return o; } }).r);
// seed binding
const rawSeed = S.seedOf(rev(ticket1.op.hash));
const rawWin = S.solve(rA.hero, ch.g, rawSeed);
if (rawWin && !(S.duel(rA.hero, ch.g, S.seedOf(ch.h), rawWin).won && S.duel(rA.hero, ch.g, S.seedOf(ch.h), rawWin).rounds === rawWin.length))
  bad('forge with moves solved against the S1 raw txid seed', () => forgeTx({ ...base, moves: rawWin }).r);
bad('forge with a ticket for another hero', () => forgeTx({ ...base, ticketU: own(U(p2pkh(A), 1000, nft('none', S.encodeTicket(19, ch.g, rev(ghostB.op.hash))), ticket1.op), A) }).r);
bad('forge: ticket salt edited after the challenge (not mintable; tested by fabricating it)', () => forgeTx({ ...base, ticketU: own(U(p2pkh(A), 1000, nft('none', S.encodeTicket(3, ch.g, new Uint8Array(32))), ticket1.op), A) }).r);

// 3b. no level up: own ghost must NOT be dragged in
const vet = { ...S.starterHero(35, 0), level: 5, hp: 72, atk: 14, def: 16 }; // need 100 xp
const vetU = own(U(p2pkh(A), 1000, nft('none', S.encodeHero(vet))), A);
const vetGhost = U(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(vet, A.pkh))));
const ch2 = challengeUntilWinnable(lane5b, ghostB2, vet, A);
const t2 = own(made(ch2.r, 3), A);
const nb = { laneU: lanes[12], heroU: vetU, ghostU: made(ch2.r, 1), ticketU: t2, moves: ch2.moves };
check(`forge, no level up (L5 xp ${forgeTx(nb).f.hero.xp}/100)`, forgeTx(nb).r, true);
bad('forge, no level up, own ghost included anyway', () => forgeTx({ ...nb, ownU: vetGhost }).r);
bad('forge, tampered hero xp + 1', () => forgeTx({ ...nb, heroOut: S.encodeHero({ ...forgeTx(nb).f.hero, xp: forgeTx(nb).f.hero.xp + 1 }) }).r);

// 3c. gear drop: hero L2 beats a ghost snapshotted at L5 (beaten 20, so no level up)
const strong = { ...S.starterHero(51, 1), level: 2, xp: 0, hp: 80, atk: 30, def: 20, spd: 30 };
const strongU = own(U(p2pkh(B), 1000, nft('none', S.encodeHero(strong))), B);
const strongGhost = U(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(strong, B.pkh))));
const bigG = { id: 77, cls: 0, level: 5, hp: 70, atk: 12, def: 10, spd: 5, ownerPkh: X.pkh, beaten: 20, defences: 3 };
const bigGU = U(arenaLock, 1000, nft('none', S.encodeGhost(bigG)));
const ch3 = challengeUntilWinnable(lanes[7], bigGU, strong, B);
const t3 = own(made(ch3.r, 3), B), bigGU2 = made(ch3.r, 1);
const gd = { laneU: lanes[13], heroU: strongU, ghostU: bigGU2, ticketU: t3, moves: ch3.moves, drop: 1, counterInU: counterU(0) };
const gOk = forgeTx(gd);
check(`gear drop: L2 beats L5 ghost, gear #0 kind ${S.gearKindOf(ch3.h)} tier 3, counter 0 -> 1`, gOk.r, true);
check('drop eligible but skipped (drop = 0, no counter)', forgeTx({ ...gd, drop: 0, counterInU: undefined }).r, true);
bad('gear: counter not incremented', () => forgeTx({ ...gd, mut: (o) => { o[4] = O(counterLock, 1000, nft('none', S.encodeCounter(0))); return o; } }).r);
bad('gear: tier forged (9)', () => forgeTx({ ...gd, mut: (o) => { o[5] = O(o[5].lockingBytecode, 1000, nft('none', S.encodeGear(0, S.gearKindOf(ch3.h), 9))); return o; } }).r);
bad('gear: kind forged', () => forgeTx({ ...gd, mut: (o) => { o[5] = O(o[5].lockingBytecode, 1000, nft('none', S.encodeGear(0, (S.gearKindOf(ch3.h) + 1) % 3, 3))); return o; } }).r);
bad('gear: sent to another address', () => forgeTx({ ...gd, mut: (o) => { o[5] = { ...o[5], lockingBytecode: p2pkh(X) }; return o; } }).r);
bad('gear: cap reached (counter at 3 of 3)', () => forgeTx({ ...gd, counterInU: counterU(3) }).r);
check('gear: last one under the cap (counter 2 -> 3)', forgeTx({ ...gd, counterInU: counterU(2) }).r, true);
bad('gear: second gear minted into change', () => forgeTx({ ...gd, change: false, mut: (o) => [...o, O(p2pkh(B), 1000, nft('none', S.encodeGear(1, 0, 3)))] }).r);
{ // drop claimed against a ghost only 2 levels up
  const near = { ...strong, id: 52, level: 3 };
  const nearU = own(U(p2pkh(B), 1000, nft('none', S.encodeHero(near))), B);
  const c = challengeUntilWinnable(lanes[8], bigGU, near, B);
  bad('gear: claimed vs a ghost only 2 levels above', () => forgeTx({ laneU: lanes[13], heroU: nearU, ghostU: made(c.r, 1), ticketU: own(made(c.r, 3), B), moves: c.moves, drop: 1, counterInU: counterU(0) }).r);
}
bad('counter: spent without a lane', () => run([fund(X), { u: counterU(0), w: C(counter, 'tick') }], [O(p2pkh(X), 100000), O(counterLock, 1000, nft('none', S.encodeCounter(0)))]));
bad('counter: burned inside a raise', () => raiseTx(lanes[4], 0, X, (o) => o, [{ u: counterU(0), w: C(counter, 'tick') }]).r);

// 3d. worst case: 12 round win + level up + gear drop (8 outputs)
{
  let w = null;
  for (let k = 0; k < 40000 && !w; k++) {
    const h = { id: 900, cls: 1, level: 10, xp: 199, hp: 400, atk: 30, def: 30, spd: 20, wins: 0 };
    const g = { id: 901, cls: 0, level: 13, hp: 150 + (k % 60), atk: 25, def: 30, spd: 10, ownerPkh: X.pkh, beaten: 0, defences: 0 };
    const tOp = { hash: hash256(Uint8Array.of(77, k & 255, k >> 8)), index: 3 }, salt = hash256(Uint8Array.of(5, k & 255));
    const sd = S.seedOf(S.seedHash(rev(tOp.hash), salt));
    const m = Array.from({ length: 12 }, () => Math.floor(Math.random() * 3));
    const r = S.duel(h, g, sd, m);
    if (r.won && r.rounds === 12) w = { h, g, tOp, salt, m };
  }
  const { h, g, tOp, salt, m } = w;
  const res = forgeTx({ laneU: lanes[15], heroU: own(U(p2pkh(A), 1000, nft('none', S.encodeHero(h))), A), ghostU: U(arenaLock, 1000, nft('none', S.encodeGhost(g))),
    ticketU: own(U(p2pkh(A), 1000, nft('none', S.encodeTicket(900, g, salt)), tOp), A), ownU: U(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(h, A.pkh)))),
    counterInU: counterU(1), drop: 1, moves: m });
  check('WORST CASE: 12 round win + level up + gear drop (6 in / 8 out)', res.r, true);
}

// ================================================================ 4. LANES
log('\n## 4 Parallel lanes');
{
  // two forges in the same block, different lanes, different heroes and ghosts
  const f1 = fLv.r; // lane 11
  const ch4 = challengeUntilWinnable(lanes[2], ghostA, S.decodeHero(heroB.token.nft.commitment), B, (f) => f.levelled);
  const f2 = forgeTx({ laneU: lanes[14], heroU: own(heroB, B), ghostU: made(ch4.r, 1), ticketU: own(made(ch4.r, 3), B), ownU: made(rB.r, 2), moves: ch4.moves });
  check('forge #2 on lane 14 (hero 9 vs ghost 3), same block as forge #1 on lane 11', f2.r, true);
  const ops = (r) => new Set(r.ins.map((i) => binToHex(i.u.op.hash) + ':' + i.u.op.index));
  const a = ops(f1), b = ops(f2.r);
  log(`  forge #1 lane 11 and forge #2 lane 14 share ${[...a].filter((x) => b.has(x)).length} inputs -> independent, both confirm in one block`);
  // same lane: the second forge spends the same lane outpoint -> conflict; it must chain on the new lane UTXO
  const f3 = forgeTx({ laneU: lanes[11], heroU: own(heroB, B), ghostU: made(ch4.r, 1), ticketU: own(made(ch4.r, 3), B), ownU: made(rB.r, 2), moves: ch4.moves });
  const c3 = [...ops(f3.r)].filter((x) => a.has(x)).length;
  log(`  same lane (11) for both: ${c3} shared input (the lane) -> double spend; client rebuilds on lane 11's new outpoint or picks another lane`);
  const f3b = forgeTx({ laneU: made(f1, 0), heroU: own(heroB, B), ghostU: made(ch4.r, 1), ticketU: own(made(ch4.r, 3), B), ownU: made(rB.r, 2), moves: ch4.moves });
  check('forge #2 chained on lane 11\'s new outpoint (0 conf chain)', f3b.r, true);
  // all 16 lanes raise once: 16 distinct ids
  const ids = lanes.map((l) => S.decodeHero(raiseTx(l, 0, A).r.outs[1].token.nft.commitment).id);
  log(`  16 lanes x 1 raise -> ids [${ids}] (${new Set(ids).size} distinct); lane n issues n, n+16, n+32, ...`);
}

// ================================================================ 6. SALE
log('\n## 6 Sale');
const SaleArt = art('Sale');
const sale = (pk, price) => new Contract(SaleArt, [binToHex(pk), price], opt);
const PRICE = 300000n;
const s1 = sale(seller.pkh, PRICE), s1Lock = hexToBin(s1.lockingBytecode);
const listedHero = U(s1Lock, 1000, nft('none', S.encodeHero({ ...rA.hero, level: 7 })));
const listedGear = U(s1Lock, 1000, nft('none', S.encodeGear(2, 1, 4)));
const buyIns = (u) => [{ u, w: C(s1, 'buy') }, fund(buyer, 500000)];
check('buy hero: seller paid at the same index, hero to buyer', run(buyIns(listedHero), [O(p2pkh(seller), PRICE), O(p2pkh(buyer), 1000, listedHero.token)], { change: p2pkh(buyer) }), true);
check('buy gear', run(buyIns(listedGear), [O(p2pkh(seller), PRICE), O(p2pkh(buyer), 1000, listedGear.token)], { change: p2pkh(buyer) }), true);
bad('buy: 1 sat short', () => run(buyIns(listedHero), [O(p2pkh(seller), PRICE - 1n), O(p2pkh(buyer), 1000, listedHero.token)], { change: p2pkh(buyer) }));
bad('buy: payment to someone else', () => run(buyIns(listedHero), [O(p2pkh(X), PRICE), O(p2pkh(buyer), 1000, listedHero.token)], { change: p2pkh(buyer) }));
bad('buy: payment output carries the token', () => run(buyIns(listedHero), [O(p2pkh(seller), PRICE, listedHero.token)], { change: p2pkh(buyer) }));
bad('buy two listings with one payment', () => run([{ u: listedHero, w: C(s1, 'buy') }, { u: listedGear, w: C(s1, 'buy') }, fund(buyer, 900000)], [O(p2pkh(seller), PRICE), O(p2pkh(buyer), 1000, listedHero.token), O(p2pkh(buyer), 1000, listedGear.token)], { change: p2pkh(buyer) }));
check('buy two listings with two payments', run([{ u: listedHero, w: C(s1, 'buy') }, { u: listedGear, w: C(s1, 'buy') }, fund(buyer, 900000)], [O(p2pkh(seller), PRICE), O(p2pkh(seller), PRICE), O(p2pkh(buyer), 1000, listedHero.token), O(p2pkh(buyer), 1000, listedGear.token)], { change: p2pkh(buyer) }), true);
check('cancel by seller', run([{ u: listedHero, w: C(s1, 'cancel', binToHex(seller.pub), new SignatureTemplate(seller.k)) }, fund(seller)], [O(p2pkh(seller), 1000, listedHero.token)], { change: p2pkh(seller) }), true);
bad('cancel by someone else', () => run([{ u: listedHero, w: C(s1, 'cancel', binToHex(X.pub), new SignatureTemplate(X.k)) }, fund(X)], [O(p2pkh(X), 1000, listedHero.token)], { change: p2pkh(X) }));
bad('cancel: seller pubkey, other key signs', () => run([{ u: listedHero, w: C(s1, 'cancel', binToHex(seller.pub), new SignatureTemplate(X.k)) }, fund(X)], [O(p2pkh(X), 1000, listedHero.token)], { change: p2pkh(X) }));

// ================================================================ parity
log('\n## Parity (full forge path, random fighters, level up and drop when they apply)');
{
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  let agree = 0, wins = 0, lv = 0, drops = 0, maxPct = 0;
  const N = 30;
  for (let k = 0; k < N; k++) {
    const h = { id: rnd(1, 1e6), cls: rnd(0, 2), level: rnd(1, 20), xp: 0, hp: rnd(30, 300), atk: rnd(5, 60), def: rnd(2, 50), spd: rnd(1, 40), wins: rnd(0, 1000) };
    h.xp = rnd(0, 20 * h.level - 1);
    const g = { id: h.id + 1, cls: rnd(0, 2), level: rnd(1, 30), hp: rnd(30, 300), atk: rnd(5, 60), def: rnd(2, 50), spd: rnd(1, 40), ownerPkh: X.pkh, beaten: rnd(0, 40), defences: rnd(0, 99) };
    const tOp = { hash: hash256(Uint8Array.of(200, k, rnd(0, 255))), index: 3 }, salt = hash256(Uint8Array.of(201, k));
    const hs = S.seedHash(rev(tOp.hash), salt), sd = S.seedOf(hs);
    let moves = k % 2 === 0 ? S.solve(h, g, sd) : null;
    if (!moves) moves = Array.from({ length: rnd(1, 12) }, () => rnd(0, 2));
    const r = S.duel(h, g, sd, moves); moves = moves.slice(0, Math.max(1, r.rounds));
    const f = S.forgeHero(h, g, Math.max(1, r.hHp), r.rounds);
    const drop = g.level >= h.level + 3 ? 1 : 0;
    const args = { laneU: lanes[k % 16], heroU: own(U(p2pkh(A), 1000, nft('none', S.encodeHero(h))), A), ghostU: U(arenaLock, 1000, nft('none', S.encodeGhost(g))),
      ticketU: own(U(p2pkh(A), 1000, nft('none', S.encodeTicket(h.id, g, salt)), tOp), A), moves, drop, counterInU: drop ? counterU(0) : undefined,
      ownU: f.levelled ? U(arenaLock, 1000, nft('none', S.encodeGhost(S.ghostOf(h, A.pkh, 1, 2)))) : undefined };
    const res = forgeTx(args).r;
    let strict = true;
    if (r.won) { wins++; if (f.levelled) lv++; if (drop) drops++; strict = !forgeTx({ ...args, heroOut: S.encodeHero({ ...f.hero, xp: f.hero.xp + 1 }) }).r.ok; }
    const same = res.ok === r.won && strict; if (same) agree++;
    if (res.ok) maxPct = Math.max(maxPct, 100 * res.metrics[0].op / res.metrics[0].budget);
    if (!same) log(`DIFFER duel ${k}: sim ${r.won} covenant ${res.ok} ${res.err.slice(0, 120)}`);
  }
  log(`parity: ${agree}/${N} agree (${wins} wins: ${lv} level ups, ${drops} gear drops; ${N - wins} losses rejected); max lane budget use ${maxPct.toFixed(1)}%`);
}

// ================================================================ grinding measurement
log('\n## Seed grinding (sim only)');
{
  const h = S.starterHero(1, 0);
  for (const gg of [S.ghostOf({ ...S.starterHero(2, 2), level: 3, hp: 42, atk: 21, def: 6, spd: 8 }, X.pkh), S.ghostOf({ ...S.starterHero(2, 1), level: 2, hp: 47, atk: 14, def: 5, spd: 11 }, X.pkh)]) {
    let win = 0; const N = 3000;
    for (let i = 0; i < N; i++) if (S.solve(h, gg, S.seedOf(S.seedHash(hash256(Uint8Array.of(i & 255, i >> 8, 1)), new Uint8Array(32))))) win++;
    log(`starter Knight vs ${['Knight', 'Rogue', 'Mage'][gg.cls]} L${gg.level} ghost: ${win}/${N} styles winnable (${(100 * win / N).toFixed(1)}%) -> a grinder needs ~${win ? Math.ceil(N / win) : 'inf'} local txid tries (no broadcast, no fee)`);
  }
}

log(`\nTOTAL: ${pass} pass, ${fail} fail`);
fs.writeFileSync('evaluate-output.txt', out.join('\n') + '\n');
