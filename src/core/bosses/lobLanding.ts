import { cellKey, type Cell } from '../map/floorGenerator';
import type { Rng } from '../rng';
import type { Door, Tile } from '../rooms/roomGenerator';
import { doorApproach } from '../rooms/roomValidator';
import { isWalkable } from '../map/tiles';

export interface LobTarget {
  /** Things come down this many tiles (8-way) around their target, and no nearer than `minSpread` (1 if left out). */
  spread: number;
  minSpread?: number;
  count: number;
  /** Cells nothing may land on, besides the rules every lob follows. */
  keepOff: (c: Cell) => boolean;
  /** What a landing turns its cell into, picked as it is chosen; the next landings plan around it. */
  lands: (c: Cell) => Tile;
  /**
   * Whether a landing needs walkable ground on all 8 sides: one that stays for good (a sprout)
   * must, so it can never cut any walkable tile or door off from the rest of the room.
   */
  openAround: boolean;
}

/**
 * Where things lobbed around a cell come down (a Treant's seed pods around the player, a worm
 * boss's eggs around itself): up to `count` different cells, each on floor, never on `around`
 * itself or a door's approach, and with open ground all around (counting the earlier landings)
 * if `openAround`.
 */
export function planLandings(tiles: Tile[][], doors: Door[], around: Cell, rng: Rng, target: LobTarget): { cell: Cell; tile: Tile }[] {
  const planned = tiles.map((row) => [...row]);
  const approaches = new Set(doors.flatMap(doorApproach).map(cellKey));
  const walkableAt = (c: Cell) => {
    const tile = planned[c.y]?.[c.x];
    return tile !== undefined && isWalkable(tile);
  };
  const openAround = (c: Cell) => [-1, 0, 1].every((dx) => [-1, 0, 1].every((dy) => walkableAt({ x: c.x + dx, y: c.y + dy })));
  const landable = (c: Cell) =>
    planned[c.y]?.[c.x] === 'floor' &&
    Math.max(Math.abs(c.x - around.x), Math.abs(c.y - around.y)) >= (target.minSpread ?? 1) &&
    !target.keepOff(c) &&
    !approaches.has(cellKey(c)) &&
    (!target.openAround || openAround(c));

  const candidates: Cell[] = [];
  for (let dy = -target.spread; dy <= target.spread; dy++) {
    for (let dx = -target.spread; dx <= target.spread; dx++) candidates.push({ x: around.x + dx, y: around.y + dy });
  }
  const landings: { cell: Cell; tile: Tile }[] = [];
  while (landings.length < target.count && candidates.length) {
    const cell = candidates.splice(rng.int(0, candidates.length - 1), 1)[0];
    if (!landable(cell)) continue;
    const tile = target.lands(cell);
    planned[cell.y][cell.x] = tile;
    landings.push({ cell, tile });
  }
  return landings;
}
