/** Ghoul timing and reach; all numbers are placeholders for playtest tuning. */
export const GHOUL = {
  /** Tiles: within this distance of a player it can see, the ghoul lunges. */
  lungeRange: 2.5,
  lungeMs: 350,
  /** Pause after a lunge before it can lunge again. */
  recoverMs: 900,
};

/** Stalking slowly, mid-lunge along a fixed unit direction, or catching its breath. */
export type GhoulState =
  | { mode: 'stalk' }
  | { mode: 'lunge'; direction: { x: number; y: number }; until: number }
  | { mode: 'recover'; until: number };

export interface GhoulSenses {
  time: number;
  /** Vector from the ghoul to the player, in tiles. */
  toPlayer: { x: number; y: number };
  canSeePlayer: boolean;
}

export const createGhoul = (): GhoulState => ({ mode: 'stalk' });

/** Advances the ghoul: it stalks until a visible player is within range, lunges at them, then recovers. */
export function stepGhoul(state: GhoulState, { time, toPlayer, canSeePlayer }: GhoulSenses): GhoulState {
  if (state.mode === 'lunge') return time < state.until ? state : { mode: 'recover', until: time + GHOUL.recoverMs };
  if (state.mode === 'recover' && time < state.until) return state;
  const distance = Math.hypot(toPlayer.x, toPlayer.y);
  if (!canSeePlayer || distance > GHOUL.lungeRange || distance === 0) return { mode: 'stalk' };
  return { mode: 'lunge', direction: { x: toPlayer.x / distance, y: toPlayer.y / distance }, until: time + GHOUL.lungeMs };
}
