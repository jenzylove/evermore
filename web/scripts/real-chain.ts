// Headless chipnet run of RealChain (the class the web client uses), end to end:
// fund a Satchel from a local "home wallet" key (signs like WizardConnect: only its own
// inputs, ALL|UTXOS|FORKID), raise, challenge an existing ghost until the style is winnable,
// forge the win, list + cancel + list, a second Satchel buys, send home, bring back.
//
//   node scripts/real-chain.ts            (chipnet only; keys stay outside the repo)
//
// EVERMORE_WALLET_KEY_FILE  home wallet WIF (default: the chipnet deployer key)
// EVERMORE_SATCHEL_FILE     where the test Satchel WIF is kept (created if missing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignatureTemplate } from 'cashscript';
import { encodeTransaction, binToHex } from '@bitauth/libauth';
import * as E from '../../sdk/src/index.ts';
import { RealChain, type HomeWallet, type KV } from '../src/chain/realChain.ts';

const NET = 'chipnet' as const;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dep = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'deployments', `${NET}.json`), 'utf8'));
const KEYS = 'C:\\Users\\LENOVO\\relic-launch\\keys';
const walletWif = fs.readFileSync(process.env.EVERMORE_WALLET_KEY_FILE ?? path.join(KEYS, 'evermore-chipnet-deployer.wif'), 'utf8').trim();
const satchelFile = (n: string) => process.env.EVERMORE_SATCHEL_FILE ?? path.join(KEYS, `evermore-chipnet-test-${n}.wif`);
const loadSatchel = (n: string) => {
  const f = satchelFile(n);
  if (fs.existsSync(f)) return E.Satchel.fromWif(fs.readFileSync(f, 'utf8').trim());
  const s = E.Satchel.generate(); fs.writeFileSync(f, s.toWif(NET)); return s;
};

/** A home wallet backed by one local key: what Selene / Cashonize do over WizardConnect. */
function localWallet(wif: string): HomeWallet {
  const k = E.Satchel.fromWif(wif);
  const key = { path: 'receive', index: 0, publicKey: k.publicKey, lock: k.lock, address: k.address(NET) };
  return {
    name: 'Test wallet', net: NET,
    keys: () => [key], receiveLock: () => k.lock, changeLock: () => k.lock,
    async sign(built) {
      const tx = structuredClone(built.transaction);
      const sourceOutputs = built.sourceOutputs.map((s) => ({ ...s }));
      for (const i of built.walletInputs) {
        const ctx = { transaction: tx, sourceOutputs, inputIndex: i } as any;
        tx.inputs[i].unlockingBytecode = new SignatureTemplate(k.privateKey).unlockP2PKH().generateUnlockingBytecode(ctx);
      }
      return binToHex(encodeTransaction(tx));
    },
  };
}
const mem = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

