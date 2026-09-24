import type { Tile } from './roomGenerator';

/** Everything generation, validation, pathing, sight and physics need to know about a tile. */
export interface TileProps {
  walkable: boolean;
  blocksShots: boolean;
  blocksSight: boolean;
  /** Flying enemies cross it. */
  flyersPass: boolean;
  /** Phasing enemies (ghosts) drift through it. */
  phasingPasses: boolean;
  hurtsOnTouch: boolean;
  reflectsShots: boolean;
  /** Player shots it takes to break into floor; unbreakable if left out. */
  hitsToBreak?: number;
  bombDestructible: boolean;
}

/** The single source of tile behaviour. How a tile looks is up to the floor's theme. */
export const TILES: Record<Tile, TileProps> = {
  floor: {
    walkable: true,
    blocksShots: false,
    blocksSight: false,
    flyersPass: true,
    phasingPasses: true,
    hurtsOnTouch: false,
    reflectsShots: false,
    bombDestructible: false,
  },
  /** Stone. */
  obstacle: {
    walkable: false,
    blocksShots: true,
    blocksSight: true,
    flyersPass: false,
    phasingPasses: true,
    hurtsOnTouch: false,
    reflectsShots: false,
    bombDestructible: true,
  },
  rock: {
    walkable: false,
    blocksShots: true,
    blocksSight: true,
    flyersPass: false,
    phasingPasses: true,
    hurtsOnTouch: false,
    reflectsShots: false,
    hitsToBreak: 3,
    bombDestructible: true,
  },
  /** A pond, chasm or pit depending on the floor: blocks walking, not shots or flyers. */
  hole: {
    walkable: false,
    blocksShots: false,
    blocksSight: false,
    flyersPass: true,
    phasingPasses: true,
    hurtsOnTouch: false,
    reflectsShots: false,
    bombDestructible: false,
  },
  /**
   * Thorn bush: solid to feet, and hurts the player or a walker that pushes into it. It is
   * low, so shots, sight and flyers pass over it, making it a lure rather than cover.
   */
  thorn: {
    walkable: false,
    blocksShots: false,
    blocksSight: false,
    flyersPass: true,
    phasingPasses: true,
    hurtsOnTouch: true,
    reflectsShots: false,
    bombDestructible: false,
  },
  /** A heavy block that slides along its axis at the player and settles as stone (see `crusher`). */
  crusher: {
    walkable: false,
    blocksShots: true,
    blocksSight: true,
    flyersPass: false,
    phasingPasses: true,
    hurtsOnTouch: false,
    reflectsShots: false,
    bombDestructible: false,
  },
  /** A cave crystal: a solid block that bounces every shot, the player's too (see `ricochet`). */
  crystal: {
    walkable: false,
    blocksShots: true,
    blocksSight: true,
    flyersPass: false,
    phasingPasses: true,
    hurtsOnTouch: false,
    reflectsShots: true,
    bombDestructible: false,
  },
  /** Outside the room: the missing cell of an L, drawn and solid as room wall. */
  wall: {
    walkable: false,
    blocksShots: true,
    blocksSight: true,
    flyersPass: false,
    phasingPasses: false,
    hurtsOnTouch: false,
    reflectsShots: false,
    bombDestructible: false,
  },
  /**
   * A cave glowshroom: a waist-high cap that stops feet, flyers and shots (a shot is how it gets
   * burst, see `burstGlowshroom`) but not sight. A player shot bursts it at once into a stun cloud,
   * and it is floor from then on; it never cracks, and bombs leave it be.
   */
  glowshroom: {
    walkable: false,
    blocksShots: true,
    blocksSight: false,
    flyersPass: false,
    phasingPasses: true,
    hurtsOnTouch: false,
    reflectsShots: false,
    bombDestructible: false,
  },
};

export const isWalkable = (tile: Tile) => TILES[tile].walkable;
export const blocksShots = (tile: Tile) => TILES[tile].blocksShots;
export const blocksSight = (tile: Tile) => TILES[tile].blocksSight;
export const flyersPass = (tile: Tile) => TILES[tile].flyersPass;
export const phasingPasses = (tile: Tile) => TILES[tile].phasingPasses;
export const hurtsOnTouch = (tile: Tile) => TILES[tile].hurtsOnTouch;
export const reflectsShots = (tile: Tile) => TILES[tile].reflectsShots;
export const hitsToBreak = (tile: Tile) => TILES[tile].hitsToBreak;
export const bombDestructible = (tile: Tile) => TILES[tile].bombDestructible;
