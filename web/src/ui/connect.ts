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
  try { await enterReal(); } catch (e) { console.warn('real mode unavailable:', e); leaveReal(); return; }
  const rc = realChain();
  void rc.myHeroes().catch(() => undefined); void rc.listGhosts().catch(() => undefined);
}

const netLabel = (n: NetworkName) => (n === 'chipnet' ? 'Chipnet · test coins, not real money' : 'Bitcoin Cash mainnet');

/** The sheet: wallet, Satchel, and the switch between Practice and real play. */
export async function openConnect() {
  let rc: RealChain;
  try { rc = realChain(); } catch (e) { toast((e as Error).message, true); return; }
  let pairing: Pairing | null = null;
  let tick = 0;
  const close = () => { pairing?.cancel(); clearInterval(tick); bg.remove(); sh.remove(); };
  const bg = h('div', { class: 'sheet-bg', onClick: close });
  const body = h('div', { class: 'wrap' });
  const sh = h('div', { class: 'sheet', 'data-sheet': 'connect' }, body);
  document.body.append(bg, sh);
  if (!rc.fees().usdPerBch) rc.refreshPrice().then(() => paint()).catch(() => undefined);

  // redraws run one at a time (the BCH price can arrive while a redraw is in flight)
  let painting: Promise<void> = Promise.resolve();
  const paint = () => (painting = painting.then(paintNow, paintNow));
  // move a Satchel between browsers: paste the key exported from the other one
  const importRow = () => {
    const k = h('input', { class: 'name', placeholder: 'Paste a play key to import', 'aria-label': 'Play key', autocomplete: 'off', spellcheck: 'false', style: 'font-size:14px' }) as HTMLInputElement;
    return h('div', { style: 'margin:10px 0' }, h('p', { class: 'dim', style: 'margin:0 0 6px;font-size:14px' }, 'Playing in another browser? Export the key there, then import it here.'), k,
      h('button', { class: 'btn ghost', style: 'margin-top:8px', onClick: () => {
        const v = k.value.trim();
        try { E.Satchel.fromWif(v); } catch { toast('That is not a valid play key.', true); return; }
        if (!confirm('Use this play key in this browser? The current Satchel key here is replaced, so export it first if it holds anything.')) return;
        store.setItem(`evermore.satchel.${rc.net}`, v); toast('Play key imported. Reloading…'); setTimeout(() => location.reload(), 600);
      } }, 'Import key'));
  };
  const paintNow = async () => {
    body.innerHTML = '';
    const f = rc.fees();
    const w = rc.wallet;
    body.append(h('div', { class: 'dim', style: 'font-size:15px' }, 'Play for real'), h('p', { style: 'margin:4px 0 12px' }, netLabel(rc.net)));

    // 1. wallet
    body.append(h('div', { class: 'step' }, h('b', {}, '1'), h('span', {}, 'Connect your wallet')));
    const wl = h('div', { style: 'margin:0 0 14px' });
    if (w && (w as WizardWallet).live) {
      wl.append(h('p', { class: 'connected' }, h('i', { class: 'bchm' }), `${w.name} connected · ${short((w as WizardWallet).address)}`));
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
      btn.className = 'btn prime'; btn.style.width = '100%';
      wl.append(btn, qr, links);
    }
    body.append(wl);

    const s = await rc.satchel().catch(() => null);
    // 2. money in the play Satchel, in dollars only; shown once a wallet is connected
    const sats = s?.sats ?? 0;
    const usd = f.usdPerBch || 0;
    const live = !!(w && (w as WizardWallet).live);
    const dollars = (n: number) => usd ? `$${(n / 1e8 * usd).toFixed(2)}` : '…';
    const satsFor = (d: number) => Math.round(d / usd * 1e8);
    // add any amount in dollars; then keep reading the chain until the new balance shows
    const amt = h('input', { class: 'name amt', inputmode: 'decimal', value: '1', 'aria-label': 'Amount in dollars' }) as HTMLInputElement;
    const addBtn: HTMLButtonElement = h('button', { class: 'btn prime', disabled: !usd, onClick: async () => {
      const d = Number(amt.value);
      if (!(d >= 0.1)) { toast('Enter at least $0.10.', true); return; }
      addBtn.disabled = true; addBtn.textContent = 'Approve in your wallet…';
      try {
        const before = (await rc.satchel()).sats;
        const r = await rc.fund(satsFor(d));
        addBtn.textContent = 'Adding…';
        for (let i = 0; i < 20; i++) { await new Promise(res => setTimeout(res, 1000)); rc.forget(); if ((await rc.satchel()).sats > before) break; }
        toastLink(`Added $${d.toFixed(2)} to your Satchel`, r.explorer);
        await paint(); renderChrome();
      } catch (err) { toast((err as Error).message, true); await paint(); }
    } }, 'Add');
    if (live || sats > 0) {
      body.append(h('div', { class: 'step' }, h('b', {}, '2'), h('span', {}, 'Add money to play')),
        h('div', { class: 'satbal' }, h('span', {}, 'Satchel'), h('b', {}, dollars(sats))),
        h('p', { class: 'dim', style: 'margin:0 0 10px;font-size:15px' }, usd ? `A hero costs about ${money(f.raiseSats, usd)}; each fight about ${money(f.challengeSats, usd)}. Fights use this Satchel, so nothing pops up mid fight.` : 'Reading the BCH price…'));
      if (live) body.append(h('div', { class: 'addrow' }, h('span', { class: 'cur' }, '$'), amt, addBtn), h('p', { class: 'dim', style: 'margin:6px 0 0;font-size:13px' }, 'One approval in your wallet. You can add any amount, and empty it back to your wallet any time.'));
    }

    // 3. start
    const enough = sats >= f.raiseSats || (await rc.myHeroes().catch(() => [])).length > 0;
    const sw = h('div', { style: 'margin-top:14px' });
    if (isPractice()) {
      if (live || sats > 0) sw.append(h('div', { class: 'step' }, h('b', {}, '3'), h('span', {}, 'Play')),
        h('button', { class: 'btn prime', style: 'width:100%', disabled: !enough, onClick: async () => { await enterReal(); close(); go(app.route === 'duel' ? 'arena' : app.route); toast('Playing on Bitcoin Cash. Every action is a real transaction.'); } },
          'Start playing', h('small', {}, enough ? 'on Bitcoin Cash' : `add at least ${money(f.raiseSats, usd)} first`)));
    } else {
      sw.append(h('button', { class: 'btn ghost', onClick: () => { leaveReal(); close(); go(app.route === 'duel' ? 'arena' : app.route); toast('Back to practice. Nothing on chain.'); } }, 'Back to practice'));
    }
    body.append(sw);

    // the details, folded: address, sats, backup, empty
    const det = h('details', { class: 'satdetails' }, h('summary', {}, 'Satchel details'),
      h('p', { style: 'margin:8px 0;font-size:14px;word-break:break-all' }, `${sats.toLocaleString()} sats · `, h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); navigator.clipboard?.writeText(rc.satchelKey.address(rc.net)).then(() => toast('Satchel address copied.')); } }, rc.satchelKey.address(rc.net))),
      h('p', { class: 'dim', style: 'margin:0 0 10px;font-size:14px' }, 'The Satchel is a play key kept in this browser. Send heroes home to your wallet to keep them forever, and export the key as a backup.'),
      importRow(),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onClick: async () => { const k = await rc.exportKey(); await navigator.clipboard?.writeText(k); toast('Play key copied. Keep it secret.'); } }, 'Export key'),
        w ? h('button', { class: 'btn ghost', disabled: !sats, onClick: async () => {
          try { const r = await rc.withdrawAll(); toast('Satchel emptied to your wallet.'); link(r.explorer); await paint(); renderChrome(); } catch (err) { toast((err as Error).message, true); }
        } }, 'Empty to wallet') : null));
    body.append(det);
  };
  await paint();
  // the balance refreshes on its own while the sheet is open (a payment can land a moment later)
  let lastSats = (await rc.satchel().catch(() => null))?.sats ?? 0;
  tick = window.setInterval(async () => {
    if (document.activeElement?.classList.contains('amt')) return;
    rc.forget(); const n = (await rc.satchel().catch(() => null))?.sats ?? lastSats;
    if (n !== lastSats) { lastSats = n; await paint(); renderChrome(); }
  }, 5000);
}

const short = (a: string) => { const s = a.replace(/^[a-z]+:/, ''); return `${s.slice(0, 5)}…${s.slice(-4)}`; };
function link(url: string | null) { if (url) console.info('tx', url); }
/** a toast with a link to the transaction */
function toastLink(text: string, url: string | null) {
  const a = h('a', { class: 'toast tx-receipt', href: url ?? '#', target: '_blank', rel: 'noopener', style: 'pointer-events:auto;text-decoration:none;top:calc(108px + var(--safe-t))' }, `${text}${url ? ' · view ↗' : ''}`);
  document.body.append(a); setTimeout(() => a.remove(), 7000);
}

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
