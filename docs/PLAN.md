# Undying: build plan

Today Nov 17 11:40 UTC. Due Nov 22 14:00 UTC.

| Phase | Work | Done when |
|---|---|---|
| 0 Spikes (Nov 17) | S1 duel replay cost in the 2026 VM; S2 Selene over WizardConnect: funds Satchel, shows hero art (BCMR); S3 forge lane design under concurrency | each spike has docs/spikes/*.md with a verdict |
| 1 Duel engine (Nov 17 to 18) | pure TS duel sim (moves, styles, damage, XP), unit tests | tests pass; 100 recorded duels |
| 2 Contracts (Nov 18) | Forge (mint, challenge, forge, gear), Arena ghost, Sale; CashScript, commented; parity tests sim vs covenant in libauth | parity on all recorded duels; forged win rejected |
| 3 Mainnet (Nov 18 to 19) | deploy, mint Warden heroes, first real duel on mainnet | explorer links in BUILD_LOG |
| 4 Game client (Nov 18 to 20) | pixel art arena, duel scene, hero card, satchel, send home, bazaar; sound; mobile | real buttons driven in headless browser, screenshots |
| 5 Judge path + proof (Nov 20) | ?judge seat with self ticking checklist, /proof reading the chain, JUDGE.md | every claim links a tx |
| 6 Audit (Nov 21) | release readiness audit, fix, threat model | audit clean |
| 7 Launch (Nov 21 to 22) | README, banner, deck, video, X post, DoraHacks, XO bounty | submitted before Nov 22 14:00 UTC |

## Risks

| Risk | Status |
|---|---|
| Duel replay op cost and unlocking size | needs a spike (S1) |
| Selene signs covenant spends, shows BCMR art | needs a spike (S2); Satchel design avoids Selene signing covenants mid play |
| Concurrent forges colliding on one minting UTXO | needs a spike (S3); parallel lanes |
| Ghost style knowable before challenge | known: style seeded from the challenge tx; grinding disclosed |
| Art polish in 5 days | known: one pixel style, one sprite sheet per class, consistent palette |
| Mainnet funds | known: owner funds a few dollars for deploys and Warden heroes |
