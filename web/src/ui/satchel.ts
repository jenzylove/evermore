// Satchel: a small sheet, out of the way. Balance, fund from your wallet, export the play key.
import { app, isPractice, renderChrome, go } from '../app';
import { practice } from '../app';
import { h, money, toast } from './kit';

export async function openSatchel() {
  const s = await app.chain.satchel();
  const f = app.chain.fees();
  const close = () => { bg.remove(); sh.remove(); };
  const bg = h('div', { class: 'sheet-bg', onClick: close });
  const body = h('div', { class: 'wrap' }, h('div', { class: 'dim', style: 'font-size:15px' }, 'Satchel'), h('div', { class: 'bal' }, money(s.sats, f.usdPerBch)));
  if (isPractice()) {
    body.append(h('p', {}, 'Practice purse. Not real money; nothing here is on chain. Fees are taken from it so the game plays the same.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onClick: async () => { await app.chain.fund(Math.round(5 / f.usdPerBch * 1e8)); close(); renderChrome(); toast('Practice purse topped up.'); } }, 'Top up'),
        h('button', { class: 'btn ghost', onClick: () => { if (confirm('Start practice over? Your practice heroes will be gone.')) { practice.reset(); close(); try { localStorage.removeItem('evermore.hero'); } catch { /* */ } app.heroId = null; go('front'); } } }, 'Start over')));
  } else {
    body.append(h('p', {}, `The play key in this browser pays for duels so nothing pops up mid fight.${s.connected ? ` Home wallet: ${s.connected}.` : ''}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onClick: async () => { try { const r = await app.chain.fund(Math.round(1 / f.usdPerBch * 1e8)); close(); renderChrome(); toast('Satchel funded.'); void r; } catch (e) { toast((e as Error).message, true); } } }, 'Add $1 from wallet'),
        h('button', { class: 'btn ghost', onClick: async () => { const k = await app.chain.exportKey(); if (k) { await navigator.clipboard?.writeText(k); toast('Play key copied. Keep it secret.'); } } }, 'Export key')));
  }
  const sh = h('div', { class: 'sheet' }, body);
  document.body.append(bg, sh);
}
