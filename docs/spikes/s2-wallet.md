# Spike S2: wallet (Evermore)

Questions this spike answers, on BCH mainnet with the owner's own wallet:

1. Can Evermore connect Selene / Cashonize / Paytaca through WizardConnect and read the wallet's addresses?
2. Can the wallet fund an in-browser **Satchel** key (2,000 sats), and can the Satchel send it back?
3. Will the wallet sign **only its own P2PKH input** in a transaction that also spends an input it does not own? (Needed later for hero transactions that mix a contract or Satchel coin with a wallet coin.)
4. How does Selene show CashTokens NFTs with BCMR art, and how do we publish BCMR for our category?

## Run it

```bash
cd C:\Users\LENOVO\relic-launch\spikes\s2-wallet
npm i
npm run dev
```

Open **http://localhost:5182/** on the desktop (Chrome). The phone only needs to scan the QR; it does not need to reach localhost.

Safety: nothing is broadcast unless you press **Broadcast**. Every wallet request is sign-only (`broadcast: false`). The Satchel is a throwaway key the page makes in this browser's localStorage (`evermore-s2-satchel`); **Copy Satchel WIF** gives you a backup you can sweep in any wallet if you lose the tab. The page has been run end to end against the real WizardConnect relay with a simulated wallet and a mocked Fulcrum: all three steps signed, the 2026 VM accepted every result, zero broadcasts.

You need about 5,000 sats of plain BCH (not tokens) in the wallet's first 20 receive or change addresses. Total cost of A + B + C in fees is under 1,000 sats.

## What to click

Do it once per wallet. Selene first, since the PRD names it.

1. **Connect wallet.** A QR, a `wiz://` link and an "Open in Cashonize" link appear.
   - **Selene** (iPhone/Android, version 2026.10 or newer): open WizardConnect (scanner) in Selene, scan the QR, accept sharing public keys.
   - **Paytaca**: press **Copy link**, get it onto the phone (Universal Clipboard, AirDrop, or message to yourself), paste it in Paytaca: Apps, WizardConnect.
   - **Cashonize** (web): press **Open in Cashonize**. Needs an HD wallet (new wallets are HD by default) on mainnet.
   - Check: the page shows the wallet name, `mainnet`, the shared paths and your Receive 0 address. Compare that address with the wallet's own receive address.
2. **A. Wallet sends 2,000 sats to the Satchel.** Approve in the wallet. Screenshot the confirm screen (does it show our prompt "Evermore: move 2000 sats into your play Satchel"? how does it show the amount?). The page checks the reply and the VM. Press **Broadcast**, then **Refresh** in the Satchel box until it shows 2,000 sats (unconfirmed is fine).
3. **B. Wallet signs only its own input beside a Satchel input.** Input 0 is the Satchel's 2,000 sat coin, input 1 is a wallet coin; the wallet is asked to sign only input 1. Outputs: 2,000 sats back to the Satchel, the rest (minus fee) back to the wallet. Approve, screenshot the confirm screen (how does the wallet show a foreign input?). If all checks say OK, press **Broadcast**. This proves the pattern on chain with real coins and nothing leaves the owner's hands.
   - If you want a no-risk first try, tick **use a fabricated Satchel coin**: same shape, but input 0 is a coin that does not exist, so nothing can ever be broadcast.
4. **C. Satchel sends everything back to the wallet.** Signed in the browser, no wallet prompt. Press **Broadcast**. The Satchel ends empty.
5. **Disconnect**, then repeat from step 1 with the next wallet (A then C is enough for the others; B is the important one for Selene).
6. **Copy results JSON** and send it back with the screenshots. It holds no keys and no signed hex.

Reading the log: `OK` lines are good. `NO foreign input 0 left untouched` or a sighash other than `0x61`/`0x41` is a real finding. A refusal shows the wallet's own error text; copy it exactly.

## Findings: WizardConnect (Nov 17 2026)

