import type { WormBossPiece } from './castPoses';

/**
 * The light glowing in the worm boss's seams: blood red, or molten ember beside it to compare.
 * Both are baked; the game shows one, picked with `?glow=` or the console's `glow`. Once one is
 * chosen, the other goes.
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

/** The art a piece of the worm boss is drawn from in a glow: blood red is its own, molten ember baked beside it. */
export const wormBossKind = (piece: WormBossPiece, glow: SeamGlow): string => (glow === 'blood' ? piece : `${piece}Ember`);
