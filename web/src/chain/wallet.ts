// The player's home wallet over WizardConnect (Selene, Cashonize, Paytaca).
// Facts from spike S2: the dapp makes the pairing link; the wallet shares xpubs for receive,
// change and defi; the only request is sign_transaction_request; wallets sign only the inputs
// we name (sighash 0x61) and we always broadcast ourselves; the network is read from the xpub.
import { initiateDappRelay, type DappRelayResult, type PathXpub } from '@wizardconnect/core';
import { DappConnectionManager, loadSession, clearSession } from '@wizardconnect/dapp';
import { binToHex } from '@bitauth/libauth';
import * as E from '../../../sdk/src/index.ts';
import type { Built, NetworkName, WalletKey } from '../../../sdk/src/index.ts';
import type { HomeWallet } from './realChain.ts';

const RELAYS = ['wss://relay.riften.net:443', 'wss://relay.cauldron.quest:443'];
const DAPP_NAME = 'Evermore';
const RECEIVE_GAP = 10, CHANGE_GAP = 5;
const sessionKey = (net: NetworkName) => `evermore.wc.${net}`;

export class WizardWallet implements HomeWallet {
  readonly net: NetworkName;
  name: string;
  private paths: PathXpub[];
  private mgr: DappConnectionManager | null = null;
  private relay: DappRelayResult | null = null;
  private nudge: ReturnType<typeof setInterval> | null = null;
  live = false;
  onChange: (() => void) | null = null;
  private keyCache: WalletKey[] | null = null;

  constructor(net: NetworkName, name: string, paths: PathXpub[]) {
    E.assertWalletNetwork(paths.map((p) => p.xpub), net);
    this.net = net; this.name = name; this.paths = paths;
  }

  private xpub(name: string) { return this.paths.find((p) => p.name === name)?.xpub ?? null; }
  keys(): WalletKey[] {
    if (this.keyCache) return this.keyCache;
    const r = this.xpub('receive'), c = this.xpub('change');
    this.keyCache = [
      ...(r ? E.walletKeys('receive', r, this.net, RECEIVE_GAP) : []),
      ...(c ? E.walletKeys('change', c, this.net, CHANGE_GAP) : []),
    ];
    return this.keyCache;
  }
  receiveLock() { const k = this.keys().find((x) => x.path === 'receive'); if (!k) throw new Error('wallet shared no receive path'); return k.lock; }
  changeLock() { return (this.keys().find((x) => x.path === 'change') ?? this.keys()[0]).lock; }
  get address() { return E.lockToAddress(this.receiveLock(), this.net === 'mainnet' ? 'bitcoincash' : 'bchtest'); }

  /** Present only while a live session can sign. */
  get sign(): ((b: Built, prompt: string) => Promise<string>) | undefined {
    if (!this.mgr || !this.live) return undefined;
    const mgr = this.mgr;
    return async (built, prompt) => {
      const req = E.toSignRequest(built, prompt);
      const reply = await mgr.signTransaction(req as any);
      if (reply?.error) throw new Error(`Your wallet said: ${reply.error}`);
      const signed = reply.signedTransaction as unknown;
      return typeof signed === 'string' ? signed : binToHex(signed as Uint8Array);
    };
  }

  attach(mgr: DappConnectionManager, relay: DappRelayResult, nudge: ReturnType<typeof setInterval> | null, live = true) {
    this.mgr = mgr; this.relay = relay; this.nudge = nudge; this.live = live;
    mgr.on('walletready', () => { this.live = true; this.onChange?.(); });
    mgr.on('disconnect', () => { this.live = false; this.onChange?.(); });
  }

  async disconnect(forget = true) {
    if (this.nudge) clearInterval(this.nudge);
    const mgr = this.mgr, relay = this.relay;
    this.mgr = null; this.relay = null; this.live = false;
    if (mgr) { await mgr.sendDisconnect('Evermore closed the session').catch(() => undefined); await mgr.destroy().catch(() => undefined); }
    relay?.cleanup();
    if (forget) { try { clearSession(sessionKey(this.net), localStorage); } catch { /* */ } }
  }

