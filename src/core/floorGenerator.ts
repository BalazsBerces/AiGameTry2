import type { Rng } from './rng';

export interface Cell {
  x: number;
  y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];

export const STEP: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export type RoomKind = 'start' | 'normal' | 'item' | 'boss';

export interface FloorRoom {
  id: string;
  kind: RoomKind;
  /** Top-left map cell of the room. */
  cell: Cell;
  /** Every map cell the room covers (one for normal rooms, four for the 2x2 boss room). */
  cells: Cell[];
}

export interface FloorLayout {
  floorIndex: number;
  startRoomId: string;
  rooms: FloorRoom[];
  /** Undirected door connections between room ids. */
  connections: [string, string][];
  /** Where the boss room's exit door leads: the next floor's start cell. */
  exit: {
    cell: Cell;
    /** Wall of the boss room the exit door is on. */
    side: Direction;
    /** Boss-room map cell holding the exit door, relative to its top-left cell. */
    at: Cell;
  };
}

export interface FloorRequest {
  /** Map cells already taken by earlier floors. Keys are `x,y`. */
  occupied: ReadonlySet<string>;
  start: Cell;
  floorIndex: number;
  rng: Rng;
}

export const cellKey = (c: Cell) => `${c.x},${c.y}`;

export interface RoomDoor {
  side: Direction;
  /** Id of the room on the other side. */
  to: string;
  /** Which of this room's map cells the door is in, relative to its top-left cell. */
  at: Cell;
}

export function roomDoors(floor: FloorLayout, roomId: string): RoomDoor[] {
  const byId = new Map(floor.rooms.map((r) => [r.id, r]));
  const room = byId.get(roomId);
  if (!room) return [];
  const doors: RoomDoor[] = [];
  for (const [a, b] of floor.connections) {
    const otherId = a === roomId ? b : b === roomId ? a : undefined;
    if (otherId === undefined) continue;
    const otherCells = new Set(byId.get(otherId)!.cells.map(cellKey));
    for (const c of room.cells) {
      const side = DIRECTIONS.find((d) => otherCells.has(cellKey(add(c, d))));
      if (!side) continue;
      doors.push({ side, to: otherId, at: { x: c.x - room.cell.x, y: c.y - room.cell.y } });
      break;
    }
  }
  return doors;
}

export const FLOOR_SIZE = { min: 13, max: 15 };
/** Chance to skip a candidate during growth; keeps layouts branchy rather than blob-like. */
const SKIP_CHANCE = 0.5;
const MAX_FLOOR_ATTEMPTS = 200;

const add = (c: Cell, d: Direction): Cell => ({ x: c.x + STEP[d].x, y: c.y + STEP[d].y });

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Growth {
  cells: Cell[];
  edges: [Cell, Cell][];
}

/**
 * Isaac-style BFS growth: a candidate cell is accepted only if it touches exactly one
 * filled cell (its parent), so the layout stays a tree with no accidental adjacency.
 */
function grow(req: FloorRequest, target: number): Growth | undefined {
  const { rng, occupied } = req;
  const filled = new Set([cellKey(req.start)]);
  const growth: Growth = { cells: [req.start], edges: [] };
  const blocked = (c: Cell) => filled.has(cellKey(c)) || occupied.has(cellKey(c));
  const queue: Cell[] = [req.start];
  while (queue.length && growth.cells.length < target) {
    const cell = queue.shift()!;
    for (const d of shuffled(DIRECTIONS, rng)) {
      if (growth.cells.length >= target) break;
      const next = add(cell, d);
      if (blocked(next)) continue;
      if (DIRECTIONS.filter((nd) => blocked(add(next, nd))).length > 1) continue;
      if (rng.next() < SKIP_CHANCE) continue;
      filled.add(cellKey(next));
      growth.cells.push(next);
      growth.edges.push([cell, next]);
      queue.push(next);
    }
  }
  return growth.cells.length === target ? growth : undefined;
}

export function generateFloor(req: FloorRequest): FloorLayout {
  for (let attempt = 0; attempt < MAX_FLOOR_ATTEMPTS; attempt++) {
    const growth = grow(req, req.rng.int(FLOOR_SIZE.min, FLOOR_SIZE.max));
    const floor = growth && assignSpecialRooms(req, growth);
    if (floor) return floor;
  }
  throw new Error(`generateFloor: no valid layout after ${MAX_FLOOR_ATTEMPTS} attempts`);
}

/** Tree depth of every grown cell from the start, plus each cell's parent. */
function treeDepths(growth: Growth) {
  const depth = new Map<string, number>([[cellKey(growth.cells[0]), 0]]);
  const parent = new Map<string, Cell>();
  for (const [a, b] of growth.edges) {
    depth.set(cellKey(b), depth.get(cellKey(a))! + 1);
    parent.set(cellKey(b), a);
  }
  return { depth, parent };
}

/** Free cells the next floor must be able to reach from the exit. */
const ROOM_BEYOND_EXIT = 40;

/**
 * True if enough cells beyond the exit are free and touch no existing room, so the next
 * floor (whose rooms may not touch earlier floors) has space to grow to full size.
 */
