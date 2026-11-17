# S1 replay spike: can the Forge replay a duel on chain? (Nov 17 2026)

Verdict: **FITS.** One P2SH32 Forge covenant (CashScript 0.14.0, BCH 2026 VM via libauth 3.1.0-next.8, standard mode) replays a 12 round duel, checks the hero won, computes XP and level up, and forces all four outputs. Worst case uses 64% of the op cost budget. Sim and covenant agree on 20 of 20 random duels.

Files: `Forge.cash` / `Forge.json` (lane covenant), `Arena.cash` / `Arena.json` (ghost holder, forge path only), `sim.ts` (TypeScript sim + solver), `evaluate.mjs` (VM run), `evaluate-output.txt` (last run). Run: `node evaluate.mjs` (Node 24 strips the TS types natively).

## 1. Numbers (standard mode)

| Measure | Value | Limit | Use |
|---|---|---|---|
| Forge redeem script | 1,381 B (1,321 ops, `hit()` defined once via OP_DEFINE, invoked 6x) | 10,000 B standard unlocking | 14% |
| Lane input unlocking (moves + n + redeem) | 1,412 B | 10,000 B | 14% |
| Op cost, 7 round win | 458,034 | (41 + 1,412) x 800 = 1,162,400 | 39% |
| Op cost, 12 round win (worst case) | 727,840 to 738,249 | 1,163,200 | **63.6%** |
| Instructions, 12 rounds | 7,141 (about 35k op cost fixed + about 50k per round) | | |
| Hash iterations | 24 | about 726 | 3% |
| Whole tx (5 in, 5 out) | 2,333 to 2,337 B | 100,000 B standard | 2.3% |
| Miner fee at 1 sat/B | about 2,340 sats (about $0.005) | | |

**Binding limit: op cost**, and only at about 64%. Everything else is far away. The budget scales with unlocking size, which is why **P2SH32 is required**: as P2S the script sits in the locking bytecode, the unlocking is about 10 B, budget about 40k, and the replay would not fit. If a later rule set needs more headroom, a few hundred bytes of push padding buys 800 op cost per byte.

Op cost is about 100 per instruction, so the cost is CashScript stack shuffling (OP_PICK/OP_ROLL over 12 live variables), not arithmetic. Hand tuning or fewer locals could roughly halve it; not needed.

## 2. Test matrix (all PASS)

| Case | Result |
|---|---|
| Honest win (Knight L3 vs Mage ghost L4, beaten 2, 7 rounds) | **valid** |
| Fake move list that loses, claiming the honest result | rejected |
| Fake move list that loses, claiming its own computed result | rejected |
| Winning list plus one trailing move | rejected (canonical list: `moves == 0` after n rounds) |
| Winning list replayed against another challenge seed | rejected |
| Tampered hero commitment: level +5 | rejected |
| Tampered hero commitment: xp +1 | rejected |
| Ghost not recreated (sent to player) | rejected |
| Ghost recreated without beaten + 1 | rejected |
| Ghost dropped (4 outputs) | rejected |
| Hero minted to another address | rejected |
| Treasury fee 1 sat short | rejected |
| Extra NFT (level 99 hero) minted into the change output | rejected |
| Ticket for a different ghost | rejected |
| Lane NFT returned without minting capability | rejected |
| 12 round win | **valid** |