const log: string[] = [];
const onBroadcast = (kind: string, _t: string, link: string) => { const l = `${kind.padEnd(11)} ${link}`; log.push(l); console.log(l); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wallet = localWallet(walletWif);
  const seller = new RealChain({ deployment: dep, net: NET, satchel: loadSatchel('satchel'), storage: mem(), wallet, onBroadcast });
  const buyer = new RealChain({ deployment: dep, net: NET, satchel: loadSatchel('buyer'), storage: mem(), wallet, onBroadcast });
  console.log(`seller satchel ${seller.satchelKey.address(NET)}\nbuyer satchel  ${buyer.satchelKey.address(NET)}`);

  // 1. fund both Satchels from the home wallet (wallet signed)
  for (const [c, want] of [[seller, 200_000], [buyer, 60_000]] as const) {
    const s = await c.satchel();
    if (s.sats < want) { await c.fund(want - s.sats + 5000); await sleep(1200); }
  }
  console.log('satchels', (await seller.satchel()).sats, (await buyer.satchel()).sats);

  // 2. raise
  const { hero } = await seller.raise(0, 'Ashgrove');
  console.log(`raised #${hero.id} ${hero.name} L${hero.level}`);
  await sleep(1200);

  // 3. challenge an existing ghost until its style is winnable (each try is a paid challenge)
  const ghosts = await seller.listGhosts();
  console.log('arena:', ghosts.map((g) => `#${g.id} ${g.name} L${g.level} d${g.defences} b${g.beaten} ${g.owner}`).join(' | '));
  const target = ghosts.find((g) => g.id === 8) ?? ghosts.find((g) => g.id === 13) ?? ghosts.find((g) => !g.mine)!;
  let ticket = null, moves: number[] | null = null;
  for (let i = 0; i < 10 && !moves; i++) {
    const g = (await seller.listGhosts()).find((x) => x.id === target.id)!;
    const preview = E.solve(hero, g, E.seedOf(E.seedHash(hero.id, g.id, g.beaten, g.defences)));
    ticket = await seller.challenge(hero.id, target.id);
    moves = E.solve(hero, ticket.ghost, ticket.seed);
    console.log(`challenge vs #${target.id}: seed ${ticket.seed}, ${moves ? `win in ${moves.length}` : 'not winnable'} (preview said ${preview ? 'win' : 'no'})`);
    await sleep(1200);
  }
  if (!moves || !ticket) throw new Error('no winnable style');

  // 4. forge
  const f = await seller.forge(ticket, moves);
  console.log(`forged: #${f.hero.id} L${f.hero.level} xp ${f.hero.xp} (+${f.xpGain}) wins ${f.hero.wins} levelled ${f.levelled} gear ${f.gear ? JSON.stringify(f.gear) : 'none'}`);
  await sleep(1500);

  // 5. list, cancel, list again; the buyer buys
  await seller.list('hero', hero.id, 20_000); await sleep(1500);
  let mine = (await seller.listings()).find((l) => l.hero?.id === hero.id)!;
  console.log(`listed ${mine.id} for ${mine.priceSats}, mine=${mine.mine}`);
  await seller.cancel(mine.id); await sleep(1500);
  console.log('after cancel, in satchel:', (await seller.myHeroes()).some((h) => h.id === hero.id && h.where === 'satchel'));
  await seller.list('hero', hero.id, 20_000); await sleep(1500);
  const offer = (await buyer.listings()).find((l) => l.hero?.id === hero.id)!;
  console.log(`buyer sees ${offer.id} by ${offer.seller} at ${offer.priceSats}`);
  await buyer.buy(offer.id); await sleep(1500);
  console.log('buyer holds it:', (await buyer.myHeroes()).find((h) => h.id === hero.id)?.where);

  // 6. send home (Satchel signed) and bring back (wallet signed)
  await buyer.sendHome(hero.id); await sleep(1500);
  console.log('after send home:', (await buyer.myHeroes()).find((h) => h.id === hero.id)?.where);
  await buyer.sendHome(hero.id); await sleep(1500);
  console.log('after bring back:', (await buyer.myHeroes()).find((h) => h.id === hero.id)?.where);

  console.log('earnings (seller):', await seller.earnings());
  console.log('satchels', (await seller.satchel()).sats, (await buyer.satchel()).sats);
  console.log('\nTXIDS\n' + log.join('\n'));
  await seller.close(); await buyer.close();
}
/** Second stage: the buyer's hero wins again and levels up (own ghost re-levelled, owner moves to the buyer). */
async function levelUp() {
  const buyer = new RealChain({ deployment: dep, net: NET, satchel: loadSatchel('buyer'), storage: mem(), wallet: localWallet(walletWif), onBroadcast });
  const hero = (await buyer.myHeroes()).filter((h) => h.where === 'satchel').sort((a, b) => b.xp - a.xp)[0];
  if (!hero) throw new Error('buyer has no hero in the Satchel');
  console.log(`hero #${hero.id} L${hero.level} xp ${hero.xp}/${20 * hero.level}`);
  for (let i = 0; i < 6; i++) {
    const gs = (await buyer.listGhosts()).filter((g) => g.id !== hero.id);
    const pick = gs.map((g) => ({ g, mv: E.solve(hero, g, buyer.styleSeed(hero.id, g), 7) })).find((x) => x.mv);
    if (!pick) throw new Error('no winnable ghost right now');
    const t = await buyer.challenge(hero.id, pick.g.id); await sleep(1200);
    const mv = E.solve(hero, t.ghost, t.seed);
    if (!mv) { console.log('style moved under us; trying again'); continue; }
    const f = await buyer.forge(t, mv);
    console.log(`forged vs #${pick.g.id}: L${hero.level} -> L${f.hero.level}, xp ${f.hero.xp}, +${f.xpGain}, levelled ${f.levelled}`);
    const own = (await buyer.listGhosts()).find((g) => g.id === hero.id)!;
    console.log(`own ghost #${own.id} now L${own.level}, owner ${own.owner}`);
    if (f.levelled) break;
    Object.assign(hero, f.hero); await sleep(1500);
  }
  console.log('\nTXIDS\n' + log.join('\n'));
  await buyer.close();
}
(process.argv[2] === 'levelup' ? levelUp() : main()).catch((e) => { console.error(e); console.log('\nTXIDS\n' + log.join('\n')); process.exit(1); });
