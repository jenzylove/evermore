// "Play for real": pick the chain, connect a wallet over WizardConnect, fund the Satchel, then
// every action goes through RealChain. Practice stays the default and stays labelled.
import QRCode from 'qrcode';
import * as E from '../../../sdk/src/index.ts';
import type { Deployment, NetworkName } from '../../../sdk/src/index.ts';
import { RealChain, type KV } from '../chain/realChain';
import { WizardWallet, pair, resume, type Pairing } from '../chain/wallet';
import { app, go, isPractice, renderChrome, usePractice, useRealChain } from '../app';
import { h, money, toast } from './kit';

const MODE_KEY = 'evermore.mode';
const deployments = import.meta.glob('../../../contracts/deployments/{chipnet,mainnet}.json', { eager: true, import: 'default' }) as Record<string, Deployment>;
/** House heroes (scripts/wardens.mjs): id -> name, shown to every player. */
const wardens = import.meta.glob('../../../contracts/deployments/wardens-{chipnet,mainnet}.json', { eager: true, import: 'default' }) as Record<string, { category: string; labels: Record<string, string> }>;

/** Network from VITE_EVERMORE_NET, else ?net= / localStorage, else mainnet. */
export function realNet(): NetworkName {
  const q = new URLSearchParams(location.search).get('net');
  const v = (import.meta.env.VITE_EVERMORE_NET as string | undefined) ?? q ?? store.getItem('evermore.net') ?? 'mainnet';
  return v === 'mainnet' ? 'mainnet' : 'chipnet';
}
const store: KV = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

async function bchUsd(): Promise<number | null> {
  const get = async (url: string, pick: (j: any) => number) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(String(r.status));
    const n = Number(pick(await r.json()));
    if (!(n > 0)) throw new Error('bad price');
    return n;
  };
  try { return await get('https://api.coinbase.com/v2/prices/BCH-USD/spot', (j) => j.data.amount); } catch { /* next */ }
  try { return await get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd', (j) => j['bitcoin-cash'].usd); } catch { /* none */ }
  return null;
}

let real: RealChain | null = null;
/** The RealChain for the configured network (one per page), with its Satchel and remembered wallet. */
export function realChain(): RealChain {
  if (real) return real;
  const net = realNet();
  const dep = Object.entries(deployments).find(([p]) => p.endsWith(`/${net}.json`))?.[1];
  if (!dep) throw new Error(`Evermore is not deployed on ${net} yet.`);
  const sk = `evermore.satchel.${net}`;
  let wif = store.getItem(sk);
  if (!wif) {
    wif = E.Satchel.generate().toWif(net); store.setItem(sk, wif);
    // a Satchel key that cannot be saved would be lost on reload with its coins: refuse to start
    if (store.getItem(sk) !== wif) throw new Error('This browser is blocking storage (private mode or an in app browser), so your play Satchel could not be saved. Open Evermore in a normal browser tab to play for real. Practice works here.');
  }
  const wallet = WizardWallet.remembered(net);
  if (wallet) resume(wallet);
  const w = Object.entries(wardens).find(([p]) => p.endsWith(`/wardens-${net}.json`))?.[1];
  const labels = w && w.category === dep.category ? w.labels : {};
  real = new RealChain({ deployment: dep, net, labels, satchel: E.Satchel.fromWif(wif), storage: store, wallet, price: bchUsd, onBroadcast: receipt });
  if (wallet) wallet.onChange = () => renderChrome();
  return real;
}

/** Switch every screen to the real chain (remembered across reloads). */
export async function enterReal() {
  const rc = realChain();
  if (!rc.fees().usdPerBch) await rc.refreshPrice();
  useRealChain(rc);
  store.setItem(MODE_KEY, 'real');
}
export function leaveReal() { usePractice(); store.setItem(MODE_KEY, 'practice'); }

/** On boot: come back in the mode the player left in. */
export async function restoreMode() {
  if (store.getItem(MODE_KEY) !== 'real') return;
  try { await enterReal(); } catch (e) { console.warn('real mode unavailable:', e); leaveReal(); }
}

const netLabel = (n: NetworkName) => (n === 'chipnet' ? 'Chipnet · test coins, not real money' : 'Bitcoin Cash mainnet');