**Packages (dapp side)**: `@wizardconnect/dapp@0.2.7` (Nov 13) and `@wizardconnect/core@0.2.10` (Nov 12), LGPL-3.0, repo gitlab.com/riftenlabs/lib/wizardconnect, docs `docs/dapp.md`. Optional `@wizardconnect/react@0.2.6` (hook + QR dialog) and `@paytaca/wizardconnect-vue`. Core pulls `@bitauth/libauth@^3.1.0-next.2`; pin `3.1.0-next.8` so it dedupes. Default relays: `wss://relay.riften.net:443`, `wss://relay.cauldron.quest:443` (Nostr, NIP-44 encrypted).

**Connect flow**: the **dapp** makes the pairing link and the wallet scans it (not the other way round).
`initiateDappRelay(cb, { explicitRelayUrls })` returns `uri` (`wiz://?p=…&s=…`, for copy/paste and deep links) and `qrUri` (uppercase `WIZ://%3FP%3D…`, alphanumeric QR mode, use this for the QR). `new DappConnectionManager(name, iconUrl, { session })`, `mgr.attachRelay(relay)`, forward relay status with `mgr.updateConnection(client, status)`. On `walletready` you get `walletName`, `protocol` (`hdwalletv1`) and **xpubs** for paths `receive` (0), `change` (1), `defi` (7). Cashonize web opens a pairing with `https://cashonize.com/?uri=<encoded wiz://>`.

**Methods**: the protocol has exactly one request: **`sign_transaction_request`**. There is no `getAddress`, no `signMessage`, no "send" in hdwalletv1.
- Addresses: derive locally, `mgr.getPubkey(child, index)` then P2PKH. The dapp must find the wallet's coins itself (Fulcrum `listunspent` over the first 20 receive + 20 change addresses, like kvit and payday do) and build the transaction.
- Signing: `mgr.signTransaction({ transaction: { transaction: hex, sourceOutputs, broadcast, userPrompt }, inputPaths })`. `inputPaths` is `[inputIndex, pathName, addressIndex][]`, e.g. `[[1, "receive", 0]]`. Serialize source outputs with `sourceOutputToRelay` from `@wizardconnect/core/hdwalletv1-serialize` (hex bytes, `"<bigint: Nn>"`); each source output must carry its input's fields too (outpoint, sequence, unlockingBytecode).
- Broadcast: **Selene never broadcasts** (it returns signed hex only, whatever `broadcast` says). **Cashonize honours `broadcast: true`**. So always send `broadcast: false` and broadcast from the dapp. One code path for all wallets.

**Signing only some inputs (question 3)**: answered "yes" by source for Selene and Cashonize, live test still needed.
- Selene (`src/kernel/bch/WizardConnectService.tsx`): signs only the inputs listed in `inputPaths`, always with **sighash 0x61 = ALL | UTXOS | FORKID**, and checks that each listed input's locking bytecode matches the key at that path ("Source output does not belong to derivation path"). Unlisted inputs are left as they are.
- Cashonize (`src/utils/dapp/wizSigning.ts`): same rule, "inputs without a signing key keep their dapp-provided unlocking bytecode", same 0x61 (the spec requires it). It can also fill CashScript placeholders for contract inputs.
- The doorstub team ran a probe for exactly this question (their PROBE.md) and their README says signing was tested with Selene, Paytaca and Cashonize.
- What it means for Evermore: SIGHASH_UTXOS commits to every source output, so the `sourceOutputs` we send must be exactly right (value, locking bytecode, token data). The Satchel or a contract can sign its own input before or after the wallet; the wallet's signature does not cover other inputs' unlocking bytecode. Selene compares each source output with its input byte for byte, including `unlockingBytecode`, so send the transaction and the source outputs in the same state.

