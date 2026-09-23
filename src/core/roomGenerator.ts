import { archetypeById, archetypesFor, fallbackArchetype } from './archetypes';
import type { Cell, Direction, RoomKind } from './floorGenerator';
import { floodFill } from './grid';
import { validateRoom } from './roomValidator';
import type { Passive } from './weaponModel';
import type { Rng } from './rng';

export const ROOM_WIDTH = 13;
export const ROOM_HEIGHT = 7;
export const BOSS_WIDTH = 26;
export const BOSS_HEIGHT = 14;
/** Tiles per map cell: a 13x7 room interior plus its one-tile wall ring. */
export const CELL_TILES = { w: ROOM_WIDTH + 2, h: ROOM_HEIGHT + 2 };

/** `obstacle` is stone; `rock` is the same but breaks after a few player shots. */
export type Tile = 'floor' | 'obstacle' | 'rock' | 'hole';

/** Player shots it takes to break a rock. */
export const ROCK_HITS = 3;

export interface DoorSpec {
  side: Direction;
  /** Map cell of a multi-cell room the door belongs to, relative to its top-left cell. */
  at: Cell;
}

export interface RoomSpec {
  id: string;
  kind: RoomKind;
  /** A bare side is shorthand for a door in the room's top-left cell. */
  doors: (Direction | DoorSpec)[];
  /** Idea to build the room from, as assigned per floor; picked here if left out. */
  archetype?: string;
}

export const roomSize = (kind: RoomKind) =>
  kind === 'boss' ? { width: BOSS_WIDTH, height: BOSS_HEIGHT } : { width: ROOM_WIDTH, height: ROOM_HEIGHT };

/** Wall thickness in tiles between the room's map-cell block edge and its interior. */
export function roomPadding(width: number, height: number) {
  const cellsW = Math.ceil(width / ROOM_WIDTH);
  const cellsH = Math.ceil(height / ROOM_HEIGHT);
  return { x: (cellsW * CELL_TILES.w - width) / 2, y: (cellsH * CELL_TILES.h - height) / 2 };
}

export interface Door {
  side: Direction;
  /** The edge cell inside the room that the door opens onto. */
  cell: Cell;
}

export interface RoomLayout {
  id: string;
  width: number;
  height: number;
  /** tiles[y][x] */
  tiles: Tile[][];
  doors: Door[];
  enemies: EnemySpawn[];
  /** Rolled at generation; revealed once the room is cleared. */
  pickups: PickupSpawn[];
  /** Cells where a boss may summon enemies during the fight (validated like any spawn). */
  summonPoints: Cell[];
  /** The idea the room was built from, if any. */
  archetype?: string;
}

export type PickupType = 'heart' | 'key' | 'bomb' | 'chest' | 'lockedChest' | 'passive';

/** Something a chest releases. */
export type ChestItem = { type: 'heart' } | { type: 'key' } | { type: 'bomb' } | { type: 'passive'; passive: Passive };

export interface PickupSpawn {
  type: PickupType;
  cell: Cell;
  /** Which passive item, for `passive` pickups. */
  passive?: Passive;
  /** What a chest releases when opened. */
  contents?: ChestItem[];
  /** Placed by the room's idea in plain sight, rather than revealed when the room is cleared. */
  visible?: boolean;
}

export const PASSIVE_POOL: readonly Passive[] = ['homing', 'fireRate', 'sword'];

export type EnemyType = 'zombie' | 'turret' | 'worm' | 'wormBoss' | 'hiveBoss' | 'shadowBoss';

export interface EnemySpawn {
  type: EnemyType;
  /** The enemy's cell; for a worm, its head. */
  cell: Cell;
  /** A worm's body behind the head, in order. */
  tail?: Cell[];
  /** Tougher and always drops `drop` (from the normal room-clear pool) when killed. */
  champion?: { drop: ChampionDrop };
}

/** A champion's extra pickup; it lands wherever the champion dies. */
export type ChampionDrop = Omit<PickupSpawn, 'cell'>;

/** Doors sit at the centre of the wall of the map cell they belong to. */
function doorCell({ side, at }: DoorSpec, width: number, height: number): Cell {
  const pad = roomPadding(width, height);
  const midX = at.x * CELL_TILES.w + Math.floor(CELL_TILES.w / 2) - pad.x;
  const midY = at.y * CELL_TILES.h + Math.floor(CELL_TILES.h / 2) - pad.y;
  switch (side) {
    case 'up':
      return { x: midX, y: 0 };
    case 'down':
      return { x: midX, y: height - 1 };
    case 'left':
      return { x: 0, y: midY };
    case 'right':
      return { x: width - 1, y: midY };
  }
}

