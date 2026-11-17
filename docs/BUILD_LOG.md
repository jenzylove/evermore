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
