<p align="center">
  <img src="web/public/landing/front.webp" alt="Evermore" width="100%" />
</p>

<h1 align="center">Evermore</h1>

<p align="center"><b>Games die. Heroes don't.</b><br/>A 3D hero duel game where every hero lives on Bitcoin Cash.</p>

<p align="center">
  <a href="https://evermore.jdollar.site"><img src="https://img.shields.io/badge/play-live-ffcf7a?style=for-the-badge" alt="Play" /></a>
  <a href="https://evermore.jdollar.site/proof"><img src="https://img.shields.io/badge/proof-read%20the%20chain-0ac18e?style=for-the-badge" alt="Proof" /></a>
  <img src="https://img.shields.io/badge/BCH-mainnet-0ac18e?style=for-the-badge" alt="BCH mainnet" />
  <img src="https://img.shields.io/badge/tests-116%20passing-7fe8ff?style=for-the-badge" alt="Tests" />
  <img src="https://img.shields.io/badge/BCH%20BLAZE-2026-ffb347?style=for-the-badge" alt="BCH BLAZE 2026" />
</p>

<p align="center">
  <a href="https://evermore.jdollar.site">Play</a> ·
  <a href="https://evermore.jdollar.site/proof">Proof on chain</a> ·
  <a href="https://blockchair.com/bitcoin-cash/transaction/1dcafe2bc8d5b061503b17db790740eda1544c5fac98c4e228c4028a897784fd">Genesis tx</a>
</p>

---

## Why it exists

Games shut down and take everything players earned with them. The Crew went dark in April 2024 and every copy stopped working. Concord was pulled two weeks after launch. Anthem's servers went off in January 2026. More than 1.29 million Europeans signed Stop Killing Games to ask for a fix.

Evermore is the fix for one game. Your hero is a CashToken in your own wallet. The rules that level it up are Bitcoin Cash contracts. The game is a static page that reads the chain: if we vanish, your hero and the arena live on.

## How it plays

| | |
|---|---|
| **Raise** | Mint a Knight, Rogue or Mage for about 25 cents. Level, XP and stats live inside the token, an NFT in your wallet. |
| **Challenge** | The arena is full of echoes: other players' heroes, fighting on their own. A 2 cent fee goes straight to the echo's keeper. |
| **Duel** | Each round both sides pick Strike, Guard or Power at once. You see the echo's NEXT move over its head; it never sees yours. Guarding halves a hit and fills your power bar; a full bar makes Power a double hit. A fight lasts up to 12 rounds. |
| **Forge** | Win and the chain replays your moves before your hero gains XP and levels up. Beat an echo 3 levels above you and gear drops, from a supply capped at 5,000 forever. |
| **Bounties** | Beat a house Warden in a paid fight and the house pays you a bounty (5 to 15 cents) on chain, once per hero per Warden. |
| **Lost a paid fight?** | Practice that exact fight for free until you crack it (practice wins do not count), then Rematch for real. |
| **Earn while away** | Your hero is an echo too. Every challenge against it pays you, even while you sleep. |
| **Trade** | List any hero or gear at your price, in BCH or in dollars (ParyonUSD). Hero and payment swap in one transaction. |

No seasons, no resets. One arena that never closes. Free practice in the browser teaches all of it first.

## Judge fast path (five minutes)

1. Open **https://evermore.jdollar.site** and press **Play now**. A short guide explains the game; practice is free and needs no wallet.
2. Raise a hero, **Enter the arena**, fight the echo it suggests (marked Beatable), win, watch the forge and the XP.
3. Press **Play for real**, connect Selene, Cashonize or Paytaca (WizardConnect), add about $1 to your play Satchel (one approval).
4. Raise and fight a Warden on mainnet. Each step links its transaction; a win pays the Warden's bounty to your Satchel within a minute.
5. On the hero screen, **Keep it safe** sends the hero (an NFT) and the Satchel's coins to your wallet.
6. Open **/proof**. Every number there is read live from Bitcoin Cash by your browser.

## How Bitcoin Cash does the work

| Bitcoin Cash feature | What it does in Evermore |
|---|---|
| CashTokens NFTs (mutable commitments) | The hero token is the save file: class, level, XP, HP, ATK, DEF, SPD, wins. Gear is an NFT too. |
| 2026 VM loops | The forge contract replays the whole duel, up to 12 rounds, before any level is written. A fake win fails on chain. |
| 2026 VM functions | The damage rule is defined once and invoked six times per round inside the replay. |
| Covenants and introspection | The challenge fee must pay the echo's keeper; mint and forge fees must pay the treasury. No output, no transaction. |
| Spend and recreate | An echo is spent and recreated with its counters raised, so anyone can fight it while its owner is offline. |
| Minting tokens with a counter | 16 parallel forge lanes so players never collide; a gear counter that refuses to pass its cap. |
| Fungible CashTokens (ParyonUSD) | Heroes can be priced and sold in dollars: a sale covenant releases the hero only when the seller is paid the full PUSD amount. |
| P2SH32 | Big enough unlocking data for a full move list under the VM's cost budget. |
| BCMR | Hero and gear art show in wallets; the registry hash is committed in genesis. |
| Fast, cheap transactions | A fight costs under a cent in network fees and confirms at the speed of play. |

