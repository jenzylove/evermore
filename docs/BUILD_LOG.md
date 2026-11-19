# Evermore build log

## Nov 17 2026: chain side (contracts + sdk)

**Contracts** (`contracts/src`, CashScript 0.14, BCH 2026 VM via libauth 3.1.0-next.8, standard mode)
- Lane, Arena, Counter, Sale ported from the S3 spike, every `require` commented with what it stops. Threat model in `contracts/THREATS.md`.
- Seed change from SPEC: `hash256(heroId4 || ghostId4 || beaten2 || defences2)` of the ghost before the challenge. No txid term: styles are previewable and every reroll is a paid challenge. The ticket carries the counters instead of a salt.
- Wallet constraint from S2 (Selene refuses commitments over 40 B): Ghost trimmed 43 -> 39 B and Ticket 51 -> 23 B by making beaten and defences 2 bytes that saturate at 32767 (`min(x + 1, 32767)`), so a ghost can never get stuck. Every layout is now <= 40 B.
- Lane redeem script 2,453 B. Worst case (12 round win + level up + gear drop, 6 in / 8 out): 859,826 / 2,002,400 op cost (42.9%), tx 3,897 B.

**Tests** (`npm test` at the repo root, green)
- contracts: 84 node:test cases. Every S3 valid and rejected case (raise 15, challenge 13, forge 18, gear 11, lanes 2, sale 11), the new seed (previewable, funding independent, reroll costs a challenge, per hero styles, moves for another seed rejected), counter saturation, wallet signing (40 B limit, simulated WizardConnect wallet signing with 0x61 only its inputs, foreign input tampering caught), BCMR parse bytecode in the VM. A rejection only counts if the failing input is a covenant (not dust or signature policy).
- parity: 100 random full forges, drafts built by hand from the sim (not through the sdk guards): 100/100 agree (last run 40 wins incl. 12 level ups and 23 gear drops, 60 losses rejected in the lane replay), every win also rejected with xp + 1.
- sdk: 15 unit tests, plus a live chipnet Fulcrum read (`EVERMORE_LIVE=1`, passed against chipnet.imaginary.cash).

**SDK** (`sdk/`, TypeScript, runs natively in Node 24 and Vite)
- `rules.ts` pure duel sim + solver + preview; `codec.ts` all six layouts; `game.ts` contract instances from a deployment; `tx.ts` builders for raise, challenge, forge (level up, gear drop), list (bazaar beacon + `EVR1` tag), buy, cancel, send, pay, with largest first coin selection and fee; `wallet.ts` Satchel, xpub address derivation + network check, WizardConnect `toSignRequest` / `acceptWalletSignature`, `fundSatchelRequest`, `sendHome`, `bringBackRequest`; `chain.ts` Fulcrum WebSocket reads (lanes, ghosts, counter, holdings, hero by id, listings) and `submit` with double spend retry; `bcmr.ts` registry + OP_RETURN.

**Genesis** (`contracts/scripts/genesis.mjs`, chipnet only, refuses mainnet)
- Deployer key generated at `C:\Users\LENOVO\relic-launch\keys\evermore-chipnet-deployer.wif` (outside git). Address **bchtest:qzx2n0hzycuu3mevnlyy0myvrxsr4yj5rsrp65x2mg**.
- `run --dry` builds and VM verifies prep + genesis (1,738 B, 20 outputs: authhead, 16 lanes, counter, BCMR OP_RETURN, change). Blocked on funding: needs about 25,000 sats from a chipnet faucet, then `node scripts/genesis.mjs run` and `node scripts/smoke.mjs` (raise x2, challenge, forge, all on chipnet with explorer links).

