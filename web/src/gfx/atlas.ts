// One sprite sheet, one style: 0x72 DungeonTileset II (CC0). Rects from its tiles_list_v1.3.
type Rect = [x: number, y: number, w: number, h: number, frames?: number];

export const R: Record<string, Rect> = {
  wall_top_mid: [32, 0, 16, 16], wall_mid: [32, 16, 16, 16], wall_left: [16, 16, 16, 16], wall_right: [48, 16, 16, 16],
  wall_top_left: [16, 0, 16, 16], wall_top_right: [48, 0, 16, 16],
  wall_fountain_top: [64, 0, 16, 16], wall_fountain_mid_red: [64, 16, 16, 16, 3], wall_fountain_basin_red: [64, 32, 16, 16, 3],
  wall_fountain_mid_blue: [64, 48, 16, 16, 3], wall_fountain_basin_blue: [64, 64, 16, 16, 3],
  wall_banner_red: [16, 32, 16, 16], wall_banner_blue: [32, 32, 16, 16], wall_banner_green: [16, 48, 16, 16], wall_banner_yellow: [32, 48, 16, 16],
  column_top: [80, 80, 16, 16], column_mid: [80, 96, 16, 16], column_base: [80, 112, 16, 16],
  wall_hole_1: [48, 32, 16, 16], wall_goo: [64, 80, 16, 16], wall_goo_base: [64, 96, 16, 16],
  floor_1: [16, 64, 16, 16], floor_2: [32, 64, 16, 16], floor_3: [48, 64, 16, 16], floor_4: [16, 80, 16, 16],
  floor_5: [32, 80, 16, 16], floor_6: [48, 80, 16, 16], floor_7: [16, 96, 16, 16], floor_8: [32, 96, 16, 16],
  edge: [96, 128, 16, 16],
  chest_full_open: [304, 304, 16, 16, 3], chest_empty_open: [304, 288, 16, 16, 3],
  flask_big_red: [288, 224, 16, 16], flask_big_blue: [304, 224, 16, 16], flask_big_green: [320, 224, 16, 16], flask_big_yellow: [336, 224, 16, 16],
  skull: [288, 320, 16, 16], crate: [288, 298, 16, 22], coin: [288, 272, 8, 8, 4],
  ui_heart_full: [288, 256, 16, 16], ui_heart_half: [304, 256, 16, 16], ui_heart_empty: [320, 256, 16, 16],
  weapon_knight_sword: [339, 114, 10, 29], weapon_katana: [293, 82, 6, 29], weapon_red_magic_staff: [324, 145, 8, 30],
  weapon_green_magic_staff: [340, 145, 8, 30], weapon_regular_sword: [323, 26, 10, 21], weapon_knife: [293, 18, 6, 13],
  weapon_duel_sword: [325, 113, 9, 30], weapon_golden_sword: [291, 153, 10, 22], weapon_lavish_sword: [307, 145, 10, 30],
  weapon_axe: [341, 90, 9, 21], weapon_mace: [339, 55, 10, 24], weapon_spear: [293, 177, 6, 30],
  elf_f_idle: [128, 4, 16, 28, 4], elf_f_run: [192, 4, 16, 28, 4], elf_f_hit: [256, 4, 16, 28, 1],
  elf_m_idle: [128, 36, 16, 28, 4], elf_m_run: [192, 36, 16, 28, 4], elf_m_hit: [256, 36, 16, 28, 1],
  knight_f_idle: [128, 68, 16, 28, 4], knight_f_run: [192, 68, 16, 28, 4], knight_f_hit: [256, 68, 16, 28, 1],
  knight_m_idle: [128, 100, 16, 28, 4], knight_m_run: [192, 100, 16, 28, 4], knight_m_hit: [256, 100, 16, 28, 1],
  wizzard_f_idle: [128, 132, 16, 28, 4], wizzard_f_run: [192, 132, 16, 28, 4], wizzard_f_hit: [256, 132, 16, 28, 1],
  wizzard_m_idle: [128, 164, 16, 28, 4], wizzard_m_run: [192, 164, 16, 28, 4], wizzard_m_hit: [256, 164, 16, 28, 1],
};

export type Sheet = { img: HTMLCanvasElement; white: HTMLCanvasElement; ghost: HTMLCanvasElement; dark: HTMLCanvasElement; gold: HTMLCanvasElement; spirit: HTMLCanvasElement };
export let sheet: Sheet;

function recolor(src: HTMLImageElement, f: (r: number, g: number, b: number, a: number) => [number, number, number, number]) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const x = c.getContext('2d')!; x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i + 3]) continue;
    const [r, g, b, a] = f(d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]);
    d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; d.data[i + 3] = a;
  }
  x.putImageData(d, 0, 0); return c;
}

