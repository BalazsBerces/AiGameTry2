import type { EnemyType } from './roomGenerator';

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
  shadowBoss: 'walker',
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
};
