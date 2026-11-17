// BCMR (Bitcoin Cash Metadata Registry) for the Evermore category, so wallets (Selene,
// Paytaca, Cashonize) show heroes and gear with art. See docs/spikes S2 for how Selene
// resolves it: authchain from the authbase (= category id), latest OP_RETURN BCMR output.
import { sha256, utf8ToBin, binToHex } from '@bitauth/libauth';

/**
 * Parse bytecode: type key = tag byte || byte 5 (hero class, gear kind), one field = the
 * whole commitment. OP_0 OP_UTXOTOKENCOMMITMENT OP_DUP OP_1 OP_SPLIT OP_DROP OP_OVER OP_5
 * OP_SPLIT OP_NIP OP_1 OP_SPLIT OP_DROP OP_CAT OP_TOALTSTACK OP_TOALTSTACK.
 */
export const BCMR_PARSE_BYTECODE = '00cf76517f7578557f77517f757e6b6b';

export type RegistryOptions = {
  category: string;
  /** base https URL for art, e.g. https://evermore.example/art (files: knight.png, rogue.png, mage.png, gear-0.png ...) */
  artBase: string;
  web: string;
  icon?: string;
  name?: string;
  symbol?: string;
  description?: string;
  timestamp?: string;
};

export function buildRegistry(o: RegistryOptions) {
  const ts = o.timestamp ?? new Date().toISOString();
  const art = (f: string) => ({ icon: `${o.artBase}/${f}`, image: `${o.artBase}/${f}` });

  const types: Record<string, unknown> = {};
  ['Knight', 'Rogue', 'Mage'].forEach((n, i) => {
    types[`480${i}`] = { name: `Evermore ${n}`, description: `A ${n} hero. Every level was earned in a duel the chain replayed.`, fields: ['commitment'], uris: art(`${n.toLowerCase()}.png`) };
  });
  ['Blade', 'Shield', 'Charm'].forEach((n, i) => {
    types[`450${i}`] = { name: `Evermore ${n}`, description: `Gear won by beating a ghost 3+ levels above. Capped supply.`, fields: ['commitment'], uris: art(`gear-${i}.png`) };
  });
  return {
    $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
    version: { major: 1, minor: 0, patch: 0 },
    latestRevision: ts,
    registryIdentity: { name: 'Evermore', description: 'Evermore game registry', uris: { web: o.web } },
    identities: {
      [o.category]: {
        [ts]: {
          name: o.name ?? 'Evermore',
          description: o.description ?? 'Heroes that live on Bitcoin Cash. Games die. Heroes do not.',
          uris: { icon: o.icon ?? `${o.artBase}/icon.png`, web: o.web },
          token: {
            category: o.category,
            symbol: o.symbol ?? 'EVER',
            nfts: { description: 'Evermore heroes and gear', fields, parse: { bytecode: BCMR_PARSE_BYTECODE, types } },
          },
        },
      },
    },
  };
}
const fields = { commitment: { name: 'Save data', description: 'Hero or gear state, written only by the Evermore covenants', encoding: { type: 'binary' } } };

/** OP_RETURN <'BCMR'> <sha256(registry bytes)> <uri without https://> */
export function bcmrOpReturn(registryBytes: Uint8Array, uri: string): { lock: Uint8Array; sha256: string } {
  const h = sha256.hash(registryBytes);
  const u = utf8ToBin(uri.replace(/^https:\/\//, ''));
  if (u.length > 75) throw new Error('BCMR uri too long for a single push (75 bytes)');
  return { lock: Uint8Array.from([0x6a, 0x04, 0x42, 0x43, 0x4d, 0x52, 0x20, ...h, u.length, ...u]), sha256: binToHex(h) };
}
