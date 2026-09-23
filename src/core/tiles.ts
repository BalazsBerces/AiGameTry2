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
