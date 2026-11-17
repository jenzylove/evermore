# S3 paths spike: raise, challenge, gear, lanes, ghost refresh, sale (Nov 17 2026)

Verdict: **THE WHOLE CONTRACT SET FITS.** Four covenants (CashScript 0.14.0, BCH 2026 VM via libauth 3.1.0-next.8, standard mode) cover every verb in the PRD. **61 of 61 VM cases pass** (valid and rejected). Sim and covenant agree on 30 of 30 random full forges, with level ups and gear drops included. The worst case (12 round win + level up + gear drop, 6 inputs and 8 outputs) uses **43.3%** of the lane's op cost budget. No limit is close.

Files: `Lane.cash` (raise, challenge, forge), `Arena.cash` (ghost holder), `Counter.cash` (gear counter holder), `Sale.cash` (listing), their `.json` artifacts, `sim.ts` (rules + encoders, S3 layouts), `evaluate.mjs` (VM harness), `evaluate-output.txt` (last run). Run: `node evaluate.mjs` (about 2 minutes, mostly the solver).

## 1. Contract set

| Contract | Holds | Params | Paths |
|---|---|---|---|
| **Lane** (P2SH32, redeem 2,433 B) | 16 lane minting NFTs `'L' lane1 heroCtr4` | treasuryPkh, arenaLock, counterLock, raisePrice, challengeFee, forgeFee, gearCap | `raise(cls)`, `challenge(heroId)`, `forge(moves, n, drop)` |
| **Arena** (P2SH32, 65 B) | every ghost | gameCategory | `fight()`: lane at input 0; the ghost comes back to the Arena at the **same index**, same category, same `'G' + id`, value kept |
| **Counter** (P2SH32, 62 B) | the single gear counter `'C' minted4` | gameCategory | `tick()`: lane at input 0; comes back to the Counter at the same index, still a `'C'` |
| **Sale** (P2SH32, 64 B, one address per listing) | one hero or gear | sellerPkh, price | `buy()`, `cancel(pk, sig)` |

Build order (no cycles): category (genesis input outpoint) -> Arena, Counter -> Lane (takes their locking bytecode). Genesis tx mints exactly 16 lanes to the Lane address and 1 counter (`'C' 0`) to the Counter address; anyone can check that no other minting NFT left genesis.

The single invariant that makes griefing impossible: **every lane function is input 0, pins every output, and caps the output count; every Arena and Counter UTXO demands its own replacement at the same index.** A ghost or counter slipped into a path that does not expect it finds a pinned output at its index that is not itself, and the tx fails (tested: ghost burn via raise, via challenge; counter burn via raise; spends with no lane).

## 2. Numbers (standard mode)

Budget = (41 + unlocking bytes) x 800. Every lane spend carries the full 2.4 KB redeem script, so every lane path gets about 1.98M op cost.

| Path | Lane op cost / budget | Other covenant inputs | Tx size (1 funding in) | Fee at 1 sat/B |
|---|---|---|---|---|
| Raise | 227,000 / 1,983,200 (11.4%) | | 2,999 B | ~3,000 sats |
| Challenge | 227,451 (11.5%) | Arena 4,829 / 85,600 (5.6%) | 3,134 B | ~3,100 |
| Forge, no level up | 405,692 (20.4%) | Arena 1x | 3,390 B | ~3,400 |
| Forge, level up (own ghost refreshed) | 519,690 to 577,151 (26 to 29%) | Arena 2x | 3,619 B | ~3,600 |
| Forge, gear drop | 350,975 (17.7%) | Arena 1x, Counter 4,263 / 83,200 (5.1%) | 3,654 B | ~3,700 |
| **Worst: 12 rounds + level up + drop** | **861,155 / 1,987,200 (43.3%)** | Arena 2x, Counter | 3,886 B (6 in / 8 out) | ~3,900 |
| Sale buy | 5,241 / 88,000 (6.0%) | | 405 to 421 B | ~420 |
| Sale cancel | 33,218 / 168,000 (19.8%) | | 487 B | ~490 |

Parity run max budget use: 31.9%. Standard unlocking limit 10,000 B (lane uses 2,443 B, 24%); standard tx limit 100,000 B (4%). Hash iterations negligible.

