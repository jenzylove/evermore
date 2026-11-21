// Sale (list, buy, cancel) and the wallet constraints from spike S2: every commitment a
// connected wallet signs over is <= 40 bytes, wallets sign only their own inputs with
// ALL|UTXOS|FORKID, and our builders keep source outputs exact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignatureTemplate, SighashType } from 'cashscript';
import { binToHex, hexToBin, encodeTransaction, createVirtualMachineBch2026 } from '@bitauth/libauth';
import { E, game, CAT, nft, A, B, X, seller, buyer, lanes, U, run, raise, valid, rejected, signed } from './helpers.mjs';

const O = (lockingBytecode, v, token) => ({ lockingBytecode, valueSatoshis: BigInt(v), ...(token ? { token } : {}) });
const PRICE = 300000n;
const sale = game.sale(seller.pkh, PRICE);
const saleLock = hexToBin(sale.lockingBytecode);
const hero7 = { ...E.starterHero(3, 0), level: 7 };
const listedHero = U(saleLock, 1000, nft('none', E.encodeHero(hero7)));
const listedGear = U(saleLock, 1000, nft('none', E.encodeGear({ id: 2, kind: 1, tier: 4 })));
const L = (utxo) => ({ utxo, sellerPkh: seller.pkh, price: PRICE });

test('list: hero to Sale(sellerPkh, price), bazaar dust, EVR1 tag that decodes back', () => {
  const heroUtxo = U(seller.lock, 1000, nft('none', E.encodeHero(hero7)));
  const { draft, saleLock: sl } = E.listDraft(game, signed(heroUtxo, seller), seller.pkh, PRICE);
  const r = run(draft, seller);
  valid(r);
  assert.deepEqual(sl, saleLock);
  assert.deepEqual(r.built.outputs[1].lockingBytecode, game.bazaarLock);
  const tag = E.decodeListingTag(r.built.outputs[2].lockingBytecode);
  assert.deepEqual(tag, { sellerPkh: seller.pkh, price: PRICE, currency: 'bch' });
  assert.throws(() => E.listDraft(game, signed(U(seller.lock, 1000, nft('none', E.encodeTicket(E.ticketFor(1, E.ghostOf(hero7, X.pkh))))), seller), seller.pkh, PRICE), /heroes and gear/);
});
test('buy hero: seller paid at the same index, hero to buyer', () => valid(run(E.buyDraft(game, [L(listedHero)], buyer.lock), buyer)));
test('buy gear', () => valid(run(E.buyDraft(game, [L(listedGear)], buyer.lock), buyer)));
test('buy two listings with two payments', () => valid(run(E.buyDraft(game, [L(listedHero), L(listedGear)], buyer.lock), buyer)));
test('buy rejected: 1 sat short', () => rejected(run(E.buyDraft(game, [L(listedHero)], buyer.lock), buyer, { mut: (d) => { d.outputs[0] = O(seller.lock, PRICE - 1n); } })));
test('buy rejected: payment to someone else', () => rejected(run(E.buyDraft(game, [L(listedHero)], buyer.lock), buyer, { mut: (d) => { d.outputs[0] = O(X.lock, PRICE); } })));
test('buy rejected: payment output carries the token', () => rejected(run(E.buyDraft(game, [L(listedHero)], buyer.lock), buyer, { mut: (d) => { d.outputs = [O(seller.lock, PRICE, listedHero.token)]; } })));
test('buy rejected: two listings with one payment', () => rejected(run(E.buyDraft(game, [L(listedHero), L(listedGear)], buyer.lock), buyer, {
  mut: (d) => { d.outputs = [O(seller.lock, PRICE), O(buyer.lock, 1000, listedHero.token), O(buyer.lock, 1000, listedGear.token)]; },
})));
test('cancel by seller', () => valid(run(E.cancelDraft(game, L(listedHero), seller.k, seller.pub, seller.lock), seller)));
test('cancel rejected: someone else', () => rejected(run(E.cancelDraft(game, { ...L(listedHero) }, X.k, X.pub, X.lock), X)));
test('cancel rejected: seller pubkey, another key signs', () => rejected(run(E.cancelDraft(game, L(listedHero), X.k, seller.pub, X.lock), X)));

