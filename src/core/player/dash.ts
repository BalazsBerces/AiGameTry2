/** The Dash passive: a short burst in the direction the player is moving, invincible while it lasts. */
export interface DashRules {
  distanceTiles: number;
  durationMs: number;
  /** From the start of one dash to the earliest start of the next. */
  cooldownMs: number;
}

export interface Dash {
  /** Unit direction of travel. */
  dir: { x: number; y: number };
  start: number;
  until: number;
  readyAt: number;
  speedTilesPerSec: number;
}

/**
 * The player asks to dash while moving along `moving` (any length): a new dash if one is ready
 * and they are moving, otherwise the dash they already had (or none).
 */
export function tryDash(dash: Dash | undefined, time: number, moving: { x: number; y: number }, rules: DashRules): Dash | undefined {
  const len = Math.hypot(moving.x, moving.y);
  if (len === 0 || (dash && time < dash.readyAt)) return dash;
  return {
    dir: { x: moving.x / len, y: moving.y / len },
    start: time,
    until: time + rules.durationMs,
    readyAt: time + rules.cooldownMs,
    speedTilesPerSec: rules.distanceTiles / (rules.durationMs / 1000),
  };
}

export const isDashing = (dash: Dash | undefined, time: number) => !!dash && time >= dash.start && time < dash.until;
