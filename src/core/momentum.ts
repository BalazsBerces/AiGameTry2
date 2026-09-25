/** Player movement momentum: a responsive start speed that builds toward a faster top speed. */
export interface MomentumRules {
  startSpeed: number;
  topSpeed: number;
  /** Continuous movement it takes to ramp from start to top speed. */
  rampMs: number;
  /** How long the built-up speed survives with no keys held (the ball itself stops at once). */
  releaseMemoryMs: number;
}

export interface Momentum {
  /** Speed to move at right now, in px/s. */
  speed: number;
  /** Speed built up so far; kept through a short release. */
  built: number;
  /** When this frame was stepped. */
  time: number;
  /** The direction last moved in. */
  dir: { x: number; y: number };
  /** When the keys were let go, while none are held. */
  releasedAt?: number;
}

export interface MomentumInput {
  /** Held direction; zero when no keys are down. */
  dir: { x: number; y: number };
  time: number;
  /** A stun holds the player and throws away the built-up speed. */
  stunned?: boolean;
  /** A dash leaves the player at top speed. */
  dashing?: boolean;
}

/** Advances momentum by one frame. */
export function stepMomentum(m: Momentum | undefined, input: MomentumInput, rules: MomentumRules): Momentum {
  const { dir, time } = input;
  const moving = dir.x !== 0 || dir.y !== 0;
  if (input.stunned) return { speed: 0, built: 0, time, dir: m?.dir ?? dir };
  if (input.dashing) return { speed: rules.topSpeed, built: rules.topSpeed, time, dir: moving ? dir : (m?.dir ?? dir) };
  if (!moving) {
    return { speed: 0, built: m?.built ?? 0, time, dir: m?.dir ?? dir, releasedAt: m?.releasedAt ?? time };
  }
  const forgotten = !m || m.built === 0 || (m.releasedAt !== undefined && time - m.releasedAt > rules.releaseMemoryMs);
  // Turns up to 90° keep the speed; anything sharper is a reversal and starts over.
  const reversed = m && dir.x * m.dir.x + dir.y * m.dir.y < 0;
  const perMs = (rules.topSpeed - rules.startSpeed) / rules.rampMs;
  const built = forgotten || reversed ? rules.startSpeed : Math.min(rules.topSpeed, m.built + perMs * (time - m.time));
  return { speed: built, built, time, dir };
}
