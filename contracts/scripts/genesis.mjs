// Evermore genesis (chipnet only).
//
//   node scripts/genesis.mjs            status: deployer address, balance, deployment
//   node scripts/genesis.mjs run        prep tx + genesis tx (16 lanes, 1 counter, BCMR hook)
//   node scripts/genesis.mjs run --dry  build + VM verify only (fabricated coin if unfunded)
//   node scripts/genesis.mjs bcmr       publish a new BCMR OP_RETURN from the authhead
//
// Deployer key: env EVERMORE_DEPLOYER_WIF, else the file at EVERMORE_KEY_FILE (default
// C:\Users\LENOVO\relic-launch\keys\evermore-chipnet-deployer.wif, outside git). Generated if
// missing. The WIF is never printed.
//
// Env (all optional): TREASURY_PKH (hex, default deployer), RAISE_PRICE (50000),
// CHALLENGE_FEE (4000), FORGE_FEE (2000), GEAR_CAP (5000), BCMR_URL (where the registry
// will be hosted byte exact, e.g. https://evermore.example/bcmr.json), BCMR_ART_BASE,
// BCMR_WEB, FEE_RATE (1).
//
// Authchain (BCMR): category = prep txid = authbase. Genesis spends prep:0 and pays its
// output 0 (1,000 sats) back to the deployer: that is the authhead. Never spend it except
// through `bcmr` (which keeps output 0 at the deployer).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binToHex, hexToBin, utf8ToBin } from '@bitauth/libauth';
import * as E from '@evermore/sdk';

const NET = process.env.EVERMORE_NETWORK ?? 'chipnet';
if (NET !== 'chipnet') {
  console.error(`Refusing to run on ${NET}: this script deploys to chipnet only. Mainnet deploy is a separate, owner approved step.`);
  process.exit(1);
}
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const depFile = path.join(root, 'deployments', `${NET}.json`);
const regFile = path.join(root, 'deployments', `bcmr-${NET}.json`);
const KEY_FILE = process.env.EVERMORE_KEY_FILE ?? 'C:\\Users\\LENOVO\\relic-launch\\keys\\evermore-chipnet-deployer.wif';
const FEE_RATE = Number(process.env.FEE_RATE ?? 1);
const FAUCETS = ['https://tbch.googol.cash', 'https://chipnet.bch.ninja'];

function loadKey() {
  if (process.env.EVERMORE_DEPLOYER_WIF) return { satchel: E.Satchel.fromWif(process.env.EVERMORE_DEPLOYER_WIF.trim()), source: 'env EVERMORE_DEPLOYER_WIF' };
  if (fs.existsSync(KEY_FILE)) return { satchel: E.Satchel.fromWif(fs.readFileSync(KEY_FILE, 'utf8').trim()), source: KEY_FILE };
  const s = E.Satchel.generate();
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, s.toWif(NET) + '\n', { mode: 0o600 });
  return { satchel: s, source: `${KEY_FILE} (new)` };
}

const readDep = () => (fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, 'utf8')) : null);
const link = (txid) => E.network(NET).explorerTx(txid);

