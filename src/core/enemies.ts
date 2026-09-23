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
  hiveBoss: 'stationary',
  shadowBoss: 'walker',
  gargoyle: 'stationary',
};