  /** A wallet remembered from an earlier session (read only until it reconnects). */
  static remembered(net: NetworkName): WizardWallet | null {
    try {
      const s = loadSession(sessionKey(net), localStorage);
      if (!s?.paths?.length) return null;
      return new WizardWallet(net, s.walletName ?? 'Wallet', s.paths);
    } catch { return null; }
  }
}

export type Pairing = { uri: string; qrUri: string; cashonize: string; cancel: () => void };

function manager(net: NetworkName) {
  return new DappConnectionManager(DAPP_NAME, `${location.origin}/icon.png`, { session: { key: sessionKey(net), storage: localStorage } });
}

/** Wire a manager to a relay with the late join nudge (dapp 0.2.7 stops waiting after 30 s). */
function wire(mgr: DappConnectionManager, existing?: { privateKey: string; secret: string; walletPublicKey: string }) {
  const late = { client: null as any, connectedAt: 0, nudgedAt: 0 };
  const relay = initiateDappRelay((p) => {
    if (p.client) late.client = p.client;
    if (p.status?.status === 'connected') late.connectedAt = Date.now();
    mgr.updateConnection(p.client, p.status);
  }, { explicitRelayUrls: RELAYS, ...(existing ? { existingCredentials: existing } : {}) });
  mgr.attachRelay(relay);
  const nudge = setInterval(() => {
    if (mgr.isWalletDiscovered()) return;
    const c = late.client;
    if (!c || !late.connectedAt || !c.isKeyExchangeComplete?.()) return;
    const now = Date.now();
    if (now - late.connectedAt < 30_000 || now - late.nudgedAt < 10_000) return;
    late.nudgedAt = now;
    mgr.updateConnection(c, { status: 'connected' } as any);
  }, 1000);
  return { relay, nudge };
}

/**
 * Start a new pairing. Resolves `onReady` with a live wallet once the wallet joins and its
 * xpubs are on the game network; `onError` gets a plain message otherwise.
 */
export function pair(net: NetworkName, onReady: (w: WizardWallet) => void, onError: (msg: string) => void): Pairing {
  const mgr = manager(net);
  const { relay, nudge } = wire(mgr);
  let done = false;
  mgr.on('walletready', () => {
    if (done) return;
    const paths = mgr.getSessionPaths();
    try {
      const w = new WizardWallet(net, mgr.walletName ?? 'Wallet', paths);
      done = true;
      w.attach(mgr, relay, nudge);
      onReady(w);
    } catch (e) {
      onError(`${(e as Error).message}`);
      void mgr.sendDisconnect('wrong network').catch(() => undefined);
    }
  });
  mgr.on('disconnect', (_r, m) => { if (!done) onError(m ? `Wallet disconnected: ${m}` : 'Wallet disconnected.'); });
  return {
    uri: relay.uri, qrUri: relay.qrUri,
    cashonize: `https://cashonize.com/?uri=${encodeURIComponent(relay.uri)}`,
    cancel: () => { if (!done) { clearInterval(nudge); void mgr.destroy().catch(() => undefined); relay.cleanup(); } },
  };
}

/** Reconnect a remembered session in the background (the wallet app must be open to sign). */
export function resume(w: WizardWallet): boolean {
  try {
    const s = loadSession(sessionKey(w.net), localStorage);
    if (!s?.walletPublicKey || !s.paths?.length) return false;
    const mgr = manager(w.net);
    mgr.restoreSessionPaths(s.paths);
    const { relay, nudge } = wire(mgr, { privateKey: s.privateKey, secret: s.secret, walletPublicKey: s.walletPublicKey });
    w.attach(mgr, relay, nudge, false); // live again once the wallet answers
    return true;
  } catch { return false; }
}
