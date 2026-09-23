import { STEP, type Direction } from './floorGenerator';

export interface Vec {
  x: number;
  y: number;
}

export type Passive = 'homing' | 'fireRate' | 'sword';

export interface Weapon {
  mode: 'shots' | 'sword';
  fireDelayMs: number;
  damage: number;
  homing: boolean;
}

/** Weapon numbers; placeholders for playtest tuning. */
export const WEAPON = {
  shotDelayMs: 330,
  shotDamage: 1,
  swordDelayMs: 450,
  swordDamage: 3,
  /** Fire-rate passive: multiplies the delay between attacks and their damage (shots and sword). */
  fireRateDelayFactor: 0.4,
  fireRateDamageFactor: 0.5,
};

export function resolveWeapon(passives: readonly Passive[]): Weapon {
  const sword = passives.includes('sword');
  const fast = passives.includes('fireRate');
  return {
    mode: sword ? 'sword' : 'shots',
    fireDelayMs: (sword ? WEAPON.swordDelayMs : WEAPON.shotDelayMs) * (fast ? WEAPON.fireRateDelayFactor : 1),
    damage: (sword ? WEAPON.swordDamage : WEAPON.shotDamage) * (fast ? WEAPON.fireRateDamageFactor : 1),
    // Homing steers projectiles; the sword has none.
    homing: !sword && passives.includes('homing'),
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
