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