**Pain points seen in the wild**
- **Late join hang (0.2.7)**: the dapp library waits only 30 s for the key exchange after the relay connects, then never sends `dapp_ready`. Slow scans and pasted Paytaca links hang. This page and doorstub re-run `updateConnection(client, {status:'connected'})` when a late key exchange completes (see `src/main.js`).
- **Network mismatch**: nothing in the protocol says which network. Read it from the xpub version (`decodeHdPublicKey(xpub).network`); refuse anything not `mainnet`. Cashonize sessions are tied to the wallet and network that made them and drop on a switch; Cashonize allows dapps on mainnet and chipnet, not testnet4.
- **App name / icon**: the dapp name we pass is what the wallet shows; Cashonize falls back to a label. The icon must be a public https URL (the phone cannot load localhost). Selene reports its name as "Selene Wallet".
- **Selene refuses NFT commitments over 40 bytes** in any source output ("Invalid signing source output at index N"), even though the 2026 rules allow 128. **Hero commitments must stay ≤ 40 bytes** if Selene ever signs a transaction that spends one.
- Cashonize refuses to sign coins it has reserved for its own identity features; Selene needs version 2026.10 or newer; WizardConnect needs an HD wallet.
- A `destroy()` while a request is pending leaves the result unknown (the wallet may have signed); do not retry blindly with another wallet.

**Working code to copy from**: `tedinroc/doorstub` `src/wallet/session.js` + `request.js` (best: late-join nudge, network check, sign-only guard, Selene/Cashonize/Paytaca links), `ctmakc/kvit` `app/src/lib/wallet.ts` (React, chipnet test wallet), `Finney06/payday` `client/wallet.js` (smallest). `@wizardconnect/wallet@0.2.4` gives a headless wallet for tests (that is how this page was tested).

## Findings: Selene and BCMR art (question 4)

From Selene's source (`src/kernel/bch/BcmrService.tsx`, `src/util/token.ts`, Oct 14 2026 main):

- **Discovery**: for a token's authbase Selene first fetches **`https://bcmr.paytaca.com/api/registries/<authbase>/latest`** (Paytaca's BCMR indexer). If that registry names a `registryIdentity`, Selene walks the authchain itself over Fulcrum: from the authbase follow whoever spends output 0 until the unspent head, take the latest `OP_RETURN BCMR` output, fetch its first URI and check the SHA-256. If the Paytaca indexer has nothing for the category, the download fails and the NFT shows without art. So in practice: **publish on chain (OP_RETURN) and make sure Paytaca's indexer has it.** A bare registry URL that is not referenced from the chain is not found.
- **Caching**: the registry is cached per authbase for **7 days**. Get the art right before the first phone sees the token, or reinstall / clear Selene's cache when testing.
- **Art**: per NFT type `uris.icon` (thumbnails) or `uris.image` (detail view), else the category's `uris`. `https://`, `ipfs://` (via ipfs.io) and `data:` URIs work; PNG, JPEG, GIF, WebP, BMP, ICO and SVG are recognised.
- **Matching an NFT to a type**: Selene supports `parse.bytecode` (parsable NFTs: it runs the bytecode and takes the bottom altstack item as the type key, the rest as fields), and sequential `parse.types` keyed by the full commitment, with a fallback that matches a commitment **prefix** against the type keys.
- For heroes whose commitment changes as they level: put a 1 byte class/sprite id first, then stats. Use `parse.bytecode` `00cf517f7c6b6b` (`OP_0 OP_UTXOTOKENCOMMITMENT OP_1 OP_SPLIT OP_SWAP OP_TOALTSTACK OP_TOALTSTACK`), which puts the first byte on the altstack as the type key (e.g. `"03"`) and the rest as one field. This was checked in the 2026 VM the way Selene runs it (no error, altstack `["03", "<rest>"]`). Then `parse.types` has one entry per class with its own `uris.icon`/`uris.image`. One picture per hero (not per class) would need a type key per hero, i.e. a hero id in the first bytes.

### Exact steps to publish BCMR for the Evermore category