## Architecture

```
  browser (static site)                         Bitcoin Cash mainnet
 ┌──────────────────────────────┐            ┌──────────────────────────────┐
 │ 3D client (Three.js)         │            │ Lane x16   raise, challenge, │
 │ duel sim (same rules as      │  Electrum  │            forge, sync       │
 │   the covenant)              │◀──────────▶│ Arena      echoes (ghosts)   │
 │ sdk: tx builders, reads      │  WebSocket │ Counter    gear supply cap   │
 │ Satchel (play key)           │            │ Sale       atomic hero swap  │
 └──────────────┬───────────────┘            └──────────────────────────────┘
                │ WizardConnect (sign only)                 ▲
        Selene / Cashonize / Paytaca               │ bounty payouts (house wallet,
                                                   │ capped; the only service we run)
                                            bounty keeper (Railway)
```

- `contracts/` CashScript sources (Lane, Arena, Counter, Sale, SaleToken), compiled artifacts, 116 VM tests, deploy scripts and the bounty keeper.
- `sdk/` duel rules, commitment codecs, transaction builders, chain reads.
- `web/` the game, the landing page and /proof.

## Proof

| Claim | Receipt |
|---|---|
| Live on mainnet | [Genesis tx](https://blockchair.com/bitcoin-cash/transaction/1dcafe2bc8d5b061503b17db790740eda1544c5fac98c4e228c4028a897784fd), category `8941559b1d6823277392ecf0b3d523829a976002b02eee51be64496423dbe480` |
| Levels are earned | Each echo on /proof links its latest fight on mainnet. A fake move list is rejected: [test](contracts/test/forge.test.mjs#L74) |
| Keepers are paid | Every challenge tx has the keeper output; totals on /proof |
| Wins pay bounties | [A bounty paid on mainnet](https://blockchair.com/bitcoin-cash/transaction/701a9b8ba7c9609b79714b1c643257e41fe9d0b705fcc36d106ce687921f7aee), [keeper](contracts/scripts/bounty-keeper.mjs) |
| Gear is capped | [First drop on mainnet](https://blockchair.com/bitcoin-cash/transaction/92aebb193d8bb5948d758ff7ec27b039c3fd1b9cb3fd202447f7ffc2dc135cca), [Counter.cash](contracts/src/Counter.cash), [cap test](contracts/test/forge.test.mjs#L127) |
| Heroes sell in dollars | [Bought with PUSD](https://blockchair.com/bitcoin-cash/transaction/0f07290600edcd5ccf08d38f0c25d4c22c738e0628c0df33b1f631e913a260f3), [SaleToken.cash](contracts/src/SaleToken.cash), [attack tests](contracts/test/sale-pusd.test.mjs) |
| Browser equals chain | [Parity test](contracts/test/parity.test.mjs): 100 recorded duels, move for move |
| No admin key | [Lane.cash](contracts/src/Lane.cash), [Sale.cash](contracts/src/Sale.cash), [threat model](contracts/THREATS.md) |

## What is real

| Part | Status |
|---|---|
| Contracts | Live on BCH mainnet |
| Raise, challenge, forge, gear, sync, reclaim, list, buy, cancel, PUSD sale | Live on mainnet, each one a transaction you can open on /proof |
| 12 Wardens | House heroes levelled by real duels on mainnet, so the arena is never empty |
| Warden bounties | Live: a small keeper on Railway pays wins against Wardens from a capped house wallet; every payout is on chain with an `EVB1` tag |
| WizardConnect | Selene, Cashonize, Paytaca; wallets sign, the game broadcasts |
| Hero art in wallets | BCMR registry, hash committed in genesis |
| Practice mode | Same rules, nothing on chain, clearly labelled, free |
| Fighters | Nine Mixamo characters (three per class); an echo never wears the body of the hero it faces |

## The business

- Players pay 2 cents per paid fight (to the echo's keeper), about 25 cents per hero raised and 1 cent per won forge (to the treasury).
- Players earn 2 cents every time their hero is challenged, Warden bounties for paid wins, and the price of levelled heroes they sell.
- The house funds bounties from raise and fight fees; a typical player who beats the easy Wardens leaves the treasury ahead, and a bounty is paid once per hero per Warden.
- No token, no prize pot to drain: revenue scales with play.

## Run it

```bash
npm install
npm test                      # 116 contract tests in the BCH 2026 VM
cd web && npm run dev         # http://localhost:5190
```

Deploy your own copy of the game page anywhere static. It reads the same contracts. The bounty keeper is optional: `BOUNTY_WIF=<key> node contracts/scripts/bounty-keeper.mjs`.

## Built with

CashScript 0.14 · libauth 2026 VM · CashTokens · ParyonUSD · WizardConnect · BCMR · Three.js · Mixamo · Vite

Built for BCH BLAZE 2026 by [JDollar](https://x.com/dollar782).

## License

MIT