Note vs S1: the replay alone got cheaper in relative terms (S1 64%) because the bigger redeem script raises the budget. Raise and challenge pay for carrying the forge code (about 2.4 KB, about 1 cent per lane tx at 1 sat/B). Acceptable; if fees ever matter, raise/challenge could move to a second lane family, at the cost of more genesis NFTs.

## 3. Test matrix (61 cases, all PASS)

**Raise:** valid Knight on lane 3 (id 3), valid Mage on lane 9 (id 9) against the same UTXO set (0 shared inputs), chained second raise on lane 3 (id 19). Rejected: starter HP +1, lane counter not bumped, price 1 sat short, a chosen id, ghost owner not the hero's pkh, ghost not minted to the Arena, hero to a non P2PKH lock, class 3, extra hero NFT in change, lane output stripped of minting, victim ghost slipped in as input (burn attempt).

**Challenge:** valid (fee to ghost owner, defences + 1, ticket). Rejected: fee to someone else, fee 1 sat short, defences not bumped, ticket snapshot with lowered ghost HP, ticket with a chosen salt, challenging your own ghost, ghost kept by the challenger, ghost spent with no lane input, second ghost slipped in as input 2.

**Forge:** valid real chain (raise -> challenge -> forge on another lane, L1 -> L2, own ghost refreshed); valid after Send home (ghost owner pkh moves to the new key); valid no level up. Rejected: level up without own ghost, own ghost left at old stats, someone else's ghost passed as own, ghost owner left stale after Send home, ticket for another hero, ticket salt edited, own ghost included without a level up, hero xp + 1.

**Gear:** valid drop (L2 beats a ghost snapshotted at L5: gear #0, counter 0 -> 1), valid skip (eligible, drop = 0), valid last gear (counter 2 -> 3 with cap 3). Rejected: counter not incremented, tier forged, kind forged, gear to another address, **cap reached (3 of 3)**, second gear in change, drop claimed vs a ghost only 2 levels up, counter spent without a lane, counter burned in a raise. Worst case 12 rounds + level up + drop valid.

**Lanes:** forge on lane 11 and forge on lane 14 built against the same UTXO set share 0 inputs (both confirm in one block). Same lane for both: 1 shared input (the lane) = double spend; the second forge rebuilt on lane 11's new outpoint is valid (0 conf chain). Hero raised on lane 3 forged on lane 11, hero raised on lane 9 forged on lane 14 (any lane serves any player). 16 lanes x 1 raise -> 16 distinct ids.

**Sale:** valid buy hero, buy gear, two listings with two payments, cancel by seller. Rejected: 1 sat short, payment to someone else, payment output carrying the token, two listings with one payment, cancel by a non seller, cancel with the seller's pubkey but another key's signature.

**Parity:** 30 random full forges (random class, level 1 to 20, xp, stats, beaten 0 to 40, ghost level 1 to 30, own ghost and counter added when they apply): **30/30 agree** (9 wins incl. level ups and 5 gear drops, 21 losses rejected), and every win also rejects the sim's commitment with xp + 1.

## 4. Design decisions in this spike

1. **Hero ids from lane counters.** Lane commitment `'L' lane1 ctr4`; raise mints id = ctr x 16 + lane and bumps ctr. Unique across lanes with no shared state, so raises never contend across lanes. 134M heroes per lane.
2. **Raise mints hero and ghost together.** The hero must go to a P2PKH; its pkh becomes the ghost owner. Every hero has exactly one ghost from birth, which is what lets the forge demand it on level up.
3. **Defences live on the ghost, not the hero.** The hero sits in the owner's wallet and cannot be touched by a challenger; the ghost is spent by the challenge anyway. Hero shrinks to 23 B.
4. **Ticket snapshots the ghost's fight stats.** The forge replays against the stats the ghost had when challenged, so a ghost that levels between your challenge and your forge cannot void a duel you already solved. The live ghost is still spent at forge for beaten + 1 (XP decay uses the live beaten).
5. **Ghost refresh on level up (stale ghost fix).** If the forge levels the hero, the hero's own ghost (`'G' + heroId` at the Arena) must be input and output 4, rewritten with the new level and stats, keeping beaten and defences, and **its owner pkh set from the hero's current P2PKH**. So Send home and resale move challenge income to the new holder at the next level up. Without a level up the own ghost must not come (stats did not change, and it keeps contention down). There is no ghost burn path at all: ghosts are permanent.
6. **Gear: one global Counter, hard cap.** Drop only if ticket ghost level >= hero level (pre forge) + 3 and the forge passes `drop = 1` with the Counter at the next input; minted < gearCap, minted + 1 written back, gear `'E' id kind tier` to the hero's lock. The player may pass `drop = 0` (needed once the cap is reached; skipping only hurts the skipper). The Counter is the only route to an `'E'` NFT, so total gear supply is exactly gearCap. Contention is only between simultaneous drops (rare); the client retries.
7. **Sale per listing address.** Pay at the same output index as the sale input (one payment cannot settle two listings), plain BCH, at least price, to the seller P2PKH; the token goes wherever the buyer puts it. Cancel by seller signature. No game logic, so it is the natural XO template.

## 5. Seed grinding: is it still possible? **Yes.**

Implemented as asked: `seed = first 3 bytes of hash256(challenge txid || ghost's pre challenge outpoint hash)`. The challenge path writes the pre challenge outpoint hash into the ticket (the challenger cannot choose it: tested), and the forge hashes it with the ticket's own outpoint hash (the challenge txid). Byte 3 of the same hash sets the gear kind.

It does **not** stop grinding. The challenge txid already commits to the ghost's pre challenge outpoint (it is one of the challenge tx's inputs), and both values are known to the challenger before broadcast. The challenger varies change or locktime, rehashes locally, and broadcasts only the txid whose style they can beat. Cost: one hash per try, no fee, no broadcast. Measured with the sim: a starter Knight beats a Mage L3 ghost under 6.7% of styles, so a grinder needs about 15 local tries; vs a Rogue L2, 92.6% (about 2 tries). What the mix does give: the style is bound to that exact ghost state (a grind is void as soon as anyone else touches the ghost), and the hash spreads the bits so the gear kind is not a raw txid byte.

