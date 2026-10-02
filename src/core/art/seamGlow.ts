import type { WormBossPiece } from './castPoses';

/**
 * Which worm boss the game shows: the Obsidian Centipede, black glass with blood-red light in its
 * seams; or, beside it to compare, the Molten Centipede, basalt crust fused with obsidian and
 * cracked on lava (molten ember). Both are baked; the game shows one, picked with `?glow=` or the
 * console's `glow`. Once one is chosen, the other goes.
 */
export type SeamGlow = 'blood' | 'ember';

/** Blood red, until the choice is made. */
export const DEFAULT_SEAM_GLOW: SeamGlow = 'blood';

/** Each glow and the other names it goes by, for the console and the URL. */
export const SEAM_GLOWS: readonly { id: SeamGlow; names: string[] }[] = [
  { id: 'blood', names: ['blood red', 'red'] },
  { id: 'ember', names: ['molten ember', 'molten'] },
];

/** What each glow is called. */
export const GLOW_NAMES: Record<SeamGlow, string> = { blood: 'blood red', ember: 'molten ember' };

/** The glow a name stands for, ignoring case: an exact name, or the one a name starts with. */
export function findSeamGlow(query: string): SeamGlow | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const namesOf = (g: (typeof SEAM_GLOWS)[number]) => [g.id, ...g.names];
  const exact = SEAM_GLOWS.find((g) => namesOf(g).includes(q));
  if (exact) return exact.id;
  const starts = SEAM_GLOWS.filter((g) => namesOf(g).some((n) => n.startsWith(q)));
  return starts.length === 1 ? starts[0].id : undefined;
}

/** The glow the URL picks with `?glow=`, if it names one. */
export const glowFromQuery = (query: string): SeamGlow | undefined => findSeamGlow(new URLSearchParams(query).get('glow') ?? '');

/** How many crack patterns the Molten Centipede's body plates come in. */
const MOLTEN_BODIES = 3;

/**
 * The art the worm boss's `index`th segment is drawn from in a glow: blood red is its own; molten
 * ember is baked beside it, its body plates cracked in three patterns in turn down its length.
 */
export const wormBossKind = (piece: WormBossPiece, glow: SeamGlow, index: number): string =>
  glow === 'blood' ? piece : piece === 'wormBossBody' ? `${piece}Ember${index % MOLTEN_BODIES}` : `${piece}Ember`;