## Nov 17 2026: chipnet genesis and first real duel
- Genesis (16 lanes, Counter, Arena): https://chipnet.imaginary.cash/tx/3358ac2ba5e6c27ace9fbdbd8d560de38befabe0f67de6d2ce003dfa05b7c74b
- Raise x2: 1b506aec..., fc3ad93c...; Challenge: 2660d1e6...; Forge: 3b5ef289... (hero #13 Knight L1 to L2, beat Mage #8, replayed by the Lane covenant)

## Nov 17 2026: the client on the real chain (RealChain + WizardConnect)
- `web/src/chain/realChain.ts`: `RealChain implements GameChain` over the sdk (chipnet by default, mainnet by `VITE_EVERMORE_NET=mainnet` / `?net=mainnet` once `contracts/deployments/mainnet.json` exists). Arena, heroes, gear, listings read from Fulcrum; raise, challenge, forge (level up and gear drop args passed, lane retry on conflict), list, buy, cancel, send home, bring back, fund, withdraw. Receipts carry the txid and the explorer link. Names live in localStorage by hero id (the 23 B commitment has no room; Raise allows only one no-token output after the 4 pinned ones, which change uses); others see `Knight #13`. Earnings = defences x challenge fee, only for ghosts whose owner pkh is one of the player's keys.
- `web/src/chain/wallet.ts`: WizardConnect (dapp 0.2.7 / core 0.2.10) pairing, late join nudge, network from the xpub (refuses a mismatch), session remembered, signs only wallet inputs, we broadcast.
- `web/src/ui/connect.ts`: "Play for real" sheet from the mode tag: QR / Cashonize link / copy link, Satchel address + balance, Add $1 / $5 from wallet, export key, empty to wallet, switch to real or back to practice. Every real tx shows a receipt with its explorer link.
- Arena style preview uses the covenant seed (`chain.styleSeed`, 2 byte counters) on real chains; practice keeps the sim's.

**Headless chipnet run** (`node web/scripts/real-chain.ts`, home wallet = deployer key signing like WizardConnect, test Satchels' keys outside the repo):
- fund seller Satchel https://chipnet.imaginary.cash/tx/e7efd354673911a82db81e4ec81a2d76f99f243dabcb6230d8cca161dbb3b319
- fund buyer Satchel https://chipnet.imaginary.cash/tx/8b84331c8829328b80a46a2a7d639465fb72358c8452c287eed57a3f15cf07b2
- raise #15 Knight https://chipnet.imaginary.cash/tx/22c2a5edd6ba9552832087091288ecf3e7d8e48011c6b0ba8cca449acaf111b5
- challenge #8 https://chipnet.imaginary.cash/tx/729e04647d6adffa36e3a6f1080c6c41443e7afcd2d6febff099e8fc0d11c131
- forge win (6 rounds, +16 XP) https://chipnet.imaginary.cash/tx/14ca0cf7274a2bea09abfb01bea42bb458a4b7bd59f50fc8ef11309293ceef7d
- list https://chipnet.imaginary.cash/tx/64ec46bf5a53e3131e381a914e0bb8d8c97324300b632a606e73e3715d784f31
- cancel https://chipnet.imaginary.cash/tx/f6a4477327be615c2e691294db63ca4643c66911619e470c028717cca1fc901c
- list again https://chipnet.imaginary.cash/tx/0abdc12c7a016d876822f455ed0b8f9bd48845ff8fb5c793fce310b158805986
- buy (second Satchel) https://chipnet.imaginary.cash/tx/cd6e0df8f4896ae2acd48bfca76245e185f847db2621de5c158d3ca8a981987e
- send home https://chipnet.imaginary.cash/tx/60599fe9f8062a0085534c253953477d1607744b9c4ecd314a31c0d13c3c8ec9
- bring back (wallet signed) https://chipnet.imaginary.cash/tx/1b34c4559845612842492a84596bf7ba20c8f634b3201b9cd114cc4688642d51
- level up (`levelup` stage): challenge https://chipnet.imaginary.cash/tx/0f531dca73e8ce9bce827a8581f962d1da5e1a5fbd77bd15d22d98c4eac2e37e, forge #15 L1 to L2 with own ghost re-levelled (6 in, 6 out) https://chipnet.imaginary.cash/tx/3583ec6a15f607a160529f92737b42def805e29dec94ab8b6b0241420c0de01e
- two more wins at L2: b54032cc / b5c43f4b, e450b62f / cea0a6e1

**Real page in Playwright** (`node web/scripts/real-page.ts <dev url>`, pre-funded Satchel injected): boots in chipnet mode, reads the Satchel in the browser, connect sheet, raise through the Raise screen, challenge from the Arena, winning moves on the duel buttons, forge sealed with the explorer link. All passed.
- raise #10 Rogue "Pagewalker" https://chipnet.imaginary.cash/tx/293409d9255f5edbb20cd5bd6f803e04d76151739f9098c61b9666a4e490b052
- challenge #8 https://chipnet.imaginary.cash/tx/a397b20918283131513d66538cd0a00665804c8f6860f8a47937a32a8e8c2586
- forge (5 rounds, +17 XP) https://chipnet.imaginary.cash/tx/c2936ecb1a23dad97edbad6fdf2f83b48f13692a269677dc45aac779d7936063

Not yet on chain: a gear drop (needs a ghost 3+ levels above the hero; the Arena tops out at L2). Not yet with a phone: WizardConnect funding and bring back from Selene / Cashonize (the code path is the one the test wallet ran).

## Nov 19 2026: fees follow the owner, ticket reclaim, mainnet ready scripts, wardens, BCMR

**Contracts** (re-genesis needed, done on chipnet)
- Lane `sync()`: in lane, hero (P2PKH, its holder signs), the hero's own ghost; out lane, the same hero to a P2PKH, the ghost with owner = that pkh (stats and counters kept), change. Hero spent to itself = "this ghost pays me now"; hero to another P2PKH = Send home and sync in one tx. Lane redeem script 2,339 ops; sync uses well under 20% of its op budget.
- Ticket reclaim needs no covenant: a ticket is a plain NFT in its holder's P2PKH, so spending it with no output for it burns it and returns its 1,000 sats.
- Tests: 104 node:test cases green (20 new: sync valid, Send home as sync, old owner cannot sign, fee follows after sync, 11 sync rejections each failing on a covenant input, sdk guards; reclaim standalone, reclaim inside a challenge, someone else cannot burn, sweep with tickets). Parity 100/100 unchanged. sdk 15/15.

**SDK / client**
- `syncDraft`, `ghostPays`, `reclaimDraft`, `isTicket`; `satchelWithdraw(..., burnTickets)`; `buildRegistry` (symbol EVR, keeps the other network's identity), `BCMR_URL`, `paytacaReindexUrl`.
- RealChain: every challenge burns the Satchel's older tickets in the same tx (one duel at a time, so they are lost or abandoned); Empty to wallet sweeps coins and tickets; `reclaimTickets()`; buy and bring back are followed by a Satchel signed sync (no wallet popup); Send home is a sync to the wallet in one tx. Warden names come from `deployments/wardens-<net>.json` labels.

**Scripts** (`--net chipnet|mainnet`, `--dry` = in memory chain, every tx VM verified, nothing broadcast; mainnet broadcasts only with `--broadcast-mainnet`)
- Fees (both nets, BCH about $210): raise 119,000 (~$0.25), challenge 9,500 (~2 cents, ghost owner), forge 4,800 (~1 cent), gear cap 5,000.
- Mainnet rehearsal (deployer bitcoincash:qpse3d5cgrdrezvm3s5cnprlapw2skc9egkcjpw3ye, unfunded, nothing broadcast): `genesis.mjs run --dry --net mainnet` VM ok (prep 185 B, genesis 1,761 B, 20 outputs); `smoke.mjs --net mainnet --dry` raise, raise, challenge, forge (L1 to L2), challenge, reclaim, sync all VM ok; `wardens.mjs --net mainnet --dry` full ladder in 226 txs, 812,068 sats (about $1.71, tx fees and dust; raise/challenge/forge fees return to the treasury).

**Chipnet re-genesis**
- prep (authbase, category 7efdf7b0...) https://chipnet.imaginary.cash/tx/7efdf7b03d20338e9331a76314eb87edf8e2ed022bed899a072dabf9eb0269b6
- genesis (16 lanes, Counter, BCMR OP_RETURN to https://evermore-alpha-nine.vercel.app/bcmr/evermore.json, sha256 ed097768...) https://chipnet.imaginary.cash/tx/fb579ab0905c40e438529c8345330bcc652d9abdc922ffc8eba743190b11a2e3

**Chipnet smoke** (`node scripts/smoke.mjs`)
- raise Knight #8 https://chipnet.imaginary.cash/tx/bb841387826badcac072ffc798c7c50e900227ea533f3c25192b7334818e5b59
- raise Mage #5 https://chipnet.imaginary.cash/tx/f05a90c1cd08658fbead2af7d8c16daf0c9f8f01c8fcc77e92e2c26372e30923
- challenge https://chipnet.imaginary.cash/tx/131ca4ec963c8e18ff8ae5113678dea224deb95679d1a8a4e3425df8cc55bda0
- forge #8 L1 to L2 https://chipnet.imaginary.cash/tx/ce2895fdf8c431e644f16db3addc37de316b7baff4676ca4ecdbd14aa7884a4b
- challenge (walked away) https://chipnet.imaginary.cash/tx/a54f7950c45702b6f111e884521b833e14e6585895502ba6ad8948cc078ff3c5
- reclaim (ticket burned, sats back, no lane) https://chipnet.imaginary.cash/tx/4e819a7d41f0d50c6c93655503471af1f4307eb7165bfc436301f3cf7921ee0d
- sync: Mage #5 moved to another key, its ghost now pays that key https://chipnet.imaginary.cash/tx/07566f90b9ed2d1dc355db278cb9991e5c96c99d465bb3bf8172f7992c4d9545

**Real page in Playwright** (`node web/scripts/real-page.ts`, a dev flagged build served statically, since the wardens run rewrites a JSON Vite watches)
- raise #24 Rogue "Pagewalker" https://chipnet.imaginary.cash/tx/b83c00f4185b16ffee6dfc963e2d49ba7b927bad4d4256c62cc246687c6e0894
- challenge https://chipnet.imaginary.cash/tx/a8e03d9fc1b11c294fed78ca971f5c6ee440d09c0fa00659af2d96ba00b49ccd, forge https://chipnet.imaginary.cash/tx/20181361aff7ad3509436d5ae79183fdbc25e5c88c9d96f1c553ffe2adc1044a
- again (`EVERMORE_REUSE_HERO=1`): challenge https://chipnet.imaginary.cash/tx/16d25d71dec10fac8c809db5f9b2b600eeadf158781a041e17ed7e43c4e2c4c4, forge (level up to L2) https://chipnet.imaginary.cash/tx/360ab8beb88751256689bd838b3f26674b61beb9a4f9ca5dbdfa36af407486f0
- again: challenge https://chipnet.imaginary.cash/tx/f9f8b99885ecdaedbbb398f7c1c938ffd5ffaf5a036d7307d18b5e11e2b583b7, forge https://chipnet.imaginary.cash/tx/c282365212da4457e81d1b975fe3b4fdfa7875c62bb51156f28aafbb4fa70846 (L2, 3 wins)
- Script fixes: the forge seal is now `.sealed a`; the post forge read and the connect sheet check wait for Fulcrum / render instead of reading once.

**BCMR**: `web/public/bcmr/evermore.json` (Evermore, EVR, types 4800..4802 Knight/Rogue/Mage with portraits rendered from the game, 4500..4502 Blade/Shield/Charm, icon) and `web/public/bcmr/art/*.png`. Byte exact: `-text` in .gitattributes.

**Mainnet day, in order**
1. Fund bitcoincash:qpse3d5cgrdrezvm3s5cnprlapw2skc9egkcjpw3ye with about 0.0055 BCH (about $1.15): genesis about 25,000 sats, smoke about 140,000 in flight (raise fees return to the treasury), wardens about 812,000 sats in tx fees and dust (they cycle the same coins, so at least 150,000 must sit there at the start and the run spends about 812,000 in total; fund 1,000,000 to be safe).
2. `node scripts/genesis.mjs run --dry --net mainnet`, then `node scripts/genesis.mjs run --net mainnet --broadcast-mainnet`. That writes `contracts/deployments/mainnet.json` and rewrites `web/public/bcmr/evermore.json` with both identities.
3. Commit, deploy the site, and check that https://evermore-alpha-nine.vercel.app/bcmr/evermore.json hashes to the sha256 in mainnet.json (`curl -s URL | sha256sum`).
4. `node scripts/genesis.mjs bcmr --net chipnet`, so chipnet's authchain commits the new file hash.
5. Reindex: `curl https://bcmr.paytaca.com/api/bcmr/<mainnet category>/reindex/` (and `https://bcmr-chipnet.paytaca.com/api/bcmr/7efdf7b03d20338e9331a76314eb87edf8e2ed022bed899a072dabf9eb0269b6/reindex/`). Check with `/api/tokens/<category>/`.
6. `node scripts/smoke.mjs --net mainnet --broadcast-mainnet`, then `node scripts/wardens.mjs --net mainnet --broadcast-mainnet`. Commit `deployments/wardens-mainnet.json` so the client shows the names.
7. Ship the client with `VITE_EVERMORE_NET=mainnet` (or `?net=mainnet`) once mainnet.json is committed.
