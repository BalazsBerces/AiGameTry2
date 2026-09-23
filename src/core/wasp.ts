import type { Rng } from './rng';

/**
 * Wasp flight, placeholders for playtest tuning. The wasp aims at its target off by a wobble
 * angle that jitters every frame (by up to `jitter` radians per second) and now and then darts
 * to a fresh random angle (on average every `dartMs`). The wobble never passes `maxWobble`,
 * under a right angle, so the wasp always closes in, however wildly it zigzags.
 */
export const WASP_FLIGHT = { maxWobble: 1.2, jitter: 4, dartMs: 260 };

export interface WaspFlight {
  /** Current angle, in radians, between the wasp's heading and the straight line to its target. */
  wobble: number;
}

const randomWobble = (rng: Rng) => (rng.next() * 2 - 1) * WASP_FLIGHT.maxWobble;

export const createWaspFlight = (rng: Rng): WaspFlight => ({ wobble: randomWobble(rng) });

/** One frame of flight: the new wobble and the unit heading to fly along. Pure given the rng. */
export function steerWasp(
  flight: WaspFlight,
  from: { x: number; y: number },
  to: { x: number; y: number },
  dtMs: number,
  rng: Rng,
): { flight: WaspFlight; heading: { x: number; y: number } } {
  const { maxWobble, jitter, dartMs } = WASP_FLIGHT;
  const darts = rng.next() < dtMs / dartMs;
  const drift = (rng.next() * 2 - 1) * jitter * (dtMs / 1000);
  const wobble = darts ? randomWobble(rng) : Math.min(maxWobble, Math.max(-maxWobble, flight.wobble + drift));
  const angle = Math.atan2(to.y - from.y, to.x - from.x) + wobble;
  return { flight: { wobble }, heading: { x: Math.cos(angle), y: Math.sin(angle) } };
}
