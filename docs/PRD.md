# Undying: product requirements

BCH BLAZE 2026, Mainnet track. Deadline Sun Nov 22 2026 14:00 UTC (15:00 Lagos). Judging Nov 23 to 27.

## One line

A pixel art hero duel game where your hero lives on Bitcoin Cash: every level is earned in a fight the chain checks, your hero earns while you sleep, and nobody can ever shut it down or take it from you.

## The problem

Games die and take what players earned with them.
- Ubisoft shut down The Crew on Apr 1 2024; every copy stopped working.
- Sony pulled Concord two weeks after launch in 2024.
- EA switched off Anthem's servers on Jan 12 2026; everything players earned is gone.
- The Stop Killing Games EU initiative reached 1.29M verified signatures and went to the European Commission in Jan 2026.

And what you build in a game is worth nothing outside it: selling a levelled character breaks most games' terms and is full of scams.

## The user and the front door

Players who like quick, replayable duels (Pokemon style turns, roguelike runs), plus BCH holders who want something fun to do with BCH.

First ten seconds: a full screen pixel art arena, heroes idling, one line ("Games die. Heroes don't."), one button: **Raise a hero**. The chain is nearly invisible: no hex, no wallet jargon in play. It shows up only where it matters (a small "sealed on Bitcoin Cash" mark and a link).

## The loop (locked Nov 17)

1. **Raise.** Mint a hero (about $0.25). A pixel character with a class (Knight, Rogue, Mage), level 1, HP, ATK, DEF, SPD. Stats grow automatically by class each level.
2. **Challenge.** The Arena shows other players' heroes as ghosts. Pick one. A 2 cent challenge fee goes straight to that ghost's owner. Losing costs that fee; nothing else.
3. **Duel.** Turn based, 30 to 60 seconds. Each round pick Strike, Guard or Special (Special charges up). The ghost fights with a style fixed when you challenge (so you can't solve it in advance). Hits, sound, screen shake.
4. **Forge.** Win and your hero gains XP based on HP left, turns used and the ghost's power. A ghost beaten often gives less XP. Level up is written into the hero by the chain, which replays your moves first. Beat a hero 3 or more levels above you and you also win a gear piece (capped total supply, no seasons).
5. **Earn while away.** Your own hero is a ghost in the Arena too. Every time someone challenges it you get 2 cents. Coming back: "Your hero defended 37 times. +74 cents."
6. **Trade.** Sell any hero or gear for a price you set; anyone can buy it, hero and money swap in one transaction.

No seasons, no tournaments, no resets. One persistent arena.

## How BCH does the work

| BCH | Where |
|---|---|
| CashTokens with 128 byte commitments | the hero is a token whose commitment holds class, level, XP, stats, wins, defences; it is the save file |
| Covenants with Layla loops | the Forge replays the duel from the move list and both heroes' stats; a level exists only if the win was real |
| Read only inputs | a ghost is spent and recreated (with its beaten counter +1) so anyone can challenge it without its owner online |
| Minting capability | hero and gear mints with a hard total cap for gear; parallel forge lanes so players don't collide |
| Covenant enforced outputs | the challenge fee always pays the ghost's owner; the forge fee and mint price always pay the treasury |
| Sale contract | list, buy or cancel a hero or gear; atomic swap, no marketplace operator |
| 0 conf | every action lands in seconds at the speed of play |
| No server of ours | the game is a static site reading the chain; anyone can host a copy |

## Wallet design (polish without hiding custody)

- The judge connects Selene once via WizardConnect (required by the track) and funds a **Satchel**: a play key kept in the browser, funded with a small amount (about $1), so duels do not pop up approvals.
- Heroes live in the Satchel while playing. **Send home** moves a hero to Selene in one tap; heroes in Selene can be brought back to play.
- Selene shows the hero with its art (BCMR metadata).
- Every action has a "sealed on Bitcoin Cash" link to the explorer.

## Judging criteria

- **Is it cool:** a real game where the chain is the referee and your hero earns while you sleep; first game in BLAZE 2026.
- **Is it slick:** premium pixel art, sound, motion, one button front door, no popups mid play, works on a phone.
- **Does it work:** commented CashScript, threat model, tests that the browser duel sim and the covenant replay agree move for move, real mainnet transactions for every verb.
- **Will it make money:** players pay mint, challenge and forge fees and trade heroes; the treasury earns on every one; no prize pot to drain.

## Claims and how each is proven

| Claim | Proof |
|---|---|
| Levels are earned, not granted | a forged win with fake moves is rejected on chain (tx link on /proof); covenant test |
| Ghost owners are paid on every challenge | challenge tx shows the owner output; /proof lists defences and payouts read from the chain |
| Nobody can take or delete a hero | no admin path in the contracts (code + README); hero sits in the player's wallet |
| Gear supply is capped | minting covenant refuses past the cap (test + counter on /proof) |
| The game runs without our server | static build; instructions to self host |
| Sim equals chain | parity tests on 100+ recorded duels |

## Bounties

- Mainnet track (main entry).
- Build with XO: the hero sale offer as an XO template on chipnet, feedback written by the owner.
- Community Choice (automatic).

## What it does not do

- No randomness from the chain (BCH script cannot read block hashes); ghost styles come from the challenge transaction, disclosed.
- No real time action combat (the chain cannot verify it).
- No promise of profit; fees are small and stated.
- Not anti cheat for solving: a player or bot that computes the best moves still pays fees and earns honestly.

## Submission checklist (ticked only from the live app)

- [ ] Live clickable demo on mainnet; judges make a useful mainnet tx via WizardConnect
- [ ] Top banner: Widget Factory slide deck link, repo link, CashTokens z address bitcoincash:zr8mczprtn20l62z0d286as0x2euxryysyt6ptjql6 (confirm with owner)
- [ ] Confirm "real" in t.me/bchblaze
- [ ] DoraHacks BUIDL submitted before Nov 22 14:00 UTC
- [ ] XO bounty: template + owner written feedback + XO team alerted
