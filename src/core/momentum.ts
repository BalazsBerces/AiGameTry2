/** Player movement momentum: a responsive start speed that builds toward a faster top speed. */
export interface MomentumRules {
  startSpeed: number;
  topSpeed: number;
  /** Continuous movement it takes to ramp from start to top speed. */
  rampMs: number;
}

export interface Momentum {
  /** Speed to move at right now, in px/s. */
  speed: number;
  /** When this frame was stepped. */
  time: number;
}

export interface MomentumInput {
  /** Held direction; zero when no keys are down. */
  dir: { x: number; y: number };
  time: number;
}

/** Advances momentum by one frame. */
export function stepMomentum(m: Momentum | undefined, input: MomentumInput, rules: MomentumRules): Momentum {
  const { dir, time } = input;
  if (dir.x === 0 && dir.y === 0) return { speed: 0, time };
  if (!m || m.speed === 0) return { speed: rules.startSpeed, time };
  const perMs = (rules.topSpeed - rules.startSpeed) / rules.rampMs;
  return { speed: Math.min(rules.topSpeed, m.speed + perMs * (time - m.time)), time };
}
