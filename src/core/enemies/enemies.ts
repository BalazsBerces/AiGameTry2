import type { EnemyType } from '../rooms/roomGenerator';

/**
 * How the room validator treats an enemy: walkers must be reachable on foot, stationary
 * enemies and flyers shootable from walkable floor, and phasing enemies are always fine.
 */
export type EnemyClass = 'walker' | 'stationary' | 'flyer' | 'phasing';

export const ENEMY_CLASS: Record<EnemyType, EnemyClass> = {
  zombie: 'walker',
  turret: 'stationary',
  worm: 'walker',
  wormBoss: 'walker',
  ironMaiden: 'walker',
  /** Floats over her open crypt, so she only has to be shootable. */
  candleWitch: 'flyer',
  goblin: 'walker',
  seedSpitter: 'stationary',
  ghoul: 'walker',
  crystalTurret: 'stationary',
  gargoyle: 'stationary',
  /** Rooted in place: it only has to be shootable. */
  treantBoss: 'stationary',
  /** The dungeon's shielded skeleton knight walks up to the player. */
  knight: 'walker',
  /** Flies over ponds and thorns, so it only has to be shootable. */
  wasp: 'flyer',
  boar: 'walker',
  /** Drifts through walls, rocks and pits: it always comes out to be shot. */
  ghost: 'phasing',
  /** Flutters over chasms and swoops at the player, so it only has to be shootable. */
  bat: 'flyer',
  /** Hops across the floor but not over chasms. */
  slime: 'walker',
};

/**
 * How fast each enemy closes on the player, in tiles per second, for judging whether the player
 * can get clear of it (core/kiting): its chase pace, not its bursts. Charges and swoops are
 * telegraphed and dodged rather than outrun, and stationary enemies never close in (0). Kept in
 * step with the game's tuning (px/s over a 48px tile) by a test.
 */
export const ENEMY_CHASE_SPEED: Record<EnemyType, number> = {
  zombie: 85 / 48,
  turret: 0,
  worm: 1000 / 300,
  wormBoss: 1000 / 230,
  ironMaiden: 70 / 48,
  candleWitch: 60 / 48,
  goblin: 130 / 48,
  seedSpitter: 0,
  ghoul: 55 / 48,
  crystalTurret: 0,
  gargoyle: 0,
  treantBoss: 35 / 48,
  knight: 70 / 48,
  wasp: 175 / 48,
  boar: 60 / 48,
  ghost: 60 / 48,
  /** Its flutter drifts toward the player; a swoop is telegraphed. */
  bat: 1.5,
  /** A big slime's hop distance over its whole rest-squash-hop-land cycle. */
  slime: 1,
};