async function main() {
  const mode = process.argv[2] ?? 'status';
  const { satchel: dk, source } = loadKey();
  const chain = new E.Chain(NET);
  const server = await chain.connect();
  const coins = (await chain.coins(dk.lock));
  const dep = readDep();
  const authhead = dep?.authhead;
  const spendable = coins.filter((c) => !(authhead && c.txid === authhead.txid && c.vout === authhead.vout));
  let bal = spendable.reduce((a, c) => a + c.satoshis, 0n);
  console.log(`network      ${NET} via ${server}`);
  console.log(`deployer     ${dk.address(NET)}   (key: ${source})`);
  console.log(`balance      ${bal} sats in ${spendable.length} coin(s)${authhead ? ' (authhead excluded)' : ''}`);
  if (dep) console.log(`deployment   category ${dep.category}\n             genesis ${link(dep.genesisTxid)}`);

  if (mode === 'status') {
    if (!dep && bal === 0n) console.log(`\nFund the deployer from a chipnet faucet (${FAUCETS.join(' or ')}), then run: node scripts/genesis.mjs run`);
    await chain.disconnect();
    return;
  }

  if (mode === 'run') {
    // --dry: build and VM verify both transactions (with a fabricated coin if unfunded), broadcast nothing, write nothing
    const dry = process.argv.includes('--dry');
    if (dry && bal === 0n) { spendable.push({ txid: 'ee'.repeat(32), vout: 3, satoshis: 100000n, lockingBytecode: dk.lock }); bal = 100000n; }
    if (dep?.genesisTxid && !dry && !process.argv.includes('--force')) throw new Error(`already deployed (${dep.genesisTxid}); pass --force to make a new game`);
    const need = 16n * 1000n + 1000n + 1000n + 6000n;
    if (bal < need) {
      console.log(`\nNeed at least ${need} sats. Fund ${dk.address(NET)} from ${FAUCETS.join(' or ')} and run again.`);
      await chain.disconnect();
      process.exitCode = 2;
      return;
    }
    // 1. prep: sweep every deployer coin to output 0 (its txid becomes the category / authbase)
    const prep = E.satchelWithdraw(dk, spendable, dk.lock, undefined, FEE_RATE);
    const pv = E.verify(prep); if (pv !== true) throw new Error(`prep fails the VM: ${pv}`);
    const category = prep.txid;
    const params = {
      category,
      treasuryPkh: process.env.TREASURY_PKH ?? binToHex(dk.pkh),
      raisePrice: BigInt(process.env.RAISE_PRICE ?? 50000),
      challengeFee: BigInt(process.env.CHALLENGE_FEE ?? 4000),
      forgeFee: BigInt(process.env.FORGE_FEE ?? 2000),
      gearCap: BigInt(process.env.GEAR_CAP ?? 5000),
    };
    const game = E.makeGame(params, NET);
    const cat = hexToBin(category);
    const tok = (capability, commitment) => ({ category: cat, amount: 0n, nft: { capability, commitment } });

    // 2. BCMR registry (category now known); hash committed on chain, file hosted later byte exact
    const registry = E.buildRegistry({
      category,
      artBase: process.env.BCMR_ART_BASE ?? 'https://evermore.example/art',
      web: process.env.BCMR_WEB ?? 'https://evermore.example',
    });
    const regBytes = utf8ToBin(JSON.stringify(registry, null, 2) + '\n');
    const bcmr = process.env.BCMR_URL ? E.bcmrOpReturn(regBytes, process.env.BCMR_URL) : null;

    // 3. genesis: spends prep:0; out 0 authhead, 1..16 lanes, 17 counter, [18 BCMR], change
    const outputs = [
      { lockingBytecode: dk.lock, valueSatoshis: 1000n },
      ...Array.from({ length: 16 }, (_, n) => ({ lockingBytecode: game.laneLock, valueSatoshis: E.TOKEN_SATS, token: tok('minting', E.encodeLane({ lane: n, ctr: 0 })) })),
      { lockingBytecode: game.counterLock, valueSatoshis: E.TOKEN_SATS, token: tok('none', E.encodeCounter(0)) },
      ...(bcmr ? [{ lockingBytecode: bcmr.lock, valueSatoshis: 0n }] : []),
    ];
    const genesis = E.finalize({ kind: 'genesis', inputs: dk.inputs([E.utxoOf(prep, 0)]), outputs }, { changeLock: dk.lock, feeRate: FEE_RATE });
    const gv = E.verify(genesis); if (gv !== true) throw new Error(`genesis fails the VM: ${gv}`);
    const mintingOuts = genesis.outputs.filter((o) => o.token?.nft?.capability === 'minting');
    if (mintingOuts.length !== 16 || !mintingOuts.every((o) => binToHex(o.lockingBytecode) === binToHex(game.laneLock))) throw new Error('genesis must mint exactly 16 lanes and nothing else with minting');

    console.log(`\nprep     ${prep.txid} (${prep.size} B), VM ok`);
    console.log(`genesis  ${genesis.txid} (${genesis.size} B, ${genesis.outputs.length} outputs), VM ok`);
    console.log(`lane     ${game.address(game.laneLock)}\narena    ${game.address(game.arenaLock)}\ncounter  ${game.address(game.counterLock)}`);
    if (dry) { console.log('\n--dry: nothing broadcast, nothing written'); await chain.disconnect(); return; }
    fs.mkdirSync(path.dirname(regFile), { recursive: true });
    fs.writeFileSync(regFile, regBytes);
    const p = await chain.broadcast(prep.hex);
    console.log(`         broadcast ${link(p)}`);
    const g = await chain.broadcast(genesis.hex);
    console.log(`genesis  broadcast ${link(g)}`);

    const deployment = {
      network: NET, category, treasuryPkh: params.treasuryPkh,
      raisePrice: String(params.raisePrice), challengeFee: String(params.challengeFee), forgeFee: String(params.forgeFee), gearCap: String(params.gearCap),
      authbaseTxid: prep.txid, genesisTxid: genesis.txid,
      authhead: { txid: genesis.txid, vout: 0 },
      deployer: dk.address(NET),
      addresses: { lane: game.address(game.laneLock), arena: game.address(game.arenaLock), counter: game.address(game.counterLock), bazaar: game.address(game.bazaarLock), treasury: game.address(game.treasuryLock) },
      lanes: Array.from({ length: 16 }, (_, n) => ({ lane: n, txid: genesis.txid, vout: n + 1 })),
      counter: { txid: genesis.txid, vout: 17 },
      bcmr: bcmr ? { url: process.env.BCMR_URL, sha256: bcmr.sha256, file: path.relative(root, regFile) } : null,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(depFile, JSON.stringify(deployment, null, 2) + '\n');
    console.log(`\nwrote ${path.relative(root, depFile)}${bcmr ? ` and ${path.relative(root, regFile)} (host it byte exact at ${process.env.BCMR_URL})` : ` and ${path.relative(root, regFile)} (no BCMR_URL: publish later with "bcmr")`}`);
    await chain.disconnect();
    return;
  }

  if (mode === 'bcmr') {
    if (!dep) throw new Error('no deployment yet');
    const url = process.env.BCMR_URL;
    if (!url) throw new Error('set BCMR_URL to where the registry is hosted');
    const file = process.env.BCMR_FILE ?? regFile;
    const bytes = new Uint8Array(fs.readFileSync(file));
    const op = E.bcmrOpReturn(bytes, url);
    const head = coins.find((c) => c.txid === dep.authhead.txid && c.vout === dep.authhead.vout);
    if (!head) throw new Error(`authhead ${dep.authhead.txid}:${dep.authhead.vout} is not unspent at the deployer`);
    // authhead must be input 0 and output 0 must return to the deployer to keep the chain
    const b = E.finalize({ kind: 'bcmr', inputs: dk.inputs([head]), outputs: [{ lockingBytecode: dk.lock, valueSatoshis: 1000n }, { lockingBytecode: op.lock, valueSatoshis: 0n }] },
      { funding: dk.inputs(spendable), changeLock: dk.lock, feeRate: FEE_RATE });
    const v = E.verify(b); if (v !== true) throw new Error(v);
    const id = await chain.broadcast(b.hex);
    dep.authhead = { txid: id, vout: 0 };
    dep.bcmr = { url, sha256: op.sha256, file: path.relative(root, file) };
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2) + '\n');
    console.log(`bcmr published ${link(id)} sha256 ${op.sha256}`);
    await chain.disconnect();
    return;
  }
  throw new Error(`unknown mode ${mode} (status | run | bcmr)`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