function roomBeyond(exit: Cell, exitFrom: Cell, taken: (c: Cell) => boolean): boolean {
  const usable = (c: Cell) =>
    !taken(c) && DIRECTIONS.every((d) => !taken(add(c, d)) || (cellKey(c) === cellKey(exit) && cellKey(add(c, d)) === cellKey(exitFrom)));
  const seen = new Set([cellKey(exit)]);
  const queue = [exit];
  while (queue.length && seen.size < ROOM_BEYOND_EXIT) {
    const c = queue.shift()!;
    for (const d of DIRECTIONS) {
      const n = add(c, d);
      if (seen.has(cellKey(n)) || !usable(n)) continue;
      seen.add(cellKey(n));
      queue.push(n);
    }
  }
  return seen.size >= ROOM_BEYOND_EXIT;
}

/**
 * Expands a dead end into a 2x2 block pointing away from its parent. The three new cells
 * must be free and must not touch anything but the block itself, keeping the layout a tree.
 */
function bossBlock(
  deadEnd: Cell,
  parent: Cell,
  taken: (c: Cell) => boolean,
  rng: Rng,
): { block: Cell[]; exitFrom: Cell; exit: Cell; exitSide: Direction } | undefined {
  const away = { x: deadEnd.x - parent.x, y: deadEnd.y - parent.y };
  const exitSide = DIRECTIONS.find((d) => STEP[d].x === away.x && STEP[d].y === away.y)!;
  // The exit continues straight through the block from the entrance.
  const exitFrom = { x: deadEnd.x + away.x, y: deadEnd.y + away.y };
  const exit = { x: exitFrom.x + away.x, y: exitFrom.y + away.y };
  const exitClear =
    !taken(exit) && DIRECTIONS.every((d) => cellKey(add(exit, d)) === cellKey(exitFrom) || !taken(add(exit, d)));
  if (!exitClear) return undefined;

  const sides = shuffled([1, -1], rng).map((s) => ({ x: away.y * s, y: away.x * s }));
  for (const side of sides) {
    const block = [
      deadEnd,
      exitFrom,
      { x: deadEnd.x + side.x, y: deadEnd.y + side.y },
      { x: deadEnd.x + away.x + side.x, y: deadEnd.y + away.y + side.y },
    ];
    const inBlock = new Set(block.map(cellKey));
    const fresh = block.slice(1);
    const clear = fresh.every(
      (c) => !taken(c) && DIRECTIONS.every((d) => inBlock.has(cellKey(add(c, d))) || !taken(add(c, d))),
    );
    // The exit must not end up touching the block's side cells except where it opens.
    const exitTouchesSide = DIRECTIONS.some((d) => {
      const n = cellKey(add(exit, d));
      return n !== cellKey(exitFrom) && inBlock.has(n);
    });
    const takenWithBlock = (c: Cell) => inBlock.has(cellKey(c)) || taken(c);
    if (clear && !exitTouchesSide && roomBeyond(exit, exitFrom, takenWithBlock)) return { block, exitFrom, exit, exitSide };
  }
  return undefined;
}

function assignSpecialRooms(req: FloorRequest, growth: Growth): FloorLayout | undefined {
  const { rng } = req;
  const startId = cellKey(req.start);
  const { depth, parent } = treeDepths(growth);
  const childCount = new Map<string, number>();
  for (const [a] of growth.edges) childCount.set(cellKey(a), (childCount.get(cellKey(a)) ?? 0) + 1);
  const deadEnds = growth.cells.filter((c) => cellKey(c) !== startId && !childCount.has(cellKey(c)));
  if (deadEnds.length < 2) return undefined;

  const maxDepth = Math.max(...deadEnds.map((c) => depth.get(cellKey(c))!));
  const filled = new Set(growth.cells.map(cellKey));
  const taken = (c: Cell) => filled.has(cellKey(c)) || req.occupied.has(cellKey(c));
  let boss: ({ deadEnd: Cell } & NonNullable<ReturnType<typeof bossBlock>>) | undefined;
  for (const deadEnd of shuffled(deadEnds.filter((c) => depth.get(cellKey(c)) === maxDepth), rng)) {
    const placed = bossBlock(deadEnd, parent.get(cellKey(deadEnd))!, taken, rng);
    if (placed) {
      boss = { deadEnd, ...placed };
      break;
    }
  }
  if (!boss) return undefined;

  const bossDeadEndId = cellKey(boss.deadEnd);
  const itemId = cellKey(rng.pick(deadEnds.filter((c) => cellKey(c) !== bossDeadEndId)));
  const bossAnchor = {
    x: Math.min(...boss.block.map((c) => c.x)),
    y: Math.min(...boss.block.map((c) => c.y)),
  };
  const bossId = cellKey(bossAnchor);
  const idOf = (key: string) => (key === bossDeadEndId ? bossId : key);

  const rooms: FloorRoom[] = growth.cells.map((cell) => {
    const key = cellKey(cell);
    if (key === bossDeadEndId) return { id: bossId, kind: 'boss', cell: bossAnchor, cells: boss.block };
    const kind: RoomKind = key === startId ? 'start' : key === itemId ? 'item' : 'normal';
    return { id: key, kind, cell, cells: [cell] };
  });
  return {
    floorIndex: req.floorIndex,
    startRoomId: startId,
    rooms,
    connections: growth.edges.map(([a, b]) => [idOf(cellKey(a)), idOf(cellKey(b))]),
    exit: {
      cell: boss.exit,
      side: boss.exitSide,
      at: { x: boss.exitFrom.x - bossAnchor.x, y: boss.exitFrom.y - bossAnchor.y },
    },
  };
}