Parity: 20 random duels (random class, level 1 to 30, stats, beaten 0 to 40, random seed; half solver found wins, half random lists): **20/20 agree** (6 wins valid with exactly the sim's commitment, 14 losses rejected). For each win the covenant also rejects the sim's commitment with xp + 1, so agreement is byte exact, not just win/lose.

## 3. The rules that were replayed (public, in `sim.ts` and `Forge.cash`)

- Moves: 2 bits per round, round i in bits 2i..2i+1 of an int: 0 Strike, 1 Guard, 2 Special (3 invalid). Unlock is `forge(moves, n)`, n in 1..12.
- Ghost move: same 2 bit slots of `seed`; 3 maps to Strike.
- `seed` = first 3 bytes of the **ticket's outpoint hash** (the challenge txid) in internal byte order, read little endian. Needs no commitment field and cannot be forged. Gotcha: libauth keeps `outpointTransactionHash` and `token.category` in display order; introspection sees them reversed.
- Damage `max(1, atk * mult - def / 2)`, halved (floor) if the target Guards. Guard charges +1. Special with charge >= 2 is mult 2 and resets charge; otherwise it acts as Strike.
- Higher SPD acts first (tie: hero). A fighter at <= 0 HP does not act. The covenant requires both alive at the start of every round, ghost <= 0 and hero > 0 at the end, so the duel must end exactly at round n.
- XP gain `(10 + 5 * ghostLevel + 10 * hpLeft / maxHp + 12 - n) * 4 / (4 + beaten)` (beaten 4 halves XP).
- Level up when xp >= 20 * level: subtract, level + 1, class growth (Knight +3 HP +1 ATK +2 DEF; Rogue +2 HP +2 ATK +2 SPD; Mage +1 HP +3 ATK +1 DEF +1 SPD). At most one level per forge (XP carries over). Wins + 1.

## 4. Recommended commitment layout (all little endian, values kept below the sign bit)

Every game NFT shares one category; byte 0 is a type tag so one kind cannot pose as another.

Hero, 27 B, immutable (reminted by the lane on every forge):

| Bytes | Field |
|---|---|
| 0 | 'H' 0x48 |
| 1..4 | hero id (serial from the Raise covenant) |
| 5 | class (0 Knight, 1 Rogue, 2 Mage) |
| 6 | level (max 127) |
| 7..10 | xp |
| 11..12 | max HP |
| 13..14 | ATK |
| 15..16 | DEF |
| 17..18 | SPD |
| 19..22 | wins |
| 23..26 | defences (bumped by the Challenge covenant) |

Ghost, 39 B, immutable, lives at the Arena:

| Bytes | Field |
|---|---|
| 0 | 'G' 0x47 |
| 1..4 | ghost id (= the hero id it copies) |
| 5 | class |
| 6 | level |
| 7..8 | HP |
| 9..10 | ATK |
| 11..12 | DEF |
| 13..14 | SPD |
| 15..34 | owner pkh (challenge fee goes here) |
| 35..38 | beaten counter |

Ticket, 9 B, immutable, burned by the forge: 'T' 0x54, hero id (4), ghost id (4). The seed comes from the ticket's own outpoint, so it needs no field.

Lane: minting NFT, commitment 'L' + lane number. Room left under 128 B for gear slots on the hero (about 100 B free).

## 5. Transaction shape

Inputs: 0 lane (Forge P2SH32, minting), 1 hero (player P2PKH), 2 ghost (Arena P2SH32), 3 ticket (player P2PKH), 4+ BCH funding.
Outputs: 0 lane back unchanged, 1 new hero to the hero's own locking bytecode, 2 ghost to the same Arena bytecode with beaten + 1 and value kept, 3 treasury P2PKH >= fee with no tokens, 4 optional change with no tokens. At most 5 outputs, so the lane cannot mint anything else.

Arena forge path is 9 bytes of logic: `activeInputIndex == 2` and input 0 holds `gameCategory + 0x02`. The Forge does the rest. No circular dependency (Arena needs only the category, not the Forge address).

## 6. Things to carry into the build

- **Seed grinding.** The challenger builds the challenge tx, so they can grind its txid for a weak ghost style (cheap: vary change or locktime). Same class of issue as "solving" in the PRD; disclose it. Cheap mitigation if wanted: mix the ghost's current outpoint hash (set by whoever last forged against it) into the seed.
- **Ghost contention.** Each forge spends the ghost UTXO, so two forges against one ghost serialize. Unconfirmed chaining works (BCH dropped the unconfirmed chain limit in May 2021), but the second player must rebuild on the new ghost outpoint. Parallel lanes do not help here; the client should retry on conflict.
- **Not built in this spike:** the challenge path (fee to ghost owner, ticket mint, defences + 1), gear drop (beat 3+ levels above; adds a capped counter in the lane commitment, small cost), Raise mint. None of these is near a limit.
- Sim parity: keep `sim.ts` as the single rules module for the browser and run the VM parity test on 100+ duels in CI (this harness already does 20 in under a minute).
