import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash256, binToHex, hexToBin } from '@bitauth/libauth';
import * as E from '../src/index.ts';

const params = { category: binToHex(hash256(Uint8Array.of(1))), treasuryPkh: '11'.repeat(20), raisePrice: 50000n, challengeFee: 4000n, forgeFee: 2000n, gearCap: 5000n };
const game = E.makeGame(params, 'chipnet');
const sat = E.Satchel.generate();
const lane: E.Utxo = {
  txid: binToHex(hash256(Uint8Array.of(2))), vout: 1, satoshis: 1000n, lockingBytecode: game.laneLock,
  token: { category: game.categoryBin, amount: 0n, nft: { capability: 'minting', commitment: E.encodeLane({ lane: 4, ctr: 2 }) } },
};
const coin = (v: bigint, n = 3): E.Utxo => ({ txid: binToHex(hash256(Uint8Array.of(n))), vout: 0, satoshis: v, lockingBytecode: sat.lock });

test('game: deterministic addresses per params and network', () => {
  const again = E.makeGame(params, 'chipnet');
  assert.equal(game.address(game.laneLock), again.address(again.laneLock));
  assert.match(game.address(game.arenaLock), /^bchtest:p/);
  assert.match(E.makeGame(params, 'mainnet').address(game.laneLock), /^bitcoincash:p/);
  const dep = { network: 'chipnet' as const, ...params, raisePrice: '50000', challengeFee: '4000', forgeFee: '2000', gearCap: '5000' };
  const g2 = E.gameFromDeployment(dep);
  assert.equal(g2.address(g2.laneLock), game.address(game.laneLock));
});

test('raise: built from a Satchel, passes the 2026 VM, hero id = ctr * 16 + lane', () => {
  const { draft, hero } = E.raiseDraft(game, lane, 2, sat.lock);
  assert.equal(hero.id, 36);
  const b = E.finalize(draft, { funding: sat.inputs([coin(200000n)]), changeLock: sat.lock });
  assert.equal(E.verify(b), true);
  assert.equal(b.walletInputs.length, 0);
  assert.ok(b.fee >= BigInt(b.size) && b.fee < BigInt(b.size) + 600n, `fee ${b.fee} for ${b.size} B`);
});

test('finalize: picks largest coins first, throws InsufficientFunds when short', () => {
  const { draft } = E.raiseDraft(game, lane, 0, sat.lock);
  const b = E.finalize(draft, { funding: sat.inputs([coin(1000n, 4), coin(60000n, 5), coin(3000n, 6)]), changeLock: sat.lock });
  assert.equal(b.inputs.length, 2);
  assert.throws(() => E.finalize(draft, { funding: sat.inputs([coin(1000n, 7)]) }), E.InsufficientFunds);
});

test('listing tag encodes and decodes; bazaar beacon is a P2PKH', () => {
  const t = E.encodeListingTag(sat.pkh, 123456n);
  assert.deepEqual(E.decodeListingTag(t), { sellerPkh: sat.pkh, price: 123456n });
  assert.equal(E.decodeListingTag(Uint8Array.of(0x6a)), null);
  assert.equal(E.isP2pkh(game.bazaarLock), true);
});

test('chain: conflict detection and lane picking', () => {
  for (const m of ['txn-mempool-conflict (code 18)', 'Missing inputs', 'bad-txns-inputs-missingorspent']) assert.ok(E.CONFLICT.test(m), m);
  assert.ok(!E.CONFLICT.test('min relay fee not met'));
  const ls = [0, 1, 2].map((n) => ({ lane: { lane: n, ctr: 0 } }));
  assert.equal(E.pickLane(ls, [0, 1]).lane.lane, 2);
  assert.ok([0, 1, 2].includes(E.pickLane(ls, [0, 1, 2]).lane.lane));
});

test('chain: submit retries on conflict and rebuilds, but not on other errors', async () => {
  const c = new E.Chain('chipnet');
  let n = 0;
  (c as any).broadcast = async () => { n++; if (n < 3) throw new Error('txn-mempool-conflict'); return 'ab'.repeat(32); };
  const r = await c.submit(() => ({ hex: '00' }) as any);
  assert.equal(r.attempts, 3);
  (c as any).broadcast = async () => { throw new Error('dust'); };
  await assert.rejects(c.submit(() => ({ hex: '00' }) as any), /dust/);
});

test('wallet: Satchel WIF round trip and token address', () => {
  const s = E.Satchel.fromWif(sat.toWif('chipnet'));
  assert.deepEqual(s.pkh, sat.pkh);
  assert.match(sat.tokenAddress('chipnet'), /^bchtest:z/);
});

test('bcmr: registry and OP_RETURN', () => {
  const reg = E.buildRegistry({ category: params.category, artBase: 'https://example.org/art', web: 'https://example.org', timestamp: '2026-11-17T00:00:00.000Z' });
  const op = E.bcmrOpReturn(new TextEncoder().encode(JSON.stringify(reg)), 'https://example.org/bcmr.json');
  assert.equal(binToHex(op.lock.slice(0, 7)), '6a0442434d5220');
  assert.equal(hexToBin(op.sha256).length, 32);
});

test('live chipnet Fulcrum read (set EVERMORE_LIVE=1)', { skip: !process.env.EVERMORE_LIVE }, async () => {
  const c = new E.Chain('chipnet');
  const server = await c.connect();
  const tip = await c.tip();
  assert.ok(tip > 100000, `tip ${tip} from ${server}`);
  assert.deepEqual(await c.utxos(game.bazaarLock), []);
  await c.disconnect();
});
