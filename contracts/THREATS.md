# Evermore threat model

Four covenants (CashScript 0.14, BCH 2026 VM): **Lane** (raise, challenge, sync, forge), **Arena** (holds ghosts), **Counter** (gear supply), **Sale** (one listing). Sources in `src/`, every `require` commented with what it stops. Tests in `test/` run each attack below in the 2026 VM (standard mode) and check the failure comes from a covenant input, not from fee or dust policy.

## The invariant everything rests on

1. Genesis mints exactly 16 lane NFTs (minting capability) to the Lane address and one counter (`'C' 0`) to the Counter address, and no other minting NFT. So every NFT of the category was written by a Lane function.
2. Every Lane function runs only as input 0, pins every output it allows, and caps the output count. Nothing unpinned can be minted.
3. Every Arena and Counter UTXO demands a Lane at input 0 and its own replacement at its own index. Slipped into a path that does not expect it, it meets a pinned output that is not itself, and the transaction fails.

## Attacks and what blocks each

| Attack | Blocked by | Test |
|---|---|---|
| Claim a level with a move list that loses | Forge replays the duel from the moves and both fighters' stats; requires ghost HP <= 0 and hero HP > 0 at round n | forge rejected: fake move list; parity (losses) |
| Pad a winning list with extra moves | `moves == 0` after n rounds, and both alive at the start of every round | forge rejected: trailing move |
| Edit the result (level, XP, stats, wins) | New hero commitment is computed in script and compared byte for byte | level + 5, xp + 1 (also on every parity win) |
| Weaken the opponent | Ticket snapshot of ghost stats is written by `challenge` from the live ghost; forge reads the snapshot | challenge rejected: ticket HP lowered |
| Choose the ghost's style | Seed = hash256(heroId, ghostId, beaten, defences) read from the ghost before the challenge; the ticket copy is written by `challenge`; the forge hashes the ticket fields itself | ticket with chosen counters; fabricated ticket; moves solved for another seed |
| Use someone else's ticket, or a ticket for another ghost | Ticket hero id must equal the hero's id, ghost id the ghost's id; the hero input needs its owner's signature | ticket for another hero |
| Mint a hero with better stats, a chosen id, a mutable hero, or a second hero in change | Raise fixes starter stats per class, id from the lane counter, immutable category, max 5 outputs, change must hold no token | raise rejected cases |
| Skip or redirect fees | Mint price and forge fee pinned to the treasury P2PKH; challenge fee pinned to the P2PKH in the ghost's owner field | price, fee 1 sat short; fee to someone else |
| Steal or burn a ghost | Arena only spends with a Lane at input 0 and the ghost back at the same index with the same `'G' + id`; Lane pins the rest | ghost kept by challenger; ghost burned in raise / challenge; ghost spent with no lane |
| Fight your own ghost for free XP | `challenge` rejects heroId == ghost id | own ghost |
| Leave a ghost weaker than its hero after a level up | Level up forge requires the hero's own ghost at index 4 and rewrites it with the new level and stats | level up without own ghost; own ghost at old stats; someone else's ghost as own |
| Keep receiving a sold hero's challenge fees | Level up refresh writes the owner from the hero's current P2PKH | Send home forge: owner refreshed; stale owner rejected |
| Mint gear past the cap, forge kind or tier, send it elsewhere, or claim a drop vs a weak ghost | Counter must be present with minted < gearCap and written as minted + 1; gear id = minted, kind = seed byte 3 mod 3, tier = ghost level minus hero level (>= 3); gear to the hero's lock | gear rejected cases, cap 3 of 3 |
| Burn the Counter | Counter only spends with a Lane at input 0 and returns at its index | counter burned in raise; counter spent with no lane |
| Strip the lane's minting capability or steal a lane | Every path pins output 0 to the Lane bytecode with the same category and capability | lane made immutable |
| Underpay a listing, pay with the token, settle two listings with one payment | Sale pays the seller P2PKH >= price, no token, at the output index equal to its input index | buy rejected cases |
| Cancel someone else's listing | `cancel` needs a pubkey hashing to sellerPkh and its signature | cancel by someone else; seller pubkey, other key |
| Point someone else's ghost at yourself (steal its challenge fees) | `sync` needs the hero spent from a P2PKH (its holder's signature) and the ghost at index 2 to be that hero's own (`'G' + hero id`) | sync rejected: someone else's ghost; old owner signing |
| Use sync to edit a ghost or hero, reset counters, mint, or pay a third party | Hero output is the input commitment byte for byte to a P2PKH; ghost output is the input with only bytes 15..35 replaced by that P2PKH's pkh; max 4 outputs, change holds no token | sync rejected cases (owner to a third party, stats, counters, hero edited, covenant target, extra NFT, lane altered, ticket as hero, counter burn) |
| Sync a listed hero (held by Sale) | the hero input must be a P2PKH; a Sale path would also need its own output index to pay the seller in plain BCH | sdk refuses; covenant requires P2PKH lock |
| Burn someone else's ticket | a ticket sits in its holder's P2PKH; only that key can spend it | reclaim by someone else fails the signature |
| Overflow a counter so a ghost can never be challenged again | beaten and defences are 2 bytes and saturate at 32767 (`min(x + 1, 32767)`) instead of failing | defences saturate |

