# Evermore: shared build spec

Source of truth for contracts, sdk and web. Proven in docs/spikes/s1-replay.md and docs/spikes/s3-paths.md (61 of 61 VM cases). Reference code: contracts/spike-ref/.

## Repo layout
- `contracts/` CashScript 0.14 sources (Lane, Arena, Counter, Sale), compiled artifacts, VM tests (libauth 3.1.0-next.8, BCH_2026 standard), genesis/deploy scripts for chipnet and mainnet.
- `sdk/` TypeScript: duel sim (pure), commitment encode/decode, tx builders for every path, chain reads (Fulcrum/Electrum over WebSocket), network config (chipnet | mainnet).
- `web/` the game client (Vite + TypeScript). Imports `sdk` only; never builds raw tx itself.

## Rules (from spikes, with one change)
- Moves: 2 bits each, 0 Strike, 1 Guard, 2 Special; 1 to 12 rounds; duel must end exactly at round n.
- Damage max(1, atk*mult - def/2), halved if target guards. Guard adds a charge. Special = double damage at 2 charges then resets, else acts as Strike. Higher SPD acts first; hero wins ties.
- **Ghost style seed (changed): hash256(heroId4 || ghostId4 || ghost beaten2 || ghost defences2) as read before the challenge.** No txid term. Players can preview the style; every new attempt is a paid challenge. Ticket keeps the snapshot fields needed for this seed instead of the salt.
- XP gain (10 + 5*ghostLevel + 10*hpLeft/maxHp + 12 - n) * 4/(4 + beaten). Level up at 20*level XP, class growth, max one level per forge, level cap 127.
- Starter stats (hp/atk/def/spd): Knight 60/10/8/4, Rogue 45/12/5/9, Mage 40/15/4/6.
- Gear drop when ticket ghost level >= hero level + 3, Counter hard cap (set in genesis, e.g. 5000).
- Fees (set at genesis, in sats, tuned to USD at BCH about $210, the same on chipnet and mainnet): raise 119,000 (about $0.25, treasury), challenge 9,500 (about 2 cents, to the ghost owner), forge 4,800 (about 1 cent, treasury), gear cap 5,000; each ghost locks 1,000 sats.

## Commitments (all <= 40 B: Selene refuses to sign over longer ones)
- Lane 6 B `'L' lane1 ctr4`; Hero 23 B `'H' id4 cls1 lvl1 xp4 hp2 atk2 def2 spd2 wins4`; Ghost 39 B `'G' id4 cls1 lvl1 hp2 atk2 def2 spd2 owner20 beaten2 defences2`; Ticket 23 B `'T' heroId4 ghostId4 cls1 lvl1 hp2 atk2 def2 spd2 beaten2 defences2`; Counter 5 B `'C' minted4`; Gear 7 B `'E' id4 kind1 tier1`.
- beaten and defences saturate at 32767 (covenant `min(x + 1, 32767)`).
- Wallet signing (WizardConnect, spike S2): wallets sign only `inputPaths` with sighash 0x61 and never broadcast (send `broadcast: false`, broadcast ourselves). The sdk asserts every source commitment <= 40 B on any tx with a wallet input (`assertWalletSignable`), builds requests with `toSignRequest`, checks replies with `acceptWalletSignature`. Wallet signed: fund Satchel, bring back, buy, list from wallet. Satchel signed: raise, challenge, forge, send home.
- Listings: token to Sale(sellerPkh, price), 546 sats to the bazaar beacon (P2PKH of hash160("evermore-bazaar-v1"), unspendable) and OP_RETURN `'EVR1' sellerPkh20 price8LE`.
- BCMR parse bytecode `00cf76517f7578557f77517f757e6b6b`: type key = tag byte + byte 5 (hero `4800..4802` by class, gear `4500..4502` by kind).

## Tx shapes (input 0 always a random lane of 16)
- Raise: in lane + funding; out lane(ctr+1), hero, ghost, treasury, change.
- Challenge: in lane, ghost, funding; out lane, ghost(defences+1), owner fee, ticket, change.
- Forge: in lane, hero, opp ghost, ticket, [own ghost if level up], [Counter if drop], funding; out lane, hero, opp ghost(beaten+1), treasury, [own ghost], [Counter+1, gear], change.
- Sync (fees follow the owner): in lane, hero (P2PKH, its holder signs), the hero's own ghost, funding; out lane, the same hero to a P2PKH, ghost with owner = that pkh (all else kept), change. Run by the client after buy and bring back (hero back to itself); Send home is a sync to the wallet in one Satchel signed tx.
- Ticket reclaim (no lane): a ticket is a plain NFT in its holder's P2PKH; spending it with no output for it burns it and returns its 1,000 sats. The client burns every stale Satchel ticket inside the next challenge (one duel at a time, so older tickets are lost or abandoned) and in the Satchel sweep (empty to wallet).
- Sale list: token to Sale(sellerPkh, price) + OP_RETURN discovery tag. Buy: sale at input i pays seller at output i. Cancel: seller signs.

## Deploy, house heroes, metadata
- `contracts/scripts/genesis.mjs`, `smoke.mjs`, `wardens.mjs` take `--net chipnet|mainnet` and `--dry` (in memory chain, every tx VM verified, nothing broadcast). Mainnet broadcasts only with `--broadcast-mainnet`.
- Wardens: 12 house heroes (`Warden Aldric` ... `Warden Lucan`, Knight/Rogue/Mage mixed) held by the deployer and levelled to a ladder 8,7,6,5,4,4,3,3,2,2,1,1 by real duels among themselves (no gear taken). Names and txids in `contracts/deployments/wardens-<net>.json`; the client merges its `labels` into the local names.
- BCMR: `web/public/bcmr/evermore.json` (served at https://evermore-alpha-nine.vercel.app/bcmr/evermore.json, byte exact, `-text` in .gitattributes), art in `web/public/bcmr/art/`. Category Evermore, symbol EVR, NFT types 4800..4802 (Knight, Rogue, Mage), 4500..4502 (Blade, Shield, Charm). One file holds both networks' identities; genesis commits its sha256. Paytaca indexer reindex: `GET https://bcmr.paytaca.com/api/bcmr/<category>/reindex/` (chipnet host bcmr-chipnet.paytaca.com).

## Wallets
- Satchel: a browser key (localStorage, exportable), funded once from Selene/Cashonize via WizardConnect; signs raise/challenge/forge without popups. Heroes live in the Satchel while playing; "Send home" sends a hero to the connected wallet; heroes can come back.
- Practice mode: same sdk against the sim only, nothing on chain, clearly labelled.

## Non negotiables
No fake states, no simulated success shown as real, every on chain action links the explorer. No secrets in the repo. Commit as jenzylove, no AI attribution lines.
