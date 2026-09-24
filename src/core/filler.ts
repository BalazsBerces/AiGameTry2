import { Canvas } from './archetypes';
import type { Cell } from './floorGenerator';
import { floodFill } from './grid';
import type { Rng } from './rng';
import { ROOM_HEIGHT, type Tile } from './roomGenerator';
import { roomThemeById } from './roomThemes';
import { doorApproach, nearDoor, validateRoom, type RoomToValidate, type Symmetry } from './roomValidator';
import { isWalkable } from './tiles';

export interface FillerRequest {
  room: RoomToValidate;
  symmetry: Symmetry;
  /** Cells to keep clear besides enemies, pickups and door approaches: a layout's spawn spots. */
  protect: Cell[];
  /** The room's sub-theme id (core/roomThemes): it picks the pieces. */
  theme: string;
  /** Big rooms get a cluster in most corners and runs along the walls; 1x1 rooms a lighter touch. */
  size: 'big' | 'small';
  rng: Rng;
}

/** Corner clusters, drawn for the top-left corner and flipped into the others. */
const CLUSTERS = {
  big: [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  ],
  small: [
    [{ x: 0, y: 0 }],
    [{ x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  ],
};

/** Tuning, all in one place: how often each corner gets a cluster, how many wall runs and how long. */
export const FILLER = {
  big: { cornerChance: 0.9, runs: [1, 3], runLength: [2, 3] },
  small: { cornerChance: 0.4, runs: [0, 1], runLength: [1, 1] },
  /** Chance of one unmirrored piece against a wall, the odd stray that keeps a room from looking stamped. */
  loneChance: 0.3,
} as const;

/** Tries at each corner and wall run before giving up on it. */
const ATTEMPTS = 8;

const key = (c: Cell) => `${c.x},${c.y}`;

/**
 * The room's tiles with solid set dressing added along its edges, and its symmetry (a lone piece
 * joins its feature). Each group is mirrored through the room's axes and only kept if it leaves
 * every protected cell clear, seals no floor away and the room still passes validation, so
 * filler may end up as extra cover but never breaks a room.
 */
export function addFiller(req: FillerRequest): { tiles: Tile[][]; symmetry: Symmetry } {
  const { room, rng, size } = req;
  const pieces = roomThemeById(req.theme)?.filler ?? [];
  const tiles = room.tiles.map((row) => [...row]);
  let symmetry: Symmetry = { axes: req.symmetry.axes, feature: [...(req.symmetry.feature ?? [])] };
  const height = tiles.length;
  const width = tiles[0].length;
  if (!pieces.length) return { tiles, symmetry };

  const guarded = new Set(
    [
      ...req.protect,
      ...room.enemies.flatMap((e) => [e.cell, ...(e.tail ?? []), ...(e.anchors ?? [])]),
      ...room.pickups.map((p) => p.cell),
      ...room.doors.flatMap(doorApproach),
    ].map(key),
  );
  const origin = room.doors[0]?.cell;
  const reachable = () => (origin ? floodFill(tiles, origin, isWalkable) : new Set<string>());
  const mirror = new Canvas(width, height, symmetry.axes);

  /** Paints the cells (and, unless lone, their mirror images) if the room stays sound; true if it did. */
  const place = (cells: Cell[], lone = false): boolean => {
    // Images landing in an L's walled-off corner are simply left out.
    const all = (lone ? cells : cells.flatMap((c) => mirror.images(c))).filter((c) => tiles[c.y]?.[c.x] !== 'wall');
    if (!all.length) return false;
    const free = (c: Cell) =>
      c.x >= 0 && c.y >= 0 && c.x < width && c.y < height && tiles[c.y][c.x] === 'floor' && !guarded.has(key(c)) && !nearDoor(room.doors, c);
    if (!all.every(free)) return false;
    const before = reachable();
    const tile = rng.pick(pieces);
    for (const c of all) tiles[c.y][c.x] = tile;
    const trial = lone ? { ...symmetry, feature: [...(symmetry.feature ?? []), ...all] } : symmetry;
    const after = reachable();
    const sealed = [...before].some((k) => !after.has(k) && !all.some((c) => key(c) === k));
    if (!sealed && validateRoom({ ...room, tiles }, trial).length === 0) {
      symmetry = trial;
      return true;
    }
    for (const c of all) tiles[c.y][c.x] = 'floor';
    return false;
  };

  const tuning = FILLER[size];
  const corners = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const;
  // A corner already holding a spawn spot gets its cluster nudged along the walls, or a smaller one.
  for (const [flipX, flipY] of corners) {
    if (rng.next() >= tuning.cornerChance) continue;
    // Already dressed as the mirror image of an earlier corner.
    if (tiles[flipY ? height - 1 : 0][flipX ? width - 1 : 0] !== 'floor') continue;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const shift = attempt === 0 ? { x: 0, y: 0 } : rng.pick([{ x: rng.int(1, 3), y: 0 }, { x: 0, y: rng.int(1, 2) }]);
      const cluster = rng.pick(CLUSTERS[size]).map((c) => ({
        x: flipX ? width - 1 - c.x - shift.x : c.x + shift.x,
        y: flipY ? height - 1 - c.y - shift.y : c.y + shift.y,
      }));
      if (place(cluster)) break;
    }
  }

  // Runs along the long walls: every wall at least two map cells long, or a 1x1 room's longest.
  const sides = ['up', 'down', 'left', 'right'] as const;
  const wallLength = (side: (typeof sides)[number]) => (side === 'up' || side === 'down' ? width : height);
  const long = sides.filter((side) => wallLength(side) >= 2 * ROOM_HEIGHT);
  const walls = long.length ? long : sides.filter((side) => wallLength(side) === Math.max(width, height));
  const runs = rng.int(tuning.runs[0], tuning.runs[1]);
  for (let i = 0; i < runs; i++) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const side = rng.pick(walls);
      const along = side === 'up' || side === 'down' ? width : height;
      const length = rng.int(tuning.runLength[0], tuning.runLength[1]);
      const start = rng.int(2, along - 2 - length);
      const at = (t: number) =>
        side === 'up' ? { x: t, y: 0 } : side === 'down' ? { x: t, y: height - 1 } : side === 'left' ? { x: 0, y: t } : { x: width - 1, y: t };
      const cells = Array.from({ length }, (_, j) => at(start + j));
      // A gap either end, so runs read as separate pieces rather than a second wall.
      const ends = [at(start - 1), at(start + length)];
      if (ends.some((c) => tiles[c.y]?.[c.x] !== 'floor')) continue;
      if (place(cells)) break;
    }
  }

  if (rng.next() < FILLER.loneChance) {
    const side = rng.pick(walls);
    const t = rng.int(1, (side === 'up' || side === 'down' ? width : height) - 2);
    place([side === 'up' ? { x: t, y: 0 } : side === 'down' ? { x: t, y: height - 1 } : side === 'left' ? { x: 0, y: t } : { x: width - 1, y: t }], true);
  }
  return { tiles, symmetry };
}