/** The sheet: wallet, Satchel, and the switch between Practice and real play. */
export async function openConnect() {
  let rc: RealChain;
  try { rc = realChain(); } catch (e) { toast((e as Error).message, true); return; }
  let pairing: Pairing | null = null;
  const close = () => { pairing?.cancel(); bg.remove(); sh.remove(); };
  const bg = h('div', { class: 'sheet-bg', onClick: close });
  const body = h('div', { class: 'wrap' });
  const sh = h('div', { class: 'sheet', 'data-sheet': 'connect' }, body);
  document.body.append(bg, sh);

  const paint = async () => {
    body.innerHTML = '';
    const f = rc.fees();
    const s = await rc.satchel().catch(() => null);
    const w = rc.wallet;
    body.append(h('div', { class: 'dim', style: 'font-size:15px' }, 'Play for real'), h('p', { style: 'margin:4px 0 12px' }, netLabel(rc.net)));

    // 1. wallet
    const wl = h('div', { style: 'margin:0 0 14px' });
    if (w && (w as WizardWallet).live) {
      wl.append(h('p', { style: 'margin:0' }, `Wallet: ${w.name} · ${short((w as WizardWallet).address)}`));
    } else {
      wl.append(h('p', { style: 'margin:0 0 8px' }, w ? `Wallet ${w.name} is remembered but not connected. Open it and connect again to sign.` :
        `Connect Selene, Cashonize or Paytaca${rc.net === 'chipnet' ? ' (switched to chipnet)' : ''}. It only signs what you approve.`));
      const qr = h('canvas', { style: 'display:none;background:#fff;border-radius:6px;margin:8px 0;max-width:240px;width:100%' }) as HTMLCanvasElement;
      const links = h('div', { class: 'row', style: 'display:none' });
      const btn = h('button', { class: 'btn', onClick: async () => {
        btn.setAttribute('disabled', '');
        pairing?.cancel();
        pairing = pair(rc.net, async (nw) => {
          pairing = null;
          if (rc.wallet && rc.wallet !== nw) await (rc.wallet as WizardWallet).disconnect?.(false).catch(() => undefined);
          rc.wallet = nw; nw.onChange = () => renderChrome();
          toast(`${nw.name} connected.`); void paint(); renderChrome();
        }, (msg) => { toast(msg, true); btn.removeAttribute('disabled'); });
        await QRCode.toCanvas(qr, pairing.qrUri, { errorCorrectionLevel: 'L', margin: 2, width: 240 });
        qr.style.display = 'block';
        links.style.display = '';
        links.innerHTML = '';
        links.append(
          h('a', { class: 'btn ghost', href: pairing.cashonize, target: '_blank', rel: 'noopener' }, 'Open in Cashonize'),
          h('button', { class: 'btn ghost', onClick: () => navigator.clipboard?.writeText(pairing!.uri).then(() => toast('Link copied. Paste it in your wallet.')) }, 'Copy link'));
      } }, w ? 'Reconnect wallet' : 'Connect wallet');
      wl.append(btn, qr, links);
    }
    body.append(wl);

    // 2. satchel
    const sats = s?.sats ?? 0;
    body.append(h('div', { class: 'dim', style: 'font-size:15px' }, 'Satchel'),
      h('div', { class: 'bal' }, s ? money(sats, f.usdPerBch) : '…'),
      h('p', { style: 'margin:0 0 8px;font-size:14px;word-break:break-all' }, `${sats.toLocaleString()} sats · `, h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); navigator.clipboard?.writeText(rc.satchelKey.address(rc.net)).then(() => toast('Satchel address copied.')); } }, rc.satchelKey.address(rc.net))),
      h('p', { style: 'margin:0 0 10px;font-size:14px' }, 'A play key in this browser pays for duels so nothing pops up mid fight. Export it to keep a backup.'));
    const usd = f.usdPerBch || 0;
    const satsFor = (dollars: number) => usd ? Math.round(dollars / usd * 1e8) : Number(f.raiseSats) * dollars;
    const fund = (dollars: number) => h('button', { class: 'btn', disabled: !(w && (w as WizardWallet).live), onClick: async (e: Event) => {
      const b = e.currentTarget as HTMLButtonElement; b.disabled = true;
      try { const r = await rc.fund(satsFor(dollars)); toast('Satchel funded.'); link(r.explorer); await paint(); renderChrome(); }
      catch (err) { toast((err as Error).message, true); b.disabled = false; }
    } }, `Add ${usd ? `$${dollars}` : `${satsFor(dollars)} sats`}`);
    body.append(h('div', { class: 'row' }, fund(1), fund(5),
      h('button', { class: 'btn ghost', onClick: async () => { const k = await rc.exportKey(); await navigator.clipboard?.writeText(k); toast('Play key copied. Keep it secret.'); } }, 'Export key'),
      w ? h('button', { class: 'btn ghost', disabled: !sats, onClick: async () => {
        try { const r = await rc.withdrawAll(); toast('Satchel emptied to your wallet.'); link(r.explorer); await paint(); renderChrome(); } catch (err) { toast((err as Error).message, true); }
      } }, 'Empty to wallet') : null));

    // 3. switch
    const enough = sats >= f.raiseSats || (await rc.myHeroes().catch(() => [])).length > 0;
    const sw = h('div', { class: 'row', style: 'margin-top:14px' });
    if (isPractice()) {
      sw.append(h('button', { class: 'btn prime', disabled: !enough, onClick: async () => { await enterReal(); close(); go(app.route === 'duel' ? 'arena' : app.route); toast(`Playing on ${rc.net}. Every action is a real transaction.`); } },
        'Play for real', h('small', {}, enough ? rc.net : `needs ${money(f.raiseSats, f.usdPerBch)} to raise`)));
    } else {
      sw.append(h('button', { class: 'btn ghost', onClick: () => { leaveReal(); close(); go(app.route === 'duel' ? 'arena' : app.route); toast('Back to practice. Nothing on chain.'); } }, 'Back to practice'));
    }
    body.append(sw);
  };
  await paint();
}

const short = (a: string) => { const s = a.replace(/^[a-z]+:/, ''); return `${s.slice(0, 5)}…${s.slice(-4)}`; };
function link(url: string | null) { if (url) console.info('tx', url); }

const VERB: Record<string, string> = {
  raise: 'Hero raised', challenge: 'Challenge paid', forge: 'Forge sealed', list: 'Listed', buy: 'Bought', cancel: 'Listing cancelled',
  'send-home': 'Sent home', 'bring-back': 'Brought back', fund: 'Satchel funded', withdraw: 'Satchel emptied',
};
/** Every real transaction gets a receipt with its explorer link. */
function receipt(kind: string, txid: string, url: string) {
  document.querySelector('.tx-receipt')?.remove();
  const a = h('a', { class: 'toast tx-receipt', href: url, target: '_blank', rel: 'noopener', 'data-txid': txid, style: 'pointer-events:auto;text-decoration:none;top:calc(108px + var(--safe-t))' },
    `${VERB[kind] ?? kind} · ${txid.slice(0, 8)}… ↗`);
  document.body.append(a);
  setTimeout(() => a.remove(), 6000);
}