const MAX_TERRAIN_ATTEMPTS = 50;

const LABYRINTH = {
  /** Coarse cells are 3x3 tiles, a 2x2 passage plus a wall column/row: 9x5 of them exactly fill 26x14. */
  cols: 9,
  rows: 5,
  /** Chance to knock out each wall left by the maze, creating loops. */
  extraOpening: 0.08,
};

/**
 * Worm boss arena: a maze on a coarse grid with extra walls removed, so there are loops and
 * no dead ends. Passages are two tiles wide, leaving the worm room to turn.
 */
function placeLabyrinth(tiles: Tile[][], rng: Rng, keepClear: (c: Cell) => boolean) {
  const { cols, rows } = LABYRINTH;
  const origin = (i: number, j: number) => ({ x: 3 * i, y: 3 * j });
  const block = (c: Cell) => {
    if (!keepClear(c)) tiles[c.y][c.x] = 'obstacle';
  };
  // Walls between coarse cells: `r i,j` is right of (i,j), `b i,j` is below it.
  const walls = new Set<string>();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (i < cols - 1) walls.add(`r ${i},${j}`);
      if (j < rows - 1) walls.add(`b ${i},${j}`);
    }
  }
  const wallBetween = (a: Cell, b: Cell) =>
    a.x === b.x ? `b ${a.x},${Math.min(a.y, b.y)}` : `r ${Math.min(a.x, b.x)},${a.y}`;
  const neighbors = (c: Cell) =>
    [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }].filter(
      (n) => n.x >= 0 && n.y >= 0 && n.x < cols && n.y < rows,
    );

  // Randomised depth-first maze.
  const visited = new Set(['0,0']);
  const stack: Cell[] = [{ x: 0, y: 0 }];
  while (stack.length) {
    const c = stack[stack.length - 1];
    const next = neighbors(c).filter((n) => !visited.has(`${n.x},${n.y}`));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const n = rng.pick(next);
    walls.delete(wallBetween(c, n));
    visited.add(`${n.x},${n.y}`);
    stack.push(n);
  }
  for (const w of [...walls]) if (rng.next() < LABYRINTH.extraOpening) walls.delete(w);
  // No dead-end cells: open another wall wherever a cell has a single way out.
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const c = { x: i, y: j };
      const closed = neighbors(c).filter((n) => walls.has(wallBetween(c, n)));
      if (neighbors(c).length - closed.length < 2 && closed.length) walls.delete(wallBetween(c, rng.pick(closed)));
    }
  }

  for (const w of walls) {
    const [kind, rest] = w.split(' ');
    const [i, j] = rest.split(',').map(Number);
    const o = origin(i, j);
    const cells = kind === 'r' ? [{ x: o.x + 2, y: o.y }, { x: o.x + 2, y: o.y + 1 }] : [{ x: o.x, y: o.y + 2 }, { x: o.x + 1, y: o.y + 2 }];
    cells.forEach(block);
  }
  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const o = origin(i, j);
      block({ x: o.x + 2, y: o.y + 2 });
    }
  }
}

type TerrainStrategy = (tiles: Tile[][], rng: Rng, keepClear: (c: Cell) => boolean) => void;

export type BossType = 'wormBoss' | 'hiveBoss' | 'shadowBoss';

const BOSS_BY_FLOOR: readonly BossType[] = ['wormBoss', 'hiveBoss', 'shadowBoss'];
export const bossForFloor = (floorIndex: number): BossType => BOSS_BY_FLOOR[Math.min(floorIndex, BOSS_BY_FLOOR.length - 1)];

const BOSS_ARENAS: Record<BossType, TerrainStrategy> = {
  wormBoss: placeLabyrinth,
  hiveBoss: placeCover,
  shadowBoss: placePillars,
};

/**
 * Shadow arena: randomly scattered pillars on a loose lattice. Deliberately asymmetric, so the
 * point-mirrored Shadow gets blocked where the player is not, opening gaps in its mirroring.
 */
