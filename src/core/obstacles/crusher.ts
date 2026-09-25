import { STEP, type Cell, type Direction } from '../map/floorGenerator';
import { inBounds, lineOfSight, type Grid } from '../map/grid';
import type { Tile } from '../rooms/roomGenerator';
import { blocksSight, isWalkable } from '../map/tiles';

/** A horizontal crusher slides left and right, a vertical one up and down. */
export type CrusherAxis = 'horizontal' | 'vertical';

/** A crusher block and the line it slides along. */
export interface Crusher {
  cell: Cell;
  axis: CrusherAxis;
}

export interface CrusherSlide {
  /** Every cell the block passes into, in order; everything standing on one is crushed. */
  swept: Cell[];
  /** Where it settles: the last swept cell, or its own cell if it could not move. */
  stop: Cell;
}

export const AXIS_DIRECTIONS: Record<CrusherAxis, readonly [Direction, Direction]> = {
  horizontal: ['left', 'right'],
  vertical: ['up', 'down'],
};

/** Slides from `from` toward `dir` until the next tile is not open floor or lies outside the room. */
export function slideCrusher(tiles: Grid<Tile>, from: Cell, dir: Direction): CrusherSlide {
  const step = STEP[dir];
  const swept: Cell[] = [];
  let at = from;
  for (;;) {
    const next = { x: at.x + step.x, y: at.y + step.y };
    if (!inBounds(tiles, next) || !isWalkable(tiles[next.y][next.x])) break;
    swept.push(next);
    at = next;
  }
  return { swept, stop: at };
}

/**
 * The direction a crusher wakes in: toward the player, when they stand in its row (horizontal)
 * or column (vertical) with nothing blocking sight between them; otherwise undefined.
 */
export function crusherWakes(tiles: Grid<Tile>, { cell, axis }: Crusher, player: Cell): Direction | undefined {
  const inLine = axis === 'horizontal' ? player.y === cell.y && player.x !== cell.x : player.x === cell.x && player.y !== cell.y;
  if (!inLine) return undefined;
  const centre = (c: Cell) => ({ x: c.x + 0.5, y: c.y + 0.5 });
  if (!lineOfSight(tiles, centre(cell), centre(player), blocksSight)) return undefined;
  const [back, forward] = AXIS_DIRECTIONS[axis];
  return (axis === 'horizontal' ? player.x > cell.x : player.y > cell.y) ? forward : back;
}

/** Moves a crusher on the room's tiles: its cell becomes floor and it settles, still a crusher, at `stop`. */
export function settleCrusher(tiles: Tile[][], crusher: Crusher, stop: Cell) {
  tiles[crusher.cell.y][crusher.cell.x] = 'floor';
  tiles[stop.y][stop.x] = 'crusher';
  crusher.cell = stop;
}
