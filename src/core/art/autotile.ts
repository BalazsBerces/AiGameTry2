import type { Direction } from '../map/floorGenerator';
import type { Tile } from '../rooms/roomGenerator';

/** Which of a tile's four neighbours are the same kind: bit 1 up, 2 right, 4 down, 8 left. */
export type Mask = number;
export const UP = 1;
export const RIGHT = 2;
export const DOWN = 4;
export const LEFT = 8;

const SIDES: readonly [number, number, number][] = [
  [UP, 0, -1],
  [RIGHT, 1, 0],
  [DOWN, 0, 1],
  [LEFT, -1, 0],
];

/** The sides of tile x,y where the same tile carries on; past the room's edge never does. Picks a pond's piece. */
export function neighbourMask(tiles: readonly (readonly Tile[])[], x: number, y: number): Mask {
  const tile = tiles[y]?.[x];
  return SIDES.reduce((mask, [bit, dx, dy]) => (tiles[y + dy]?.[x + dx] === tile ? mask | bit : mask), 0);
}

/** A seam between two touching tiles of one kind: from x,y to the tile right of it (`across`) or below it (`down`). */
export interface Join {
  x: number;
  y: number;
  dir: 'across' | 'down';
  tile: Tile;
}

/** Where a tile meets the room's wall: the tile at x,y has wall on its `side`. */
export interface WallJoin {
  x: number;
  y: number;
  side: Direction;
  tile: Tile;
}

const WALL_SIDES: readonly [Direction, number, number][] = [
  ['up', 0, -1],
  ['right', 1, 0],
  ['down', 0, 1],
  ['left', -1, 0],
];

/**
 * Every side where a `joinable` tile touches the room's wall (loose rock growing out of the cave
 * wall): a wall tile in the room (an L room's missing corner), or past the room's edge, except where
 * a door opens through it.
 */
export function wallJoins(tiles: readonly (readonly Tile[])[], joinable: readonly Tile[], doors: readonly { side: Direction; cell: { x: number; y: number } }[] = []): WallJoin[] {
  const joins: WallJoin[] = [];
  tiles.forEach((row, y) =>
    row.forEach((tile, x) => {
      if (!joinable.includes(tile)) return;
      for (const [side, dx, dy] of WALL_SIDES) {
        const beyond = tiles[y + dy]?.[x + dx];
        const door = doors.some((d) => d.side === side && d.cell.x === x && d.cell.y === y);
        if (beyond === 'wall' || (beyond === undefined && !door)) joins.push({ x, y, side, tile });
      }
    }),
  );
  return joins;
}

/** Every seam where two touching tiles of a `joinable` kind grow into each other (tree canopies, thorn vines), once each. */
export function joinsBetween(tiles: readonly (readonly Tile[])[], joinable: readonly Tile[]): Join[] {
  const joins: Join[] = [];
  tiles.forEach((row, y) =>
    row.forEach((tile, x) => {
      if (!joinable.includes(tile)) return;
      if (row[x + 1] === tile) joins.push({ x, y, dir: 'across', tile });
      if (tiles[y + 1]?.[x] === tile) joins.push({ x, y, dir: 'down', tile });
    }),
  );
  return joins;
}