function placePillars(tiles: Tile[][], rng: Rng, keepClear: (c: Cell) => boolean) {
  const nearDoor = (c: Cell) =>
    [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => keepClear({ x: c.x + dx, y: c.y + dy })));
  const slots: Cell[] = [];
  for (let x = 3; x < tiles[0].length - 3; x += 4) for (let y = 2; y < tiles.length - 2; y += 4) slots.push({ x, y });
  let placed = 0;
  for (const slot of shuffle(slots, rng)) {
    if (placed >= PILLARS.minCells && rng.next() > PILLARS.slotChance) continue;
    const big = rng.next() < PILLARS.bigChance;
    const px = slot.x + rng.int(-1, 1);
    const py = slot.y + rng.int(0, 1);
    const cells = big ? [{ x: px, y: py }, { x: px + 1, y: py }, { x: px, y: py + 1 }, { x: px + 1, y: py + 1 }] : [{ x: px, y: py }];
    for (const c of cells) {
      if (nearDoor(c) || tiles[c.y][c.x] === 'obstacle') continue;
      tiles[c.y][c.x] = 'obstacle';
      placed++;
    }
  }
}

const PILLARS = { minCells: 8, slotChance: 0.45, bigChance: 0.4 };

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Top-left tile of the Hive's 2x2 core: the middle of the 26x14 arena. */
export const HIVE_CORE: Cell = { x: 12, y: 6 };

const COVER_SHAPES: readonly Cell[][] = [
  [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
];

/**
 * Hive arena: blocks of cover mirrored into all four quadrants, leaving the core's
 * surroundings open so the player can reach it and use the cover against its spirals.
 */
function placeCover(tiles: Tile[][], rng: Rng, keepClear: (c: Cell) => boolean) {
  const height = tiles.length;
  const width = tiles[0].length;
  const nearCore = (c: Cell) => c.x >= HIVE_CORE.x - 3 && c.x <= HIVE_CORE.x + 4 && c.y >= HIVE_CORE.y - 2 && c.y <= HIVE_CORE.y + 3;
  const nearDoor = (c: Cell) =>
    [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => keepClear({ x: c.x + dx, y: c.y + dy })));
  const blocks = rng.int(3, 5);
  for (let i = 0; i < blocks; i++) {
    const shape = rng.pick(COVER_SHAPES);
    const ox = rng.int(1, Math.floor(width / 2) - 3);
    const oy = rng.int(1, Math.floor(height / 2) - 2);
    for (const p of shape) {
      const c = { x: ox + p.x, y: oy + p.y };
      const mirrored = [c, { x: width - 1 - c.x, y: c.y }, { x: c.x, y: height - 1 - c.y }, { x: width - 1 - c.x, y: height - 1 - c.y }];
      for (const m of mirrored) if (!nearCore(m) && !nearDoor(m)) tiles[m.y][m.x] = 'obstacle';
    }
  }
}

export const isWalkable = (tile: Tile) => tile === 'floor';
/** Tiles that stop shots and line of sight; holes do not. */
export const blocksSight = (tile: Tile) => tile === 'obstacle' || tile === 'rock';
export const isBreakable = (tile: Tile) => tile === 'rock';
/** Bombs blow away stone as well as rock; holes stay holes. */
export const isBlastable = (tile: Tile) => tile === 'rock' || tile === 'obstacle';

const roomOrigin = (tiles: Tile[][], doors: Door[]): Cell =>
  doors[0]?.cell ?? { x: Math.floor(tiles[0].length / 2), y: Math.floor(tiles.length / 2) };

/** All doors and all walkable cells form one connected region. */
function isConnected(tiles: Tile[][], doors: Door[]): boolean {
  const seen = floodFill(tiles, roomOrigin(tiles, doors), isWalkable);
  const walkable = tiles.flat().filter(isWalkable).length;
  return seen.size === walkable && doors.every((d) => seen.has(`${d.cell.x},${d.cell.y}`));
}

const emptyTiles = (width: number, height: number): Tile[][] =>
  Array.from({ length: height }, () => Array<Tile>(width).fill('floor'));

const MAX_ARCHETYPE_ATTEMPTS = 40;

/**
 * Builds the room from its archetype (or one picked here if none was assigned), rerolling
 * until it passes validation; after too many failures the floor's fallback breather takes
 * over, and if even that fails the room is left empty, which is always valid.
 */
function buildFromArchetype(spec: RoomSpec, doors: Door[], floorIndex: number, rng: Rng) {
  const { width, height } = roomSize(spec.kind);
  const sides = doors.map((d) => d.side);
  const fitting = archetypesFor(floorIndex, spec.kind).filter((a) => a.fits(sides));
  const named = spec.archetype ? archetypeById(spec.archetype) : undefined;
  const assigned = named?.fits(sides) ? named : undefined;
  const fallback = fallbackArchetype(floorIndex, spec.kind);
  const chosen = assigned ?? (fitting.length ? rng.pick(fitting) : fallback);
  for (const archetype of [chosen, fallback]) {
    for (let attempt = 0; attempt < MAX_ARCHETYPE_ATTEMPTS; attempt++) {
      const built = archetype.build({ width, height, doors, rng });
      if (validateRoom({ ...built, doors }, built.symmetry).length === 0) return { ...built, archetype: archetype.id };
    }
  }
  return { tiles: emptyTiles(width, height), enemies: [] as EnemySpawn[], pickups: [] as PickupSpawn[], archetype: fallback.id };
}

