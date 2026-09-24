import type { Cell } from './floorGenerator';

export type Grid<T> = readonly (readonly T[])[];

const NEIGHBORS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const inBounds = <T>(grid: Grid<T>, c: Cell) => c.y >= 0 && c.y < grid.length && c.x >= 0 && c.x < grid[0].length;

/**
 * BFS step distance from every passable cell to `target` (Infinity where unreachable).
 * Walkers descend it to path around blocked cells. `target` itself is always treated as passable.
 */
export function distanceField<T>(
  grid: Grid<T>,
  target: Cell,
  passable: (tile: T) => boolean,
  /** Cells to route around whatever their tile, such as ones held by rooted enemies. */
  blocked: (cell: Cell) => boolean = () => false,
): number[][] {
  const dist = grid.map((row) => row.map(() => Infinity));
  if (!inBounds(grid, target)) return dist;
  dist[target.y][target.x] = 0;
  const queue: Cell[] = [target];
  while (queue.length) {
    const c = queue.shift()!;
    for (const n of NEIGHBORS) {
      const next = { x: c.x + n.x, y: c.y + n.y };
      if (!inBounds(grid, next) || !passable(grid[next.y][next.x]) || blocked(next) || dist[next.y][next.x] !== Infinity) continue;
      dist[next.y][next.x] = dist[c.y][c.x] + 1;
      queue.push(next);
    }
  }
  return dist;
}

/** The 4-neighbour of `from` with the smallest distance, or undefined if none is closer. */
export function stepDownhill(dist: number[][], from: Cell): Cell | undefined {
  let best: Cell | undefined;
  let bestDist = dist[from.y]?.[from.x] ?? Infinity;
  for (const n of NEIGHBORS) {
    const next = { x: from.x + n.x, y: from.y + n.y };
    const d = dist[next.y]?.[next.x] ?? Infinity;
    if (d < bestDist) {
      best = next;
      bestDist = d;
    }
  }
  return best;
}

/**
 * True if the straight segment between two points (in tile units, e.g. 2.5 = centre of tile 2)
 * crosses no tile for which `blocks` holds. Endpoints' own tiles are ignored.
 */
export function lineOfSight<T>(grid: Grid<T>, from: { x: number; y: number }, to: { x: number; y: number }, blocks: (tile: T) => boolean): boolean {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 8);
  const fromTile = `${Math.floor(from.x)},${Math.floor(from.y)}`;
  const toTile = `${Math.floor(to.x)},${Math.floor(to.y)}`;
  for (let i = 1; i < steps; i++) {
    const x = Math.floor(from.x + ((to.x - from.x) * i) / steps);
    const y = Math.floor(from.y + ((to.y - from.y) * i) / steps);
    const key = `${x},${y}`;
    if (key === fromTile || key === toTile || !inBounds(grid, { x, y })) continue;
    if (blocks(grid[y][x])) return false;
  }
  return true;
}

/** 4-connected cells reachable from `from` through cells where `passable` holds. Keys are `x,y`. */
export function floodFill<T>(grid: Grid<T>, from: Cell, passable: (tile: T) => boolean): Set<string> {
  const seen = new Set<string>();
  if (!inBounds(grid, from) || !passable(grid[from.y][from.x])) return seen;
  const queue: Cell[] = [from];
  seen.add(`${from.x},${from.y}`);
  while (queue.length) {
    const c = queue.shift()!;
    for (const n of NEIGHBORS) {
      const next = { x: c.x + n.x, y: c.y + n.y };
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || !inBounds(grid, next) || !passable(grid[next.y][next.x])) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}
