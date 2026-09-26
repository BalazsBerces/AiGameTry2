/**
 * The skeleton knight's shield: it covers an arc in front of the knight, and the knight turns
 * toward the player at a limited rate, so a player who circles it can hit its flanks or back.
 * Angles are radians in screen space (0 = right, +y down).
 */
export interface ShieldRules {
  /** Full width of the shielded front arc, in degrees. */
  arcDeg: number;
  /** How fast the knight can turn to face the player. */
  turnDegPerSec: number;
}

/** Placeholders for playtest tuning. */
export const SHIELD: ShieldRules = { arcDeg: 120, turnDegPerSec: 110 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Whether a hit travelling along `heading` (a shot's velocity, or from a swordsman toward the
 * knight) meets the shield of a knight facing `facing`: it does when the hit comes from inside
 * the front arc.
 */
export function shieldBlocks(facing: number, heading: { x: number; y: number }, rules: ShieldRules = SHIELD): boolean {
  if (heading.x === 0 && heading.y === 0) return false;
  // Where the hit comes from, as seen from the knight.
  const from = Math.atan2(-heading.y, -heading.x);
  return Math.abs(wrap(from - facing)) <= rad(rules.arcDeg) / 2 + 1e-9;
}

/**
 * The knight's facing after `dtMs`, turned the short way toward the player (`toPlayer`, a
 * vector from the knight) by at most its turn rate. Returned wrapped to (-PI, PI].
 */
export function turnKnight(facing: number, toPlayer: { x: number; y: number }, dtMs: number, rules: ShieldRules = SHIELD): number {
  if (toPlayer.x === 0 && toPlayer.y === 0) return facing;
  const diff = wrap(Math.atan2(toPlayer.y, toPlayer.x) - facing);
  const maxTurn = (rad(rules.turnDegPerSec) * dtMs) / 1000;
  return wrap(facing + Math.max(-maxTurn, Math.min(maxTurn, diff)));
}