There is **no admin path**: no key can edit, take or delete a hero, ghost, gear, lane or the counter. The treasury key only receives fees.

## Wallet constraint (spike S2)

Selene, over WizardConnect, refuses to sign any transaction whose source outputs hold an NFT commitment longer than **40 bytes**, and wallets sign only the inputs named in `inputPaths` with sighash ALL|UTXOS|FORKID (0x61), never broadcasting. So:
- Every game layout is at most 40 bytes: Lane 6, Hero 23, Ghost 39, Ticket 23, Counter 5, Gear 7 (tested).
- The sdk asserts this on every transaction that has a wallet input (`assertWalletSignable`) and builds the request with `broadcast: false`; `acceptWalletSignature` checks the wallet touched only its own inputs and the result passes the VM before we broadcast.
- Raise, challenge and forge are signed by the Satchel (the in-browser play key), so a duel never pops up a wallet approval. Wallet signed: funding the Satchel, bringing a hero back, buying a listing, listing from the wallet.

## Disclosed limits

- **Alt hero farming.** A player can raise several heroes and challenge their own alts' ghosts (the fee goes back to themselves). The covenant only stops a hero fighting its own ghost. Each alt costs the raise price, each forge the forge fee, XP decays with the target's beaten counter, and gear needs a ghost 3+ levels above, so farming gear means levelling an alt first. Gear is capped, so it is a paid race, not an infinite mint. A player with many heroes can also pick which of them challenges a ghost, which gives them a few previewed styles to choose from; each still costs a challenge fee.
- **Styles are previewable.** With no txid term the seed is known before paying. Rerolling a style needs another paid challenge (defences + 1) or another hero. A player or bot that computes the best moves still pays every fee and earns XP honestly; this is not anti cheat for solving.
- **Ghost contention retries.** A ghost is one UTXO: challenges and forges against it serialize, and a level up forge also spends the hero's own ghost, which someone may be challenging at that moment. Unconfirmed chaining works; the losing transaction is rejected as a double spend and the client rebuilds on the newest outpoint (`Chain.submit` retries). Lanes never collide across numbers (16 lanes, picked at random); the gear Counter serializes drops (rare).
- **Fees follow the hero on sync.** The client syncs after buy and bring back and sends home as a sync, so its own moves keep the ghost's owner current. A hero moved by another app (a plain wallet send) keeps paying the previous owner until its holder runs a sync or levels up. A ticket burned by its holder is gone; that only forfeits a duel the holder already paid for.
- **Hero must be in a P2PKH to raise or level up** (the ghost owner pkh is read from it). Selene, Cashonize, Paytaca and the Satchel are P2PKH.
- **Level cap 127**: the forge that would make 128 fails. **Counters saturate at 32767**: after that a ghost's style for a given hero no longer changes and XP from it is already near zero.
- **Dust**: each ghost locks 1,000 sats forever (priced into the raise).
- **Genesis trust.** The one trusted step is the genesis transaction. It is published (contracts/deployments/<network>.json) and anyone can check it minted exactly 16 lanes and one counter at the expected addresses with no other minting output; /proof shows this from the chain.
- **Listings are found through a beacon.** Listings send 546 sats to an unspendable P2PKH (hash160 of "evermore-bazaar-v1") so clients can find them through Fulcrum address history. A listing that skips the beacon still works on chain but will not show in the game.
