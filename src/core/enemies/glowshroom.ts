import type { Cell } from '../map/floorGenerator';
import { stun, type Stunnable } from './stun';

/** How far (in tiles, centre to centre) a glowshroom's stun cloud reaches. Placeholder. */
export const GLOWSHROOM_RADIUS = 2;
/** How long the cloud stuns whoever it catches. Placeholder. */
export const GLOWSHROOM_STUN_MS = 1500;

/** Something the cloud may catch, and where it stands in fractional tile units (2.5 = centre of tile 2). */
export interface BurstTarget<T extends Stunnable> {
  target: T;
  at: { x: number; y: number };
}

/**
 * The glowshroom on `cell` burst at `time`: every target within `GLOWSHROOM_RADIUS` of its
 * centre, enemy or player alike, is stunned for `GLOWSHROOM_STUN_MS`. Returns those caught.
 */
export function stunBurst<T extends Stunnable>(cell: Cell, targets: readonly BurstTarget<T>[], time: number): T[] {
  const centre = { x: cell.x + 0.5, y: cell.y + 0.5 };
  const caught = targets.filter(({ at }) => Math.hypot(at.x - centre.x, at.y - centre.y) <= GLOWSHROOM_RADIUS);
  for (const { target } of caught) stun(target, time, GLOWSHROOM_STUN_MS);
  return caught.map(({ target }) => target);
}
