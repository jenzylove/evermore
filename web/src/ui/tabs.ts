import { go, type Route } from '../app';
import { h } from './kit';

export const tabs = (on: Route) => h('nav', { class: 'tabs' },
  ...([['arena', 'Arena'], ['hero', 'Hero'], ['bazaar', 'Bazaar']] as const).map(([r, n]) =>
    h('button', { class: r === on ? 'on' : '', onClick: () => { if (r !== on) go(r); } }, n)));
