// The practice hall's wardens: a varied set like the real chipnet hall (mixed classes, levels 1 to 8). Their records
// start at zero and only your own practice challenges move them; they are kept by the Hall, not by invented players.
// Lives beside PracticeChain (chain/practice.ts) rather than in it; an older practice save keeps its heroes and gear
// and simply meets the current hall.
import { PracticeChain } from '../chain/practice';
import type { ClassId } from '../chain/types';

const ROSTER = 2;
const WARDENS: [string, ClassId, number][] = [
  ['Bram', 0, 1], ['Vesk', 1, 1], ['Ilsa', 2, 2], ['Tamsin', 1, 2], ['Corwin', 0, 3], ['Nyx', 1, 3], ['Orrin', 2, 4], ['Maud', 0, 4],
  ['Hale', 0, 5], ['Pell', 2, 5], ['Sable', 1, 6], ['Ysolde', 2, 6], ['Thorn', 0, 7], ['Rook', 1, 7], ['Wren', 2, 8], ['Garrick', 0, 8],
];
export const PRACTICE_KEEPER = 'the Hall';
const wardens = () => WARDENS.map(([name, cls, level], i) => ({ id: 100 + i * 7, cls, level, name, owner: PRACTICE_KEEPER, beaten: 0, defences: 0 }));

type State = { wardens: ReturnType<typeof wardens>; tickets?: string[]; roster?: number };
const state = (c: PracticeChain) => (c as unknown as { s: State }).s;

export class PracticeHall extends PracticeChain {
  constructor() {
    super();
    this.meetHall();
  }
  private meetHall() {
    const s = state(this);
    if (s.roster === ROSTER) return;
    s.wardens = wardens(); s.roster = ROSTER; s.tickets = [];
    (this as unknown as { save(): void }).save();
  }
  override reset() { super.reset(); this.meetHall(); }
}