// ---------------------------------------------------------------- wallet constraints
test('every game commitment is <= 40 bytes (Selene signing limit)', () => {
  const g = E.ghostOf({ ...E.starterHero(2 ** 30, 2), level: 127, xp: 2 ** 30, hp: 32767, atk: 32767, def: 32767, spd: 32767, wins: 2 ** 30 }, X.pkh, 32767, 32767);
  const sizes = {
    lane: E.encodeLane({ lane: 15, ctr: 2 ** 27 }).length,
    hero: E.encodeHero({ ...E.starterHero(1, 0), wins: 5 }).length,
    ghost: E.encodeGhost(g).length,
    ticket: E.encodeTicket(E.ticketFor(1, g)).length,
    counter: E.encodeCounter(4999).length,
    gear: E.encodeGear({ id: 1, kind: 2, tier: 9 }).length,
  };
  assert.deepEqual(sizes, { lane: 6, hero: 23, ghost: 39, ticket: 23, counter: 5, gear: 7 });
  for (const v of Object.values(sizes)) assert.ok(v <= E.WALLET_MAX_COMMITMENT);
});
test('assertWalletSignable refuses a 41 byte commitment in any source output', () => {
  const big = U(A.lock, 1000, nft('none', new Uint8Array(41)));
  assert.throws(() => E.finalize({ kind: 'x', inputs: [{ utxo: big, unlock: { type: 'wallet', walletPath: { path: 'receive', index: 0 } } }], outputs: [O(A.lock, 1000, big.token)] },
    { funding: [{ utxo: U(A.lock, 50000), unlock: { type: 'wallet', walletPath: { path: 'receive', index: 0 } } }], changeLock: A.lock }), /40/);
});

/** Simulated WizardConnect wallet: signs only inputPaths with ALL|UTXOS|FORKID (0x61). */
function walletSign(built, req, keyOf) {
  const tx = structuredClone(built.transaction);
  for (const [idx] of req.inputPaths) {
    const ctx = { transaction: tx, sourceOutputs: built.sourceOutputs, inputIndex: idx };
    tx.inputs[idx].unlockingBytecode = new SignatureTemplate(keyOf(idx).k, SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS).unlockP2PKH().generateUnlockingBytecode(ctx);
  }
  return binToHex(encodeTransaction(tx));
}
const wIn = (utxo, index = 0) => E.walletInput(utxo, { path: 'receive', index });

