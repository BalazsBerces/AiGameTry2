import type { Tile } from '../rooms/roomGenerator';
import { attackBreaks, blocksShots, reflectsShots } from '../map/tiles';

/**
 * What a player projectile does as it flies, given the passives it carries (see `resolveWeapon`):
 * the scene asks here whenever one meets terrain or an enemy, and does what it is told.
 */
export interface ShotMods {
  piercesEnemies: boolean;
  piercesTerrain: boolean;
  spectral: boolean;
  passesShields: boolean;
  /** Bounces off walls and stone it still has. */
  bouncesLeft: number;
}

/** What a shot can run into: the room's outer wall (or a door lock), or a terrain tile. */
export type Meets = 'wall' | Tile;

/**
 * `pass`: flies on through; `bounce`: bounces, spending one of its bounces; `reflect`: bounces
 * for free (crystal turns every shot); `stop`: spent there.
 */
export type TerrainOutcome = 'pass' | 'bounce' | 'reflect' | 'stop';

/** What a shot does at a piece of terrain, and whether that tile takes a hit from it. */
export interface TerrainMeeting {
  outcome: TerrainOutcome;
  hitsTile: boolean;
}

/**
 * Spectral and terrain-piercing shots pass through every tile but never the room's walls;
 * crystal turns every other shot for free; otherwise a shot bounces while it has bounces, or stops.
 * Whichever it does, a breakable tile it meets (rock, glowshroom) takes a hit, so no passive
 * takes away breaking terrain.
 */
export function meetTerrain(shot: ShotMods, what: Meets): TerrainMeeting {
  const hitsTile = what !== 'wall' && blocksShots(what) && attackBreaks(what);
  return { outcome: terrainOutcome(shot, what), hitsTile };
}

function terrainOutcome(shot: ShotMods, what: Meets): TerrainOutcome {
  if (what !== 'wall' && !blocksShots(what)) return 'pass';
  if (what !== 'wall' && (shot.spectral || shot.piercesTerrain)) return 'pass';
  if (what !== 'wall' && reflectsShots(what)) return 'reflect';
  return shot.bouncesLeft > 0 ? 'bounce' : 'stop';
}

/**
 * The tiles a shot passing through terrain has already hit, so it hits each only once however
 * many frames it spends inside. Keyed by whatever names a tile uniquely (room and cell).
 */
export function createTileLog() {
  const seen = new Set<string>();
  return {
    /** True the first time the shot touches `tile`. */
    first(tile: string): boolean {
      if (seen.has(tile)) return false;
      seen.add(tile);
      return true;
    },
  };
}

export type TileLog = ReturnType<typeof createTileLog>;

/** A shot meets an enemy part, `shielded` if its shield faces the shot: does it hurt it, and fly on? */
export function meetEnemy(shot: ShotMods, shielded: boolean): { damages: boolean; continues: boolean } {
  if (shielded && !shot.passesShields) return { damages: false, continues: false };
  return { damages: true, continues: shot.piercesEnemies && !shielded };
}

export type Leg = 'out' | 'back';

/** Which enemies a shot has already hurt on each leg of its flight, so a piercing shot hurts each only once per leg. */
export function createHitLog() {
  const seen: Record<Leg, Set<unknown>> = { out: new Set(), back: new Set() };
  return {
    /** True the first time `target` is hit on this leg. */
    first(leg: Leg, target: unknown): boolean {
      if (seen[leg].has(target)) return false;
      seen[leg].add(target);
      return true;
    },
  };
}

export type HitLog = ReturnType<typeof createHitLog>;

/** A boomerang shot flies out for `outMs`, then comes back. */
export const boomerangLeg = (ageMs: number, outMs: number): Leg => (ageMs < outMs ? 'out' : 'back');

/** The tiles that block a homing shot's view of an enemy: only what the shot couldn't fly through. */
export const homingBlocks = (shot: ShotMods) => (tile: Tile) =>
  tile === 'wall' || (!shot.spectral && !shot.piercesTerrain && blocksShots(tile));
