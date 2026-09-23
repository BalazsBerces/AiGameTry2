import type { Cell } from './floorGenerator';
import { floodFill, lineOfSight } from './grid';
import type { Door, RoomLayout, Tile } from './roomGenerator';
import { blocksSight, isWalkable } from './tiles';

export type MirrorAxis = 'vertical' | 'horizontal';

/** The mirror axes a room's terrain holds, and the tiles of its idea exempt from them. */
export interface Symmetry {
  axes: MirrorAxis[];
  feature?: Cell[];
}

export type ViolationRule =
  | 'door-unreachable'
  | 'door-blocked'
  | 'walker-unreachable'
  | 'turret-unshootable'
  | 'enemy-near-door'
  | 'overlap'
  | 'spawn-off-floor'
  | 'asymmetric';

export interface Violation {
  rule: ViolationRule;
  cell?: Cell;
}

export type RoomToValidate = Pick<RoomLayout, 'tiles' | 'doors' | 'enemies' | 'pickups'>;

const key = (c: Cell) => `${c.x},${c.y}`;
const isWalkableAt = (tiles: Tile[][], c: Cell) => {
  const tile = tiles[c.y]?.[c.x];
  return tile !== undefined && isWalkable(tile);
};

/** The tile a door opens onto and the one just inside it: both must stay open floor. */
export const doorApproach = ({ side, cell }: Door): Cell[] => {
  const inward = { up: { x: 0, y: 1 }, down: { x: 0, y: -1 }, left: { x: 1, y: 0 }, right: { x: -1, y: 0 } }[side];
  return [cell, { x: cell.x + inward.x, y: cell.y + inward.y }];
};

/** Within one tile (8-way) of a door: too close to spawn an enemy. */
export const nearDoor = (doors: Door[], c: Cell) => doors.some((d) => Math.abs(d.cell.x - c.x) <= 1 && Math.abs(d.cell.y - c.y) <= 1);

/** Every rule a generated room must satisfy; an empty list means the room is valid. */
export function validateRoom(room: RoomToValidate, symmetry: Symmetry): Violation[] {
  const { tiles, doors } = room;
  const violations: Violation[] = [];
  const reachable = doors.length ? floodFill(tiles, doors[0].cell, isWalkable) : new Set<string>();
  for (const d of doors) if (!reachable.has(key(d.cell))) violations.push({ rule: 'door-unreachable', cell: d.cell });
  for (const d of doors) {
    if (doorApproach(d).some((c) => !isWalkableAt(tiles, c))) violations.push({ rule: 'door-blocked', cell: d.cell });
  }

  const standable = [...reachable].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x: x + 0.5, y: y + 0.5 };
  });
  for (const e of room.enemies) {
    if (e.type === 'turret') {
      const from = { x: e.cell.x + 0.5, y: e.cell.y + 0.5 };
      if (!standable.some((p) => lineOfSight(tiles, from, p, blocksSight))) {
        violations.push({ rule: 'turret-unshootable', cell: e.cell });
      }
      continue;
    }
    // Everything else walks (a worm needs its whole body reachable).
    if (![e.cell, ...(e.tail ?? [])].every((c) => reachable.has(key(c)))) {
      violations.push({ rule: 'walker-unreachable', cell: e.cell });
    }
  }
  for (const e of room.enemies) {
    if ([e.cell, ...(e.tail ?? [])].some((c) => nearDoor(doors, c))) violations.push({ rule: 'enemy-near-door', cell: e.cell });
  }

  const spawnCells = [...room.enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])]), ...room.pickups.map((p) => p.cell)];
  const seen = new Set<string>();
  for (const c of spawnCells) {
    if (seen.has(key(c))) violations.push({ rule: 'overlap', cell: c });
    seen.add(key(c));
  }
  for (const c of spawnCells) if (!isWalkableAt(tiles, c)) violations.push({ rule: 'spawn-off-floor', cell: c });

  if (!isSymmetric(tiles, symmetry)) violations.push({ rule: 'asymmetric' });
  return violations;
}

/** Terrain mirrors across every declared axis; feature tiles (and their mirror images) are exempt. */
function isSymmetric(tiles: Tile[][], { axes, feature = [] }: Symmetry): boolean {
  if (!axes.length) return false;
  const height = tiles.length;
  const width = tiles[0].length;
  const exempt = new Set(feature.map(key));
  const mirror = (c: Cell, axis: MirrorAxis): Cell =>
    axis === 'vertical' ? { x: width - 1 - c.x, y: c.y } : { x: c.x, y: height - 1 - c.y };
  return axes.every((axis) =>
    tiles.every((row, y) =>
      row.every((tile, x) => {
        const m = mirror({ x, y }, axis);
        return exempt.has(key({ x, y })) || exempt.has(key(m)) || tile === tiles[m.y][m.x];
      }),
    ),
  );
}
