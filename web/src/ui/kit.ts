// Small DOM helpers, pixel icons and money words.
import { R, sheet, type Layer } from '../gfx/atlas';
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

// 9x9 pixel icons, one bitmap language for the whole UI
const ICONS: Record<string, string[]> = {
  strike: ['........#', '.......##', '......##.', '.....##..', '#..##....', '.###.....', '..##.....', '.#..#....', '#........'],
  guard: ['.#######.', '#ooooooo#', '#ooo#ooo#', '#ooo#ooo#', '#o#####o#', '.#oo#oo#.', '.#oo#oo#.', '..#ooo#..', '...###...'],
  special: ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  sound: ['....#....', '...##.#..', '#####..#.', '#####.#.#', '#####.#.#', '#####.#.#', '#####..#.', '...##.#..', '....#....'],
  muted: ['....#....', '...##....', '#####....', '#####.#.#', '#####..#.', '#####.#.#', '#####....', '...##....', '....#....'],
  pouch: ['...###...', '..#...#..', '...###...', '.#######.', '#ooooooo#', '#oo###oo#', '#ooo#ooo#', '#ooooooo#', '.#######.'],
  dice: ['#########', '#ooooooo#', '#o#ooo#o#', '#ooooooo#', '#ooo#ooo#', '#ooooooo#', '#o#ooo#o#', '#ooooooo#', '#########'],
  left: ['.....#...', '....##...', '...###...', '..####...', '.#####...', '..####...', '...###...', '....##...', '.....#...'],
  right: ['...#.....', '...##....', '...###...', '...####..', '...#####.', '...####..', '...###...', '...##....', '...#.....'],
  link: ['....#####', '.....####', '......###', '.....#.##', '#...#...#', '#..#.....', '#........', '#........', '#######..'],
};

export function icon(name: string, color = 'currentColor', fill = 'rgba(0,0,0,0.25)', px = 3) {
  const rows = ICONS[name], c = document.createElement('canvas');
  c.width = 9 * px; c.height = 9 * px; c.className = 'px';
  const x = c.getContext('2d')!;
  const col = color === 'currentColor' ? '#efe6d2' : color;
  rows.forEach((r, j) => [...r].forEach((ch, i) => {
    if (ch === '#') { x.fillStyle = col; x.fillRect(i * px, j * px, px, px); }
    if (ch === 'o') { x.fillStyle = fill; x.fillRect(i * px, j * px, px, px); }
  }));
  return c;
}
export const iconRows = (name: string) => ICONS[name];

/** A sprite frame from the sheet as a crisp DOM canvas. */
export function sprite(name: string, frame = 0, px = 3, layer: Layer = 'img', box?: [number, number]) {
  const r = R[name], c = document.createElement('canvas'); c.className = 'px';
  const bw = box?.[0] ?? r[2], bh = box?.[1] ?? r[3];
  c.width = bw * px; c.height = bh * px;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
  x.drawImage(sheet[layer], r[0] + frame * r[2], r[1], r[2], r[3], Math.floor((bw - r[2]) / 2) * px, (bh - r[3]) * px, r[2] * px, r[3] * px);
  return c;
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

export function tapSound(el: HTMLElement, s: () => void = sfx.tap) { el.addEventListener('pointerdown', () => s()); return el; }