test('wallet buys a listing (Selene funds, Sale covenant input untouched), request format matches hdwalletv1', () => {
  const built = E.finalize(E.buyDraft(game, [L(listedHero)], buyer.lock), { funding: [wIn(U(buyer.lock, 500000))], changeLock: buyer.lock });
  const req = E.toSignRequest(built, 'Evermore: buy hero #3');
  assert.deepEqual(req.inputPaths, [[1, 'receive', 0]]);
  assert.equal(req.transaction.broadcast, false);
  assert.match(req.transaction.sourceOutputs[0].valueSatoshis, /^<bigint: \d+n>$/);
  assert.equal(req.transaction.sourceOutputs[0].token.nft.commitment.length, 46);
  const { hex } = E.acceptWalletSignature(built, walletSign(built, req, () => buyer));
  assert.ok(hex.length > 0);
});
test('wallet brings a hero back into the Satchel; Satchel sends it home (no wallet prompt)', () => {
  const satchel = E.Satchel.generate();
  const heroInWallet = U(buyer.lock, 1000, nft('none', E.encodeHero(hero7)));
  const { built, request } = E.bringBackRequest([wIn(heroInWallet)], [wIn(U(buyer.lock, 20000), 1)], satchel, buyer.lock);
  assert.deepEqual(request.inputPaths.map((p) => p[0]).sort(), [0, 1]);
  E.acceptWalletSignature(built, walletSign(built, request, () => buyer));
  const home = E.sendHome(satchel, [E.utxoOf(built, 0)], [U(satchel.lock, 5000)], buyer.lock);
  assert.equal(E.verify(home), true);
  assert.equal(home.walletInputs.length, 0);
});
test('wallet funds the Satchel; acceptWalletSignature rejects a wallet that touches a foreign input', () => {
  const satchel = E.Satchel.generate();
  const { built, request } = E.fundSatchelRequest([wIn(U(buyer.lock, 9000))], satchel, 2000n, buyer.lock);
  assert.equal(built.outputs[0].valueSatoshis, 2000n);
  assert.match(request.transaction.userPrompt, /Satchel/);
  E.acceptWalletSignature(built, walletSign(built, request, () => buyer));
  // mixed: a Satchel input + a wallet input; a wallet that rewrites the Satchel input is refused
  const mixed = E.finalize(E.payDraft(satchel.lock, 10000n), { funding: [...satchel.inputs([U(satchel.lock, 2000)]), wIn(U(buyer.lock, 9000))], changeLock: buyer.lock });
  const req = E.toSignRequest(mixed, 'x');
  const forged = structuredClone(mixed.transaction);
  forged.inputs.forEach((inp, i) => { if (!mixed.walletInputs.includes(i)) inp.unlockingBytecode = Uint8Array.of(0); });
  assert.throws(() => E.acceptWalletSignature({ ...mixed }, binToHex(encodeTransaction(forged))), /not its own|changed/);
  E.acceptWalletSignature(mixed, walletSign(mixed, req, () => buyer));
});
test('xpub derivation and network check', async () => {
  const { deriveHdPrivateNodeFromSeed, deriveHdPath, deriveHdPublicNode, encodeHdPublicKey } = await import('@bitauth/libauth');
  const seed = new Uint8Array(32).fill(7);
  const mk = (network) => {
    const root = deriveHdPrivateNodeFromSeed(seed, { assumeValidity: true });
    const node = deriveHdPath(root, "m/44'/145'/0'/0");
    return encodeHdPublicKey({ network, node: deriveHdPublicNode(node) }).hdPublicKey;
  };
  const keys = E.walletKeys('receive', mk('testnet'), 'chipnet', 3);
  assert.equal(keys.length, 3);
  assert.match(keys[0].address, /^bchtest:q/);
  E.assertWalletNetwork([mk('testnet')], 'chipnet');
  assert.throws(() => E.assertWalletNetwork([mk('mainnet')], 'chipnet'), /mainnet/);
});

test('BCMR parse bytecode yields type key tag+byte5 (hero class / gear kind) and the commitment as field', () => {
  const vm = createVirtualMachineBch2026(false);
  const parse = hexToBin(E.BCMR_PARSE_BYTECODE);
  for (const [commitment, key] of [[E.encodeHero({ ...hero7, cls: 2 }), '4802'], [E.encodeGear({ id: 9, kind: 1, tier: 3 }), '4501']]) {
    const src = { lockingBytecode: parse, valueSatoshis: 1000n, token: { category: CAT, amount: 0n, nft: { capability: 'none', commitment } } };
    const tx = { version: 2, locktime: 0, inputs: [{ outpointTransactionHash: new Uint8Array(32), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: Uint8Array.of() }], outputs: [{ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n }] };
    const st = vm.evaluate({ inputIndex: 0, sourceOutputs: [src], transaction: tx });
    assert.ok(st.error === undefined || /exactly 1/.test(String(st.error)), String(st.error)); // only the final clean stack rule, which parsing ignores
    assert.deepEqual(st.alternateStack.map(binToHex), [key, binToHex(commitment)]);
  }
});
