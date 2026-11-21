// SaleToken: heroes and gear priced in PUSD (a fungible CashToken, 2 decimals). The tests use
// a stand in PUSD category on a test game; mainnet uses ParyonUSD's real category.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binToHex, hash256, hexToBin } from '@bitauth/libauth';
import { E, PARAMS, nft, X, seller, buyer, U, run, valid, rejected, signed } from './helpers.mjs';

const PUSD = binToHex(hash256(Uint8Array.of(0x50, 0x55, 0x53, 0x44))); // display order
const OTHER = binToHex(hash256(Uint8Array.of(0x4f, 0x54, 0x48)));
const g = E.makeGame({ ...PARAMS, pusdCategory: PUSD }, 'chipnet');
const O = (lockingBytecode, v, token) => ({ lockingBytecode, valueSatoshis: BigInt(v), ...(token ? { token } : {}) });
const ft = (amount, cat = PUSD) => ({ category: hexToBin(cat), amount: BigInt(amount) });

const PRICE = 250n; // $2.50
const saleLock = hexToBin(g.saleToken(seller.pkh, PRICE).lockingBytecode);
const hero = E.starterHero(5, 1);
const listed = U(saleLock, 1000, nft('none', E.encodeHero(hero)));
const L = (utxo = listed) => ({ utxo, sellerPkh: seller.pkh, price: PRICE, currency: 'pusd' });
const pusdIn = (amount, cat = PUSD) => signed(U(buyer.lock, 1000, ft(amount, cat)), buyer);

test('list in PUSD: hero to SaleToken, EVR2 tag that decodes back with its currency', () => {
  const { draft, saleLock: sl } = E.listDraft(g, signed(U(seller.lock, 1000, nft('none', E.encodeHero(hero))), seller), seller.pkh, PRICE, 'pusd');
  const r = run(draft, seller);
  valid(r);
  assert.deepEqual(sl, saleLock);
  assert.deepEqual(E.decodeListingTag(r.built.outputs[2].lockingBytecode), { sellerPkh: seller.pkh, price: PRICE, currency: 'pusd' });
  // a BCH listing of the same price lives at a different address
  assert.notEqual(g.sale(seller.pkh, PRICE).lockingBytecode, g.saleToken(seller.pkh, PRICE).lockingBytecode);
});
test('buy with exact PUSD: seller gets $2.50 at the same index, hero to buyer, no PUSD change', () => {
  const r = run(E.buyDraft(g, [L()], buyer.lock, [pusdIn(250)]), buyer);
  valid(r);
  assert.equal(r.built.outputs[0].token.amount, 250n);
  assert.equal(r.built.outputs.filter((o) => o.token && !o.token.nft).length, 1);
});
test('buy with more PUSD than the price: the rest comes back to the buyer', () => {
  const r = run(E.buyDraft(g, [L()], buyer.lock, [pusdIn(100), pusdIn(300)]), buyer);
  valid(r);
  const change = r.built.outputs.find((o) => o.token && !o.token.nft && o.lockingBytecode.every((b, i) => b === buyer.lock[i]));
  assert.equal(change.token.amount, 150n);
});
test('buy a PUSD hero and a BCH hero together', () => {
  const bchLock = hexToBin(g.sale(seller.pkh, 40000n).lockingBytecode);
  const bchListed = U(bchLock, 1000, nft('none', E.encodeGear({ id: 1, kind: 0, tier: 3 })));
  valid(run(E.buyDraft(g, [L(), { utxo: bchListed, sellerPkh: seller.pkh, price: 40000n }], buyer.lock, [pusdIn(250)]), buyer));
});
test('sdk refuses too little PUSD, another token, or an NFT as payment', () => {
  assert.throws(() => E.buyDraft(g, [L()], buyer.lock, [pusdIn(249)]), /not enough PUSD/);
  assert.throws(() => E.buyDraft(g, [L()], buyer.lock, [pusdIn(1000, OTHER)]), /only plain PUSD/);
  assert.throws(() => E.buyDraft(g, [L()], buyer.lock, []), /not enough PUSD/);
});
test('buy rejected: 1 cent short', () => rejected(run(E.buyDraft(g, [L()], buyer.lock, [pusdIn(250)]), buyer, {
  mut: (d) => { d.outputs[0] = O(seller.lock, 1000, ft(249)); d.outputs.push(O(buyer.lock, 1000, ft(1))); },
})));
test('buy rejected: paid in another token', () => rejected(run(E.buyDraft(g, [L()], buyer.lock, [pusdIn(250)]), buyer, {
  mut: (d) => { d.inputs[1] = pusdIn(250, OTHER); d.outputs[0] = O(seller.lock, 1000, ft(250, OTHER)); },
})));
test('buy rejected: paid in plain BCH instead of PUSD', () => rejected(run(E.buyDraft(g, [L()], buyer.lock, [pusdIn(250)]), buyer, {
  mut: (d) => { d.outputs[0] = O(seller.lock, 500000); d.outputs.push(O(buyer.lock, 1000, ft(250))); },
})));
test('buy rejected: PUSD paid to someone else', () => rejected(run(E.buyDraft(g, [L()], buyer.lock, [pusdIn(250)]), buyer, {
  mut: (d) => { d.outputs[0] = O(X.lock, 1000, ft(250)); },
})));
test('buy rejected: two PUSD listings settled by one payment', () => {
  const second = U(saleLock, 1000, nft('none', E.encodeHero(E.starterHero(6, 2))));
  rejected(run(E.buyDraft(g, [L(), L(second)], buyer.lock, [pusdIn(500)]), buyer, {
    mut: (d) => { d.outputs = [O(seller.lock, 1000, ft(250)), O(buyer.lock, 1000, listed.token), O(buyer.lock, 1000, second.token), O(buyer.lock, 1000, ft(250))]; },
  }));
});
test('cancel a PUSD listing by the seller; someone else cannot', () => {
  valid(run(E.cancelDraft(g, L(), seller.k, seller.pub, seller.lock), seller));
  rejected(run(E.cancelDraft(g, L(), X.k, X.pub, X.lock), X));
});
test('a game without PUSD refuses PUSD listings', () => {
  const noPusd = E.makeGame(PARAMS, 'chipnet');
  assert.throws(() => noPusd.saleToken(seller.pkh, PRICE), /PUSD is not available/);
});