1. **Write the registry** `bitcoin-cash-metadata-registry.json` (schema `https://cashtokens.org/bcmr-v2.schema.json`): `version`, `latestRevision`, `registryIdentity` (an object for an embedded identity, or the authbase string), and `identities[<authbase>][<ISO timestamp>] = { name, description, uris: { icon, web }, token: { category, symbol, nfts: { description, fields, parse: { bytecode: "00cf517f7c6b6b", types: { "01": { name, description, uris: { icon, image }, fields: [...] }, ... } } } } }`. For a CashTokens category the **authbase equals the category id**.
2. **Host it byte-exact** at a stable HTTPS URL (e.g. `https://<evermore domain>/.well-known/bitcoin-cash-metadata-registry.json`) or pin it on IPFS. Any later byte change breaks the hash; publish a new revision instead.
3. **Hash it**: `sha256sum bitcoin-cash-metadata-registry.json` (plain digest hex, not byte-reversed; Selene compares it directly).
4. **Set up the authchain at genesis.** Category id = txid of the coin spent by input 0 of the genesis transaction. Make a prep transaction whose **output 0** pays the issuer key: its txid is the authbase and the category. The genesis transaction spends `prep:0` as input 0, creates the tokens, and keeps **output 0 as a plain P2PKH to the issuer** (this is the new authhead; it can be the minting NFT's coin or a plain coin).
5. **Publish**: in the genesis transaction (or any later transaction that spends the current authhead output 0 and again pays output 0 to the issuer) add an output with value 0:
   `OP_RETURN <"BCMR"> <32-byte sha256> <uri>` = hex `6a 04 42434d52 20 <hash> <len> <utf8 uri>`. Write the URI without `https://` (e.g. `evermore.example/bcmr.json`), or as `ipfs://<cid>`. A bare domain gets `/.well-known/bitcoin-cash-metadata-registry.json` appended.
6. **Keep the chain alive**: never spend the authhead into an `OP_RETURN` at output 0 (that burns the identity). Every update is a new transaction that spends output 0, pays output 0 back to the issuer, and carries the new BCMR `OP_RETURN`.
7. **Nudge and check the indexer**: `GET https://bcmr.paytaca.com/api/bcmr/<category>/reindex/`, then `GET /api/registries/<category>/latest/` and `/api/bcmr/<category>/token/nfts/<commitment>/` should return our data. (Indexer height was 977,750 on Nov 17, so it was live.)
8. **Check on the phone**: send one test NFT to Selene and look at Assets. First fetch only; after that it is cached for 7 days.

## Open questions only the live test can answer

- Does Selene's confirm screen make sense for test B (a foreign input + our prompt), or does it look alarming (whole input total shown as spent)? Same for Paytaca and Cashonize.
- Does each wallet actually leave input 0 untouched and sign with 0x61 on device (source says yes for Selene and Cashonize; Paytaca's code not checked)?
- Does Paytaca honour `broadcast: false`, and does it accept the `wiz://` link by QR or only by paste?
- Approval round trip time on a phone (the results JSON records seconds per step) and whether the relay drops while the phone app is in the background.
- Does Selene show the wallet name and dapp name we send, and does it remember the pairing after the page reloads (this page does not persist sessions; Evermore will)?
- Do the first 20 receive + 20 change addresses hold the owner's coins, or does a long-used wallet need a bigger gap?
- BCMR art display needs a minted test category (not part of this spike): run steps 1 to 8 above on a test NFT before the real launch.

## Files

- `index.html`: the page.
- `src/main.js`: WizardConnect session, Satchel, steps A/B/C, broadcast button, results.
- `src/tx.js`: coin selection, fee (1 sat/byte, worst-case signature size), Satchel Schnorr signing (0x41), reply checks, 2026 VM verification.
- `src/chain.js`: tiny Fulcrum client over WSS (four public mainnet servers, picked in the Satchel box).
