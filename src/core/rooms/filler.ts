import { Canvas } from './archetypes';
import type { Cell } from '../map/floorGenerator';
import { floodFill } from '../map/grid';
import type { Rng } from '../rng';
import { ROOM_HEIGHT, type Tile } from './roomGenerator';
import { roomThemeById } from './roomThemes';
import { doorApproach, nearDoor, validateRoom, type RoomToValidate, type Symmetry } from './roomValidator';
import { isWalkable } from '../map/tiles';

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

/**
 * Clusters for an L's elbow, as steps from the tile diagonal to the missing corner, towards it:
 * [1, 0] hugs the wall along one side, [0, 1] the other.
 */
const ELBOW_CLUSTERS: readonly (readonly [number, number])[][] = [
  [[1, 0], [0, 1]],
  [[1, 0], [2, 0], [0, 1]],
  [[1, 0], [0, 1], [0, 2]],
  [[1, 0], [2, 0], [0, 1], [0, 2]],
];

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
  // The room's outline, read off its tiles: anything past the edge or walled off (an L's missing cell).
  const bounded = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || tiles[y][x] === 'wall';
  const cellsInRoom = tiles.flatMap((row, y) => row.flatMap((t, x) => (t === 'wall' ? [] : [{ x, y }])));

  // Convex corners (a boundary on two sides) take a cluster drawn for the top-left, flipped to fit.
  // A corner already holding a spawn spot gets its cluster nudged along the walls, or a smaller one.
  const corners = cellsInRoom.filter(({ x, y }) => (bounded(x, y - 1) || bounded(x, y + 1)) && (bounded(x - 1, y) || bounded(x + 1, y)));
  for (const corner of corners) {
    if (rng.next() >= tuning.cornerChance) continue;
    // Already dressed as the mirror image of an earlier corner.
    if (tiles[corner.y][corner.x] !== 'floor') continue;
    const flipX = bounded(corner.x + 1, corner.y);
    const flipY = bounded(corner.x, corner.y + 1);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const shift = attempt === 0 ? { x: 0, y: 0 } : rng.pick([{ x: rng.int(1, 3), y: 0 }, { x: 0, y: rng.int(1, 2) }]);
      const cluster = rng.pick(CLUSTERS[size]).map((c) => ({
        x: corner.x + (flipX ? -1 : 1) * (c.x + shift.x),
        y: corner.y + (flipY ? -1 : 1) * (c.y + shift.y),
      }));
      if (place(cluster)) break;
    }
  }

  // An L's elbow (a boundary only diagonally): a cluster hugging both walls of the missing corner.
  const diagonals = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  for (const c of cellsInRoom) {
    const orthogonal = [bounded(c.x + 1, c.y), bounded(c.x - 1, c.y), bounded(c.x, c.y + 1), bounded(c.x, c.y - 1)];
    const gap = diagonals.find(([dx, dy]) => bounded(c.x + dx, c.y + dy));
    if (orthogonal.some(Boolean) || !gap || rng.next() >= tuning.cornerChance) continue;
    const [dx, dy] = gap;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const reach = rng.pick(ELBOW_CLUSTERS);
      if (place(reach.map(([ax, ay]) => ({ x: c.x + ax * dx, y: c.y + ay * dy })))) break;
    }
  }

  // Straight stretches of wall: the tiles along one side of the outline, split where it breaks.
  const walls: Cell[][] = [];
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const along = cellsInRoom.filter(({ x, y }) => bounded(x + dx, y + dy));
    const lines = new Map<number, Cell[]>();
    for (const c of along) {
      const line = dy ? c.y : c.x;
      lines.set(line, [...(lines.get(line) ?? []), c]);
    }
    for (const cells of lines.values()) {
      const pos = (c: Cell) => (dy ? c.x : c.y);
      cells.sort((a, b) => pos(a) - pos(b));
      let stretch: Cell[] = [];
      for (const c of cells) {
        if (stretch.length && pos(c) !== pos(stretch[stretch.length - 1]) + 1) {
          walls.push(stretch);
          stretch = [];
        }
        stretch.push(c);
      }
      if (stretch.length) walls.push(stretch);
    }
  }
  // Big rooms dress every wall a map cell long or more; 1x1 rooms only their longest.
  const longest = Math.max(...walls.map((w) => w.length));
  const eligible = walls.filter((w) => (size === 'big' ? w.length >= ROOM_HEIGHT : w.length === longest));
  /** A wall picked with odds by its length, so long walls get most of the runs. */
  const pickWall = () => {
    let roll = rng.int(0, eligible.reduce((n, w) => n + w.length, 0) - 1);
    return eligible.find((w) => (roll -= w.length) < 0) ?? eligible[0];
  };

  const runs = eligible.length ? rng.int(tuning.runs[0], tuning.runs[1]) : 0;
  for (let i = 0; i < runs; i++) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const wall = pickWall();
      const length = rng.int(tuning.runLength[0], tuning.runLength[1]);
      if (wall.length < length + 4) continue;
      const start = rng.int(2, wall.length - 2 - length);
      // A gap either end, so runs read as separate pieces rather than a second wall.
      if ([wall[start - 1], wall[start + length]].some((c) => tiles[c.y][c.x] !== 'floor')) continue;
      if (place(wall.slice(start, start + length))) break;
    }
  }

  if (eligible.length && rng.next() < FILLER.loneChance) {
    const wall = pickWall();
    place([wall[rng.int(1, Math.max(1, wall.length - 2))]], true);
  }
  return { tiles, symmetry };
}