No on chain source can stop it: BCH script cannot read block hashes, and every other value is either chosen by the challenger or by whoever touched the ghost last (who may be the same player grinding their previous forge's txid). Options for the build:

- **A. Accept and disclose** (PRD already says solving is not anti cheat). Grinding only picks the easiest style for a ghost the player already chose and paid for; the fee is still paid and XP still decays with beaten.
- **B. Make rerolls cost money (recommended).** Drop the txid term: `seed = hash256(heroId || ghost id || ghost beaten + defences before the challenge)`. Nothing in it can be ground: the counters move only through covenant paths, and every change of `defences` is a paid challenge, 2 cents to the ghost owner. A player can see the style before paying and reroll only by paying the owner again (or raising another hero for $0.25). Same op cost; a two line change (salt in `challenge`, hash input in `forge`). The PRD line "fixed when you challenge" still holds; "you can't solve it in advance" becomes "you can preview it, but every reroll pays the owner".

## 6. Final commitment layouts (one category, byte 0 = type tag, little endian, values below the sign bit)

| Kind | Size | Layout | Capability, where |
|---|---|---|---|
| Lane | 6 B | `'L'` 0x4c, lane1, heroCtr4 | minting, Lane |
| Hero | 23 B | `'H'` 0x48, id4, cls1, lvl1, xp4, hp2, atk2, def2, spd2, wins4 | immutable, holder's P2PKH (or a Sale) |
| Ghost | 43 B | `'G'` 0x47, id4, cls1, lvl1, hp2, atk2, def2, spd2, ownerPkh20, beaten4, defences4 | immutable, Arena |
| Ticket | 51 B | `'T'` 0x54, heroId4, ghostId4, cls1, lvl1, hp2, atk2, def2, spd2, salt32 (ghost pre challenge outpoint hash, internal order) | immutable, challenger; burned by forge |
| Counter | 5 B | `'C'` 0x43, minted4 | immutable, Counter |
| Gear | 7 B | `'E'` 0x45, gearId4, kind1 (0..2), tier1 (ghost lvl minus hero lvl, >= 3) | immutable, holder |

Starter stats (HP/ATK/DEF/SPD): Knight 60/10/8/4, Rogue 45/12/5/9, Mage 40/15/4/6, level 1, xp 0. Level is 1 byte: a hero stops levelling at 127 (forge fails at the 127 -> 128 step).

## 7. Exact tx shapes for the client

Every lane tx: input 0 = a lane UTXO (pick one of 16 at random, retry another on conflict), unlocked with the function. Arena and Counter inputs use their one function (`fight`, `tick`). Funding inputs are plain P2PKH and go **after** all fixed inputs. Change is a single optional last output with no tokens. Token outputs: 1,000 sats.

**Raise** `raise(cls)`
- In: 0 lane, 1+ funding.
- Out: 0 lane, same lock, minting, `'L' lane ctr+1`, value >= in; 1 hero to buyer P2PKH, `'H' id cls 1 0 starter 0`; 2 ghost to Arena, `'G' id cls 1 starter ownerPkh 0 0`; 3 treasury P2PKH >= raisePrice; 4 change (optional). Max 5 outputs.

**Challenge** `challenge(heroId)`
- In: 0 lane, 1 target ghost (Arena), 2+ funding.
- Out: 0 lane unchanged; 1 ghost to Arena with defences + 1, value >= in; 2 ghost owner P2PKH (pkh from ghost bytes 15..35) >= challengeFee, no token; 3 ticket to the challenger, `'T' heroId ghost[1..15] ghostOutpointHash`; 4 change. Max 5. heroId != ghost id.

**Forge** `forge(moves, n, drop)` (moves = 2 bits per round, n = 1..12, drop 0/1)
- In: 0 lane, 1 hero (owner signs), 2 opponent ghost (Arena), 3 ticket (owner signs; burned), then if level up: 4 own ghost (Arena), then if drop: next = Counter, then funding.
- Out: 0 lane unchanged; 1 new hero to the same lock; 2 opponent ghost with beaten + 1; 3 treasury >= forgeFee; if level up: 4 own ghost with new level and stats, owner = hero's pkh, beaten and defences kept; if drop: Counter with minted + 1, then gear to the hero's lock; one optional change.
- Shapes: plain 4 in / 4 to 5 out; level up 5 / 5 to 6; drop 5 / 6 to 7; both 6 / 7 to 8. The client knows which applies from the sim before building (level up is deterministic; drop = 1 when eligible and the counter shows room).

**List** (no covenant): send the hero or gear to `Sale(sellerPkh, price)` P2SH32; add an OP_RETURN `RLC1 sellerPkh price` so the client can find listings and rebuild the address (not VM tested; plain data).

**Buy** `buy()`: In: i sale UTXO(s), then buyer funding. Out: at index i, seller P2PKH >= price, no token (one per listing, matching index); token outputs to the buyer anywhere after; change.

**Cancel** `cancel(pk, sig)`: In: sale UTXO, seller funding. Out: token back to the seller, change.

## 8. Limits and things to carry into the build

- **No limit issue.** Worst case 43% of op cost, 24% of standard unlocking size, 4% of standard tx size.
- **Contention:** a ghost serializes its challenges and forges against it, and a level up forge also spends your own ghost, which other players may be challenging at that moment. 0 conf chaining works; the client rebuilds on the newest outpoint. Gear drops serialize on the one Counter (rare). Lanes never collide across numbers.
- **Fees follow the hero only at level up.** A sold or sent home hero's ghost keeps paying the old pkh until the new holder levels once. If that matters, add a lane `sync` path (hero + own ghost in, owner refreshed); small.
- **Hero must sit in a P2PKH** to raise and to level up (the ghost owner pkh is read from it). Selene and the Satchel are both P2PKH.
- **Ghost dust is locked forever** (1,000 sats per hero); include it in the raise price.
- **Self farming:** a player can challenge their own other heroes' ghosts (fee goes to themselves) and farm gear with a strong alt as the target. Covenant only stops hero vs its own ghost. The gear cap makes it a race; disclose, or price gear drops via the forge fee.
- **Genesis trust:** the only trusted step is the genesis tx; publish it and show on /proof that it minted exactly 16 lanes and 1 counter.
- Byte order gotcha from S1 still applies: libauth keeps outpoint hashes and categories in display order; introspection sees internal order. The ticket salt and the seed hash use internal order.