// Spectral ramp for ghosts: luminance mapped onto deep violet -> cyan -> near white.
const RAMP = [[22, 18, 48], [40, 46, 110], [52, 104, 160], [86, 186, 196], [160, 240, 226], [236, 255, 248]];
const ramp = (l: number): [number, number, number] => {
  const t = Math.min(0.999, Math.max(0, l)) * (RAMP.length - 1), i = Math.floor(t), f = t - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
};

export async function loadSheet(): Promise<Sheet> {
  const img = new Image(); img.src = '/art/dungeon.png';
  await img.decode();
  const base = recolor(img, (r, g, b, a) => [r, g, b, a]);
  sheet = {
    img: base,
    white: recolor(img, (_r, _g, _b, a) => [255, 255, 255, a]),
    ghost: recolor(img, (r, g, b, a) => { const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255; const [R2, G2, B2] = ramp(l * 1.25 + 0.08); return [R2, G2, B2, a]; }),
    dark: recolor(img, (_r, _g, _b, a) => [8, 6, 14, a]),
    gold: recolor(img, (_r, _g, _b, a) => [255, 211, 107, a]),
    spirit: recolor(img, (_r, _g, _b, a) => [143, 246, 230, a]),
  };
  return sheet;
}

export type Layer = 'img' | 'white' | 'ghost' | 'dark' | 'gold' | 'spirit';

/** Draw frame `f` of sprite `name` with its bottom centre at (x, y). */
export function spr(ctx: CanvasRenderingContext2D, name: string, f: number, x: number, y: number, flip = false, layer: Layer = 'img') {
  const r = R[name]; if (!r) return;
  const n = r[4] ?? 1, fi = ((Math.floor(f) % n) + n) % n;
  const sx = r[0] + fi * r[2];
  const dx = Math.round(x - r[2] / 2), dy = Math.round(y - r[3]);
  if (flip) {
    ctx.save(); ctx.translate(dx + r[2], dy); ctx.scale(-1, 1);
    ctx.drawImage(sheet[layer], sx, r[1], r[2], r[3], 0, 0, r[2], r[3]); ctx.restore();
  } else ctx.drawImage(sheet[layer], sx, r[1], r[2], r[3], dx, dy, r[2], r[3]);
}

/** Draw a tile with its top left at (x, y). */
export function tile(ctx: CanvasRenderingContext2D, name: string, f: number, x: number, y: number, layer: Layer = 'img') {
  const r = R[name]; if (!r) return;
  const n = r[4] ?? 1, fi = ((Math.floor(f) % n) + n) % n;
  ctx.drawImage(sheet[layer], r[0] + fi * r[2], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]);
}

/** Draw a sprite rotated about a pivot given in sprite pixels. */
export function sprRot(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, px: number, py: number, angle: number, flip = false, layer: Layer = 'img') {
  const r = R[name]; if (!r) return;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  ctx.rotate(angle);
  ctx.drawImage(sheet[layer], r[0], r[1], r[2], r[3], -px, -py, r[2], r[3]);
  ctx.restore();
}

export const CLASS_SPRITE = (cls: number, fem: boolean) => `${['knight', 'elf', 'wizzard'][cls]}_${fem ? 'f' : 'm'}`;
export const CLASS_WEAPON = (cls: number, fem: boolean) => cls === 0 ? (fem ? 'weapon_red_gem_sword' : 'weapon_regular_sword') : cls === 1 ? (fem ? 'weapon_machete' : 'weapon_knife') : (fem ? 'weapon_green_magic_staff' : 'weapon_red_magic_staff');
export const GEAR_NAMES = [['Iron Blade', 'Gem Blade', 'Gold Blade'], ['Old Mace', 'War Axe', 'Long Spear'], ['Red Flask', 'Blue Flask', 'Gold Flask']];
export const GEAR_SPRITE = (kind: number, tier: number) => kind === 0 ? ['weapon_regular_sword', 'weapon_red_gem_sword', 'weapon_golden_sword'][Math.min(2, tier - 1)] ?? 'weapon_golden_sword'
  : kind === 1 ? ['weapon_mace', 'weapon_axe', 'weapon_spear'][Math.min(2, tier - 1)] : ['flask_big_red', 'flask_big_blue', 'flask_big_yellow'][Math.min(2, tier - 1)];
R.weapon_red_gem_sword = [339, 26, 10, 21];
R.weapon_machete = [294, 121, 5, 22];
R.weapon_cleaver = [310, 124, 8, 19];
