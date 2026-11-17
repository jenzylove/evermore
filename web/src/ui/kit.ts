// Small DOM helpers, line icons and money words.
import { sfx } from '../audio/sfx';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) (el as unknown as Record<string, unknown>)[k.toLowerCase()] = v;
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c as Node | string);
  return el;
}

// one line weight, one corner language: 24 unit viewBox, 1.75 stroke, square caps
const ICONS: Record<string, string> = {
  strike: '<path d="M4 20 15 9M15 9l5-5v4l-3 3M15 9h-4l5-5M6 15l3 3M3 21l2-2"/>',
  guard: '<path d="M12 3 4.5 6v6c0 4.4 3.2 7.6 7.5 9 4.3-1.4 7.5-4.6 7.5-9V6L12 3Z"/><path d="M12 7.5v9"/>',
  special: '<path d="M12 2.5 14.2 9l6.3.6-4.8 4.2 1.5 6.4L12 16.8l-5.2 3.4 1.5-6.4-4.8-4.2L9.8 9 12 2.5Z"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  muted: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  pouch: '<path d="M8.5 6.5h7M9 3.5h6l-1.5 3h-3L9 3.5Z"/><path d="M7 8.5c-2.5 2.2-3.5 5-3 8 .4 2.4 2.6 4 5 4h6c2.4 0 4.6-1.6 5-4 .5-3-.5-5.8-3-8"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="1"/><circle cx="8.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
  left: '<path d="M15 4 7 12l8 8"/>',
  right: '<path d="m9 4 8 8-8 8"/>',
  link: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  blade: '<path d="M5 19 17 7l2-2-.5 3L7 19.5M5 19l-1 1M7 14.5l2.5 2.5"/>',
  heavy: '<path d="M6 21 15.5 11.5"/><path d="M13 6.5c2-2.5 5-3 7-2.5.5 2-.1 5-2.5 7l-2-2-2.5-2.5Z"/>',
  flask: '<path d="M10 3.5h4M10.5 3.5v5L6 17a2.5 2.5 0 0 0 2.2 3.5h7.6A2.5 2.5 0 0 0 18 17l-4.5-8.5v-5"/><path d="M7.5 14h9"/>',
  crown: '<path d="m4 8 4 4 4-7 4 7 4-4-1.5 10h-13L4 8Z"/>',
};
export function icon(name: string, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', `ic ${cls}`); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] ?? '';
  return s as unknown as HTMLElement;
}

let toastEl: HTMLElement | null = null;
export function toast(msg: string, err = false) {
  toastEl?.remove();
  toastEl = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  document.body.append(toastEl);
  if (err) sfx.soft();
  const el = toastEl; setTimeout(() => el.remove(), 3200);
}

export function money(sats: number, usdPerBch: number) {
  const c = (sats / 1e8) * usdPerBch * 100;
  if (c < 99.5) return `${Math.max(1, Math.round(c))} cent${Math.round(c) === 1 ? '' : 's'}`;
  return `$${(c / 100).toFixed(2)}`;
}
export const shortCents = (sats: number, usdPerBch: number) => {
  const c = (sats / 1e8) * usdPerBch * 100;
  return c < 99.5 ? `${Math.max(1, Math.round(c))}¢` : `$${(c / 100).toFixed(2)}`;
};

export const GEAR_NAMES = [['Iron Blade', 'Gem Blade', 'Gold Blade'], ['Old Mace', 'War Axe', 'Long Spear'], ['Red Flask', 'Blue Flask', 'Gold Flask']];
export const gearName = (kind: number, tier: number) => GEAR_NAMES[kind][Math.min(2, Math.max(0, tier - 1))];
export const gearIcon = (kind: number, tier: number) => { const i = icon(['blade', 'heavy', 'flask'][kind], `gear t${Math.min(3, tier)}`); return i; };