export function generateRoom(spec: RoomSpec, floorIndex: number, rng: Rng): RoomLayout {
  const { width, height } = roomSize(spec.kind);
  const doors = spec.doors
    .map((d): DoorSpec => (typeof d === 'string' ? { side: d, at: { x: 0, y: 0 } } : d))
    .map((d) => ({ side: d.side, cell: doorCell(d, width, height) }));
  if (archetypesFor(floorIndex, spec.kind).length) {
    const built = buildFromArchetype(spec, doors, floorIndex, rng);
    const pickups = built.pickups.map((p) => placeLoot(p, rng));
    if (spec.kind === 'normal') pickups.push(...rollClearDrop(built.tiles, doors, built.enemies, pickups, rng));
    // Its own stream, so champion rolls never shift the room's layout.
    const enemies = spec.kind === 'normal' ? crownChampion(built.enemies, rng.fork('champion')) : built.enemies;
    return { id: spec.id, width, height, tiles: built.tiles, doors, enemies, pickups, summonPoints: [], archetype: built.archetype };
  }
  // Normal and item rooms come from archetypes above; boss arenas are built here, start rooms stay empty.
  const isDoor = (c: Cell) => doors.some((d) => d.cell.x === c.x && d.cell.y === c.y);
  let tiles = emptyTiles(width, height);
  const terrain = spec.kind === 'boss' ? BOSS_ARENAS[bossForFloor(floorIndex)] : undefined;
  for (let attempt = 0; terrain && attempt < MAX_TERRAIN_ATTEMPTS; attempt++) {
    const candidate = emptyTiles(width, height);
    terrain(candidate, rng, isDoor);
    if (isConnected(candidate, doors)) {
      tiles = candidate;
      break;
    }
  }
  const enemies: EnemySpawn[] = [];
  if (spec.kind === 'boss' && bossForFloor(floorIndex) === 'wormBoss') {
    const farFromDoors = (c: Cell) => doors.every((d) => Math.abs(d.cell.x - c.x) + Math.abs(d.cell.y - c.y) > 3);
    const pool = reachableCells(tiles, doors).filter(farFromDoors);
    for (let attempt = 0; attempt < 100 && pool.length; attempt++) {
      const head = rng.pick(pool);
      const rest = pool.filter((c) => c !== head);
      const tail = growTail(head, rest, WORM_BOSS_LENGTH - 1, rng);
      if (tail) {
        enemies.push({ type: 'wormBoss', cell: head, tail });
        break;
      }
    }
  }
  if (spec.kind === 'boss' && bossForFloor(floorIndex) === 'shadowBoss') {
    // The Shadow mirrors the player through the room centre, so it starts opposite the entrance.
    const entrance = doors[0]?.cell ?? { x: 0, y: 0 };
    const mirror = { x: width - 1 - entrance.x, y: height - 1 - entrance.y };
    const cell = reachableCells(tiles, doors).sort(
      (a, b) => Math.hypot(a.x - mirror.x, a.y - mirror.y) - Math.hypot(b.x - mirror.x, b.y - mirror.y),
    )[0];
    enemies.push({ type: 'shadowBoss', cell });
  }
  const summonPoints: Cell[] = [];
  if (spec.kind === 'boss' && bossForFloor(floorIndex) === 'hiveBoss') {
    enemies.push({ type: 'hiveBoss', cell: HIVE_CORE });
    const core = [0, 1].flatMap((dx) => [0, 1].map((dy) => `${HIVE_CORE.x + dx},${HIVE_CORE.y + dy}`));
    const nearDoor = (c: Cell) => doors.some((d) => Math.abs(d.cell.x - c.x) <= 1 && Math.abs(d.cell.y - c.y) <= 1);
    const ringDistance = (c: Cell) => Math.max(Math.abs(c.x - (HIVE_CORE.x + 0.5)), Math.abs(c.y - (HIVE_CORE.y + 0.5)));
    summonPoints.push(
      ...reachableCells(tiles, doors).filter(
        (c) => !core.includes(`${c.x},${c.y}`) && !nearDoor(c) && ringDistance(c) >= 2 && ringDistance(c) <= 3,
      ),
    );
  }
  return { id: spec.id, width, height, tiles, doors, enemies, pickups: [], summonPoints };
}

