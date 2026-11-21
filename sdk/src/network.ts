// Network config. Chipnet first; mainnet uses the same code with a different deployment.
export type NetworkName = 'chipnet' | 'mainnet';
export type ElectrumServer = { host: string; port: number };
export type NetworkConfig = {
  name: NetworkName;
  /** CashAddress prefix. */
  prefix: 'bchtest' | 'bitcoincash';
  /** Fulcrum servers reachable over secure WebSocket, tried in order. */
  electrum: ElectrumServer[];
  /** Explorer link for a txid. */
  explorerTx: (txid: string) => string;
  /** ParyonUSD category (display order), where it exists */
  pusdCategory?: string;
  /** Default fee rate, sats per byte. */
  feeRate: number;
};

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  chipnet: {
    name: 'chipnet',
    prefix: 'bchtest',
    electrum: [
      { host: 'chipnet.imaginary.cash', port: 50004 },
      { host: 'chipnet.bch.ninja', port: 50004 },
    ],
    explorerTx: (txid) => `https://chipnet.imaginary.cash/tx/${txid}`,
    feeRate: 1,
  },
  mainnet: {
    name: 'mainnet',
    prefix: 'bitcoincash',
    electrum: [
      { host: 'bch.imaginary.cash', port: 50004 },
      { host: 'electrum.imaginary.cash', port: 50004 },
      { host: 'bch.loping.net', port: 50004 },
      { host: 'fulcrum.greyh.at', port: 50004 },
    ],
    explorerTx: (txid) => `https://blockchair.com/bitcoin-cash/transaction/${txid}`,
    pusdCategory: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
    feeRate: 1,
  },
};

export const network = (name: NetworkName): NetworkConfig => {
  const n = NETWORKS[name];
  if (!n) throw new Error(`unknown network ${name}`);
  return n;
};
