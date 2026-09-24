import { STEP, type Direction } from './floorGenerator';
import type { PoisonRules } from './onHit';
import type { DashRules } from './dash';

export interface Vec {
  x: number;
  y: number;
}

export type Passive =
  | 'homing'
  | 'fireRate'
  | 'sword'
  | 'triple'
  | 'pierce'
  | 'ricochet'
  | 'spectral'
  | 'boomerang'
  | 'poison'
  | 'chain'
  | 'freeze'
  | 'orbital'
  | 'dash';

/** Passives that shape a projectile's flight: with the sword, any of them makes it throw a blade wave. */
const SHOT_MODIFIERS: readonly Passive[] = ['homing', 'triple', 'pierce', 'ricochet', 'spectral', 'boomerang'];

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
  /** Projectiles per attack, fanned `spreadDeg` apart. */
  shots: number;
  spreadDeg: number;
  /** Carries on through enemies it hurts (each one once per leg of its flight). */
  piercesEnemies: boolean;
  /** Carries on through stone and rock. */
  piercesTerrain: boolean;
  /** How often it may bounce off walls and stone. */
  bounces: number;
  /** Flies through stone and rock (not the room's walls). */
  spectral: boolean;
  /** Gets past shields. */
  passesShields: boolean;
  /** Flies out for `outMs`, then back to the player. */
  boomerang?: { outMs: number; returnSpeedFactor: number; returnDamageFactor: number };
  /** Sword swings also throw a short-lived projectile that carries the shot passives. */
  bladeWave: boolean;
  /** On-hit effects, for shots and sword swings alike (core/onHit). */
  poison?: PoisonRules;
  /** Lightning jumps `jumps` times, each within `range` tiles, at `damageFactor` of the hit. */
  chain?: { jumps: number; range: number; damageFactor: number };
  /** Each hit stuns its target for `stunMs` with this chance. */
  freeze?: { chance: number; stunMs: number };
  /** Orbs circling the player, blocking enemy shots and hurting what they touch. */
  orbitals: number;
  /** The dash (core/dash); `damage` to each enemy it passes through, if any. */
  dash?: DashRules & { damage: number };
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
  triple: { shots: { 1: 3, 2: 5 }, spreadDeg: 14, damageFactor: 0.75 },
  ricochetBounces: { 1: 2, 2: 4 },
  boomerang: { outMs: 420, returnSpeedFactor: { 1: 1, 2: 1.5 }, returnDamageFactor: { 1: 1, 2: 2 } },
  poison: {
    1: { damagePerTick: 0.3, tickMs: 500, durationMs: 3000, maxStacks: 3 },
    2: { damagePerTick: 0.3, tickMs: 500, durationMs: 5000, maxStacks: 6 },
  } as Record<PassiveLevel, PoisonRules>,
  chain: { jumps: { 1: 1, 2: 3 }, range: 3.5, damageFactor: 0.5 },
  freeze: { chance: { 1: 0.15, 2: 0.3 }, stunMs: 1200 },
  orbitals: { 1: 1, 2: 2 },
  dash: { distanceTiles: 2.6, durationMs: 150, cooldownMs: { 1: 900, 2: 550 }, damage: { 1: 0, 2: 2 } },
};

/** Everything the player's passives, at their levels, make of their attack. Pickup order never matters. */
export function resolveWeapon(passives: PassiveLevels): Weapon {
  const { sword, fireRate: fast, triple, pierce, ricochet, spectral, boomerang } = passives;
  const bladeWave = !!sword && SHOT_MODIFIERS.some((p) => passives[p]);
  return {
    mode: sword ? 'sword' : 'shots',
    fireDelayMs: (sword ? WEAPON.swordDelayMs : WEAPON.shotDelayMs) * (fast ? WEAPON.fireRateDelayFactor : 1),
    damage:
      (sword ? WEAPON.swordDamage : WEAPON.shotDamage) *
      (fast ? WEAPON.fireRateDamageFactor[fast] : 1) *
      (triple && !sword ? WEAPON.triple.damageFactor : 1),
    // Homing steers projectiles: shots, or the sword's blade waves.
    homing: !!passives.homing,
    homingTurnRate: WEAPON.homingTurnRate[passives.homing ?? 1],
    swordArcDeg: WEAPON.swordArcDeg[sword ?? 1],
    shots: triple ? WEAPON.triple.shots[triple] : 1,
    spreadDeg: WEAPON.triple.spreadDeg,
    piercesEnemies: !!pierce,
    piercesTerrain: pierce === 2,
    bounces: ricochet ? WEAPON.ricochetBounces[ricochet] : 0,
    spectral: !!spectral,
    passesShields: spectral === 2,
    boomerang: boomerang
      ? {
          outMs: WEAPON.boomerang.outMs,
          returnSpeedFactor: WEAPON.boomerang.returnSpeedFactor[boomerang],
          returnDamageFactor: WEAPON.boomerang.returnDamageFactor[boomerang],
        }
      : undefined,
    bladeWave,
    poison: passives.poison ? WEAPON.poison[passives.poison] : undefined,
    chain: passives.chain ? { jumps: WEAPON.chain.jumps[passives.chain], range: WEAPON.chain.range, damageFactor: WEAPON.chain.damageFactor } : undefined,
    freeze: passives.freeze ? { chance: WEAPON.freeze.chance[passives.freeze], stunMs: WEAPON.freeze.stunMs } : undefined,
    orbitals: passives.orbital ? WEAPON.orbitals[passives.orbital] : 0,
    dash: passives.dash
      ? {
          distanceTiles: WEAPON.dash.distanceTiles,
          durationMs: WEAPON.dash.durationMs,
          cooldownMs: WEAPON.dash.cooldownMs[passives.dash],
          damage: WEAPON.dash.damage[passives.dash],
        }
      : undefined,
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
