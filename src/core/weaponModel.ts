import { STEP, type Direction } from './floorGenerator';

export interface Vec {
  x: number;
  y: number;
}

export type Passive = 'homing' | 'fireRate' | 'sword';

/** A passive is picked up at level 1; a boss kill can raise one to level 2. */
export type PassiveLevel = 1 | 2;
/** The passives the player owns, each with its level. */
export type PassiveLevels = Partial<Record<Passive, PassiveLevel>>;

export interface Weapon {
  mode: 'shots' | 'sword';
  fireDelayMs: number;
  damage: number;
  homing: boolean;
  /** How fast homing shots turn, in radians per second. */
  homingTurnRate: number;
  /** How wide a sword swing sweeps. */
  swordArcDeg: number;
}

/** Weapon numbers; placeholders for playtest tuning. Level-2 values are indexed by level. */
export const WEAPON = {
  shotDelayMs: 330,
  shotDamage: 1,
  swordDelayMs: 450,
  swordDamage: 3,
  swordArcDeg: { 1: 90, 2: 140 },
  homingTurnRate: { 1: 5, 2: 8.5 },
  /** Fire-rate passive: multiplies the delay between attacks and their damage (shots and sword). */
  fireRateDelayFactor: 0.4,
  fireRateDamageFactor: { 1: 0.5, 2: 0.75 },
};

/** Everything the player's passives, at their levels, make of their attack. Pickup order never matters. */
export function resolveWeapon(passives: PassiveLevels): Weapon {
  const sword = passives.sword;
  const fast = passives.fireRate;
  return {
    mode: sword ? 'sword' : 'shots',
    fireDelayMs: (sword ? WEAPON.swordDelayMs : WEAPON.shotDelayMs) * (fast ? WEAPON.fireRateDelayFactor : 1),
    damage: (sword ? WEAPON.swordDamage : WEAPON.shotDamage) * (fast ? WEAPON.fireRateDamageFactor[fast] : 1),
    // Homing steers projectiles; the sword has none.
    homing: !sword && !!passives.homing,
    homingTurnRate: WEAPON.homingTurnRate[passives.homing ?? 1],
    swordArcDeg: WEAPON.swordArcDeg[sword ?? 1],
  };
}

/** How much the player's movement may influence a shot. */
export const SHOT_SKEW = {
  /** Fraction of player velocity added to the shot. */
  influence: 0.3,
  minSpeedFactor: 0.8,
  maxSpeedFactor: 1.25,
  maxAngleDeg: 15,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function launchVelocity(aim: Direction, playerVelocity: Vec, shotSpeed: number): Vec {
  const dir = STEP[aim];
  const perpDir = { x: -dir.y, y: dir.x };
  const playerAlong = playerVelocity.x * dir.x + playerVelocity.y * dir.y;
  const playerPerp = playerVelocity.x * perpDir.x + playerVelocity.y * perpDir.y;

  const along = clamp(
    shotSpeed + SHOT_SKEW.influence * playerAlong,
    shotSpeed * SHOT_SKEW.minSpeedFactor,
    shotSpeed * SHOT_SKEW.maxSpeedFactor,
  );
  // Cap the sideways part by angle first, then shrink both if the total speed overshoots.
  const maxPerp = along * Math.tan((SHOT_SKEW.maxAngleDeg * Math.PI) / 180);
  const perp = clamp(SHOT_SKEW.influence * playerPerp, -maxPerp, maxPerp);
  const scale = Math.min(1, (shotSpeed * SHOT_SKEW.maxSpeedFactor) / Math.hypot(along, perp));

  // `+ 0` normalises -0 so a still player yields a clean cardinal vector.
  return {
    x: (along * dir.x + perp * perpDir.x) * scale + 0,
    y: (along * dir.y + perp * perpDir.y) * scale + 0,
  };
}