/** Pickup odds; all numbers are placeholders for playtest tuning. */
export const PICKUPS = {
  roomChance: 0.45,
  weights: { heart: 30, key: 25, bomb: 15, chest: 18, lockedChest: 12 } as Record<'heart' | 'key' | 'bomb' | 'chest' | 'lockedChest', number>,
  chestContents: { min: 1, max: 3 },
  lockedChestContents: { min: 2, max: 3 },
  lockedChestPassiveChance: 0.35,
};

/** Chance a normal room with enemies makes one of them a champion; a placeholder for playtest tuning. */
export const CHAMPION_CHANCE = 0.15;

function crownChampion(enemies: EnemySpawn[], rng: Rng): EnemySpawn[] {
  if (!enemies.length || rng.next() >= CHAMPION_CHANCE) return enemies;
  const index = rng.int(0, enemies.length - 1);
  const { cell: _, ...drop } = rollPickup(enemies[index].cell, rng);
  return enemies.map((e, i) => (i === index ? { ...e, champion: { drop } } : e));
}

function weighted<K extends string>(weights: Record<K, number>, rng: Rng): K {
  const entries = Object.entries(weights) as [K, number][];
  let roll = rng.next() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** The pickup a normal room may reveal once cleared, on the free reachable cell nearest the room's middle. */
function rollClearDrop(tiles: Tile[][], doors: Door[], enemies: EnemySpawn[], placed: PickupSpawn[], rng: Rng): PickupSpawn[] {
  if (rng.next() >= PICKUPS.roomChance) return [];
  const taken = new Set([...enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])]), ...placed.map((p) => p.cell)].map((c) => `${c.x},${c.y}`));
  const centre = { x: (tiles[0].length - 1) / 2, y: (tiles.length - 1) / 2 };
  const spot = reachableCells(tiles, doors)
    .filter((c) => !taken.has(`${c.x},${c.y}`))
    .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];
  return spot ? [rollPickup(spot, rng)] : [];
}

function rollPickup(cell: Cell, rng: Rng): PickupSpawn {
  const type = weighted(PICKUPS.weights, rng);
  if (type === 'heart' || type === 'key' || type === 'bomb') return { type, cell };
  return { type, cell, contents: rollChestContents(type, rng) };
}

function rollChestContents(type: 'chest' | 'lockedChest', rng: Rng): ChestItem[] {
  if (type === 'lockedChest' && rng.next() < PICKUPS.lockedChestPassiveChance) {
    return [{ type: 'passive', passive: rng.pick(PASSIVE_POOL) }];
  }
  const range = type === 'chest' ? PICKUPS.chestContents : PICKUPS.lockedChestContents;
  return Array.from({ length: rng.int(range.min, range.max) }, () => ({ type: rng.pick(['heart', 'key', 'bomb'] as const) }));
}

/** Loot an idea placed: shown from the start, with any chest filled here. */
const placeLoot = (p: PickupSpawn, rng: Rng): PickupSpawn => ({
  ...p,
  visible: true,
  ...((p.type === 'chest' || p.type === 'lockedChest') && !p.contents ? { contents: rollChestContents(p.type, rng) } : {}),
});

export const WORM_LENGTH = 4;
export const WORM_BOSS_LENGTH = 8;

/** Random walk of `length` cells from `head` through `pool`, removing them from it; undefined if it gets stuck. */
function growTail(head: Cell, pool: Cell[], length: number, rng: Rng): Cell[] | undefined {
  const tail: Cell[] = [];
  let at = head;
  for (let i = 0; i < length; i++) {
    const options = pool.filter((c) => Math.abs(c.x - at.x) + Math.abs(c.y - at.y) === 1);
    if (!options.length) {
      pool.push(...tail);
      return undefined;
    }
    at = rng.pick(options);
    pool.splice(pool.indexOf(at), 1);
    tail.push(at);
  }
  return tail;
}

/** Walkable cells connected to the doors, in row-major order. */
function reachableCells(tiles: Tile[][], doors: Door[]): Cell[] {
  const seen = floodFill(tiles, roomOrigin(tiles, doors), isWalkable);
  const cells: Cell[] = [];
  tiles.forEach((row, y) => row.forEach((_, x) => seen.has(`${x},${y}`) && cells.push({ x, y })));
  return cells;
}
