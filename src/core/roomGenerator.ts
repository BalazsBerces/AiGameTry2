import { archetypeById, archetypesFor, fallbackArchetype, supportsShape } from './archetypes';
import { missingCell, SHAPE_CELLS, type Cell, type Direction, type RoomKind, type RoomShape } from './floorGenerator';
import { floodFill } from './grid';
import { validateRoom, type Symmetry } from './roomValidator';
import type { Passive } from './weaponModel';
import type { Rng } from './rng';
import { themeForFloor } from './themes';
import { isWalkable } from './tiles';
import type { Crusher } from './crusher';
import { candleCells } from './candleWitch';
import { composeRoom, composes, type Spot } from './composer';
import { addFiller } from './filler';
import { dressRoom, type Decor, type Region } from './dressing';
import { roomThemesFor } from './roomThemes';

export const ROOM_WIDTH = 13;
export const ROOM_HEIGHT = 7;
export const BOSS_WIDTH = 26;
export const BOSS_HEIGHT = 14;
/** Tiles per map cell: a 13x7 room interior plus its one-tile wall ring. */
export const CELL_TILES = { w: ROOM_WIDTH + 2, h: ROOM_HEIGHT + 2 };

/**
 * `obstacle` is stone; `rock` is the same but breaks after a few player shots; `thorn` is a
 * bush that hurts whoever walks into it; `crusher` is a block that slides when it sees the
 * player; `crystal` bounces every shot. `wall` is not part of the room at all: it fills the
 * missing cell of an L room's box, is drawn as room wall and nothing ever enters it. Behaviour
 * lives in `TILES`.
 */
export type Tile = 'floor' | 'obstacle' | 'rock' | 'hole' | 'thorn' | 'crusher' | 'crystal' | 'wall' | 'glowshroom';

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
  /** Map cells the room spans; a single cell if left out (the boss room is always 2x2). */
  shape?: RoomShape;
  /** The room's floor sub-theme (core/roomThemes); a composed big room is built to suit it. */
  theme?: string;
}

/** Interior size in tiles: one 13x7 room per map cell, plus the wall rings between cells. */
export const roomSize = (kind: RoomKind, shape: RoomShape = '1x1') => {
  if (kind === 'boss') return { width: BOSS_WIDTH, height: BOSS_HEIGHT };
  const cells = SHAPE_CELLS[shape];
  const cols = Math.max(...cells.map((c) => c.x)) + 1;
  const rows = Math.max(...cells.map((c) => c.y)) + 1;
  return { width: cols * ROOM_WIDTH, height: rows * ROOM_HEIGHT };
};

/** Wall thickness in tiles between the room's map-cell block edge and its interior. */
export function roomPadding(width: number, height: number) {
  const cellsW = Math.ceil(width / ROOM_WIDTH);
  const cellsH = Math.ceil(height / ROOM_HEIGHT);
  return { x: (cellsW * CELL_TILES.w - width) / 2, y: (cellsH * CELL_TILES.h - height) / 2 };
}

/**
 * Interior tiles outside the room: those of an L's missing map cell (its whole 15x9-tile block,
 * clipped to the interior), so the arms meet with the corner between them filled. Never true
 * for full blocks.
 */
export function outsideRoom(shape: RoomShape, width: number, height: number): (c: Cell) => boolean {
  const gap = missingCell(shape);
  if (!gap) return () => false;
  const pad = roomPadding(width, height);
  const x0 = gap.x * CELL_TILES.w - pad.x;
  const y0 = gap.y * CELL_TILES.h - pad.y;
  return (c) => c.x >= x0 && c.x < x0 + CELL_TILES.w && c.y >= y0 && c.y < y0 + CELL_TILES.h;
}

/** Turns every tile outside the room into `wall`, whatever was painted there. */
function wallOff(tiles: Tile[][], shape: RoomShape): Tile[][] {
  const outside = outsideRoom(shape, tiles[0].length, tiles.length);
  tiles.forEach((row, y) => row.forEach((_, x) => outside({ x, y }) && (row[x] = 'wall')));
  return tiles;
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
  /** The idea the room was built from, if any. */
  archetype?: string;
  /** The room's floor sub-theme (core/roomThemes): a 1x1 idea's own, else the one it was built to suit. */
  theme?: string;
  /** A composed big room's layout and encounter (core/composer), in place of an archetype. */
  layout?: string;
  encounter?: string;
  /** Crusher blocks and their axes; each stands on a `crusher` tile, which moves with it. */
  crushers?: Crusher[];
  /** Non-blocking set dressing on the floor, laid when the room was built (core/dressing). */
  decor?: Decor[];
  /** variants[y][x]: which look of its kind each tile takes in the art pass; stable for the seed. */
  variants?: number[][];
  /** Connected pits, ponds and chasms as the room was built, for edging shorelines and rims. */
  regions?: Region[];
}

/** Stackable stat-ups a chest can hold instead of one of its items. */
export type StatUpType = 'damageUp' | 'rateUp';

export type PickupType = 'heart' | 'key' | 'bomb' | 'chest' | 'lockedChest' | 'passive' | StatUpType;

/** Something a chest releases. */
/** A passive with no `passive` yet is decided when it comes out (core/world). */
export type ChestItem = { type: 'heart' } | { type: 'key' } | { type: 'bomb' } | { type: StatUpType } | { type: 'passive'; passive?: Passive };

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

export const PASSIVE_POOL: readonly Passive[] = [
  'homing',
  'fireRate',
  'sword',
  'triple',
  'pierce',
  'ricochet',
  'spectral',
  'boomerang',
  'poison',
  'chain',
  'freeze',
  'orbital',
  'dash',
];

export type EnemyType =
  | 'zombie'
  | 'turret'
  | 'worm'
  | 'wormBoss'
  | 'ironMaiden'
  | 'candleWitch'
  | 'treantBoss'
  | 'goblin'
  | 'seedSpitter'
  | 'ghoul'
  | 'crystalTurret'
  | 'gargoyle'
  | 'knight'
  | 'wasp'
  | 'boar'
  | 'ghost'
  | 'bat';

export interface EnemySpawn {
  type: EnemyType;
  /** The enemy's cell; for a worm, its head. */
  cell: Cell;
  /** A worm's body behind the head, in order. */
  tail?: Cell[];
  /** Fixed cells the enemy works from: the Candle Witch's candles. */
  anchors?: Cell[];
  /** Tougher and always drops `drop` (from the normal room-clear pool) when killed. */
  champion?: { drop: ChampionDrop };
  /** Hit points overriding the type's default: a floor's tougher variant (the dungeon's zombies). */
  hp?: number;
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
 * no dead ends. Passages are two tiles wide, leaving the worm room to turn. The walls are
 * breakable rock: the player can shoot or bomb a way out, and the worm smashes any in the lane
 * it bursts out along.
 */
function placeLabyrinth(tiles: Tile[][], rng: Rng, keepClear: (c: Cell) => boolean) {
  const { cols, rows } = LABYRINTH;
  const origin = (i: number, j: number) => ({ x: 3 * i, y: 3 * j });
  const block = (c: Cell) => {
    if (!keepClear(c)) tiles[c.y][c.x] = 'rock';
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

export type BossType = 'wormBoss' | 'ironMaiden' | 'candleWitch' | 'treantBoss';

/** The floor's boss, from its theme's pool; `rng` should be the run's, so a seed always meets the same boss. */
export const bossForFloor = (floorIndex: number, rng: Rng): BossType => rng.pick(themeForFloor(floorIndex).bosses);

const BOSS_ARENAS: Record<BossType, TerrainStrategy> = {
  wormBoss: placeLabyrinth,
  ironMaiden: placePillars,
  // The witch's crypt stays open: her candles and their patterns fill it.
  candleWitch: () => {},
  treantBoss: placeCaveMouth,
};

/**
 * Iron Maiden arena: randomly scattered dungeon pillars on a loose lattice, cover from its
 * volleys and stomp rings that the player has to keep moving between.
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

/** Treant arena rock: how deep the jagged rim reaches in from each wall, and how many loose boulders. */
const CAVE_MOUTH = { maxDepth: 3, boulders: { min: 2, max: 4 } };

/**
 * Treant arena, a clearing at the mouth of the cave: a jagged rim of rock grows in from every
 * wall (kept off the doorways), with a few boulders near the edges. The middle stays open, so
 * root lines can be read and dodged sideways.
 */
function placeCaveMouth(tiles: Tile[][], rng: Rng, keepClear: (c: Cell) => boolean) {
  const height = tiles.length;
  const width = tiles[0].length;
  const { maxDepth } = CAVE_MOUTH;
  const nearDoor = (c: Cell) =>
    [-2, -1, 0, 1, 2].some((dx) => [-2, -1, 0, 1, 2].some((dy) => keepClear({ x: c.x + dx, y: c.y + dy })));
  const block = (c: Cell) => {
    if (!nearDoor(c)) tiles[c.y][c.x] = 'obstacle';
  };
  /** A random walk of rim depths, one per cell along a wall. */
  const rim = (length: number) => {
    let depth = rng.int(0, maxDepth);
    return Array.from({ length }, () => (depth = Math.min(maxDepth, Math.max(0, depth + rng.int(-1, 1)))));
  };
  rim(width).forEach((d, x) => { for (let y = 0; y < d; y++) block({ x, y }); });
  rim(width).forEach((d, x) => { for (let y = 0; y < d; y++) block({ x, y: height - 1 - y }); });
  rim(height).forEach((d, y) => { for (let x = 0; x < d; x++) block({ x, y }); });
  rim(height).forEach((d, y) => { for (let x = 0; x < d; x++) block({ x: width - 1 - x, y }); });
  // Boulders sit in the band between the rim and the open middle.
  const boulders = rng.int(CAVE_MOUTH.boulders.min, CAVE_MOUTH.boulders.max);
  for (let i = 0; i < boulders; i++) {
    const x = rng.next() < 0.5 ? rng.int(3, 5) : rng.int(width - 6, width - 4);
    const y = rng.int(2, height - 3);
    block({ x, y });
    if (rng.next() < 0.5) block({ x, y: y + 1 });
  }
}

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
  const shape = spec.shape ?? '1x1';
  const { width, height } = roomSize(spec.kind, shape);
  const sides = doors.map((d) => d.side);
  const fitting = archetypesFor(floorIndex, spec.kind, shape).filter((a) => a.fits(sides));
  const named = spec.archetype ? archetypeById(spec.archetype) : undefined;
  const assigned = named && supportsShape(named, shape) && named.fits(sides) ? named : undefined;
  const fallback = fallbackArchetype(floorIndex, spec.kind, shape);
  const chosen = assigned ?? (fitting.length ? rng.pick(fitting) : fallback);
  for (const archetype of [chosen, fallback]) {
    for (let attempt = 0; attempt < MAX_ARCHETYPE_ATTEMPTS; attempt++) {
      const drawn = archetype.build({ width, height, doors, rng, shape });
      const built = { ...drawn, tiles: wallOff(drawn.tiles, shape) };
      if (validateRoom({ ...built, doors }, built.symmetry).length === 0) return { ...built, archetype: archetype.id };
    }
  }
  const tiles = wallOff(emptyTiles(width, height), shape);
  return { tiles, enemies: [] as EnemySpawn[], pickups: [] as PickupSpawn[], archetype: fallback.id };
}

/** A big room composed from a layout and an encounter to suit its theme; left empty (always valid) if none will do. */
function buildComposed(spec: RoomSpec, doors: Door[], floorIndex: number, rng: Rng) {
  const shape = spec.shape ?? '1x1';
  const theme = spec.theme ?? roomThemesFor(floorIndex)[0].id;
  const composed = composeRoom({ shape, doors, theme, floorIndex, rng });
  if (composed) return { ...composed, parts: { layout: composed.layout, encounter: composed.encounter } };
  const { width, height } = roomSize(spec.kind, shape);
  return { tiles: wallOff(emptyTiles(width, height), shape), enemies: [] as EnemySpawn[], pickups: [] as PickupSpawn[], parts: {} };
}

/** Where the doors of a `width` x `height` room open; a bare side is a door in its top-left cell. */
export const placeDoors = (specs: readonly (Direction | DoorSpec)[], width: number, height: number): Door[] =>
  specs
    .map((d): DoorSpec => (typeof d === 'string' ? { side: d, at: { x: 0, y: 0 } } : d))
    .map((d) => ({ side: d.side, cell: doorCell(d, width, height) }));

/**
 * A normal room's tiles with its theme's edge filler added (core/filler), kept off a composed
 * room's spawn spots. Rooms without a theme, and the empty fallback, stay as built.
 */
function dress(
  spec: RoomSpec,
  built: { tiles: Tile[][]; enemies: EnemySpawn[]; pickups: PickupSpawn[]; symmetry?: Symmetry; spots?: Spot[]; crushers?: Crusher[] },
  doors: Door[],
  rng: Rng,
): Tile[][] {
  const theme = themed(spec, built).theme;
  if (spec.kind !== 'normal' || !spec.theme || !theme || !built.symmetry) return built.tiles;
  const { tiles, enemies, pickups, crushers } = built;
  return addFiller({
    room: { tiles, doors, enemies, pickups, ...(crushers ? { crushers } : {}) },
    symmetry: built.symmetry,
    protect: (built.spots ?? []).map((s) => s.cell),
    theme,
    size: (spec.shape ?? '1x1') === '1x1' ? 'small' : 'big',
    rng,
  }).tiles;
}

/** The room's sub-theme: a 1x1 idea's own tag, else the one it was asked to suit. */
function themed(spec: RoomSpec, built?: object): { theme?: string } {
  const archetype = built && 'archetype' in built ? String(built.archetype) : '';
  const theme = archetypeById(archetype)?.theme ?? spec.theme;
  return theme ? { theme } : {};
}

/** Builds the room, then dresses it for the art pass (core/dressing) on its own stream, never touching its tiles. */
export function generateRoom(spec: RoomSpec, floorIndex: number, rng: Rng): RoomLayout {
  const layout = buildRoom(spec, floorIndex, rng);
  if (!layout.theme) return layout;
  return { ...layout, ...dressRoom({ tiles: layout.tiles, theme: layout.theme, rng: rng.fork('dressing') }) };
}

function buildRoom(spec: RoomSpec, floorIndex: number, rng: Rng): RoomLayout {
  const { width, height } = roomSize(spec.kind, spec.shape);
  const doors = placeDoors(spec.doors, width, height);
  const composed = spec.kind === 'normal' && composes(spec.shape ?? '1x1');
  if (composed || archetypesFor(floorIndex, spec.kind, spec.shape ?? '1x1').length) {
    const drawn = composed ? buildComposed(spec, doors, floorIndex, rng) : buildFromArchetype(spec, doors, floorIndex, rng);
    // Its own stream, so dressing a room never shifts its layout or fight.
    const built = { ...drawn, tiles: dress(spec, drawn, doors, rng.fork('filler')) };
    const pickups = built.pickups.map((p) => placeLoot(p, rng));
    if (spec.kind === 'normal') pickups.push(...rollClearDrop(built.tiles, doors, built.enemies, pickups, rng));
    const { walker, walkerHp } = themeForFloor(floorIndex);
    const floorEnemies = built.enemies.map((e) => (walkerHp && e.type === walker ? { ...e, hp: walkerHp } : e));
    // Its own stream, so champion rolls never shift the room's layout.
    const enemies = spec.kind === 'normal' ? crownChampion(floorEnemies, rng.fork('champion')) : floorEnemies;
    const { crushers } = built as { crushers?: Crusher[] };
    const origin = 'parts' in built ? built.parts : { archetype: built.archetype };
    return { id: spec.id, width, height, tiles: built.tiles, doors, enemies, pickups, ...origin, ...themed(spec, built), ...(crushers ? { crushers } : {}) };
  }
  // Normal and item rooms come from archetypes above; boss arenas are built here, start rooms stay empty.
  const isDoor = (c: Cell) => doors.some((d) => d.cell.x === c.x && d.cell.y === c.y);
  let tiles = wallOff(emptyTiles(width, height), spec.shape ?? '1x1');
  // Its own stream, so which boss it is never shifts the arena's layout.
  const boss = spec.kind === 'boss' ? bossForFloor(floorIndex, rng.fork('boss')) : undefined;
  const terrain = boss ? BOSS_ARENAS[boss] : undefined;
  for (let attempt = 0; terrain && attempt < MAX_TERRAIN_ATTEMPTS; attempt++) {
    const candidate = emptyTiles(width, height);
    terrain(candidate, rng, isDoor);
    if (isConnected(candidate, doors)) {
      tiles = candidate;
      break;
    }
  }
  const enemies: EnemySpawn[] = [];
  if (boss === 'wormBoss') {
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
  if (boss === 'ironMaiden') {
    // It starts across the room from the entrance and walks at the player from there.
    const entrance = doors[0]?.cell ?? { x: 0, y: 0 };
    const opposite = { x: width - 1 - entrance.x, y: height - 1 - entrance.y };
    const cell = reachableCells(tiles, doors).sort(
      (a, b) => Math.hypot(a.x - opposite.x, a.y - opposite.y) - Math.hypot(b.x - opposite.x, b.y - opposite.y),
    )[0];
    enemies.push({ type: 'ironMaiden', cell });
  }
  if (boss === 'candleWitch') {
    const middle = { x: Math.floor((width - 1) / 2), y: Math.floor((height - 1) / 2) };
    enemies.push({ type: 'candleWitch', cell: middle, anchors: candleCells(width, height) });
  }
  if (boss === 'treantBoss') {
    // The Treant roots itself across the clearing from the entrance, on open ground it can fill.
    const entrance = doors[0]?.cell ?? { x: 0, y: 0 };
    const centre = { x: (width - 1) / 2, y: (height - 1) / 2 };
    const target = { x: centre.x + (centre.x - entrance.x) * 0.65, y: centre.y + (centre.y - entrance.y) * 0.65 };
    const open = (c: Cell) => [-1, 0, 1].every((dx) => [-1, 0, 1].every((dy) => tiles[c.y + dy]?.[c.x + dx] === 'floor'));
    const farFromDoors = (c: Cell) => doors.every((d) => Math.abs(d.cell.x - c.x) + Math.abs(d.cell.y - c.y) > 3);
    const cell = reachableCells(tiles, doors)
      .filter((c) => open(c) && farFromDoors(c))
      .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
    if (cell) enemies.push({ type: 'treantBoss', cell });
  }
  return { id: spec.id, width, height, tiles, doors, enemies, pickups: [], ...themed(spec) };
}

/** Pickup odds; all numbers are placeholders for playtest tuning. */
export const PICKUPS = {
  roomChance: 0.45,
  weights: { heart: 30, key: 25, bomb: 15, chest: 18, lockedChest: 12 } as Record<'heart' | 'key' | 'bomb' | 'chest' | 'lockedChest', number>,
  chestContents: { min: 1, max: 3 },
  lockedChestContents: { min: 2, max: 3 },
  lockedChestPassiveChance: 0.35,
  /** Chance one of a chest's items is swapped for a stat-up (locked: only when it holds no passive). */
  statUpChance: { chest: 0.3, lockedChest: 0.65 },
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
  // Which passive is decided when the chest is opened (core/world), against what the player owns by then.
  if (type === 'lockedChest' && rng.next() < PICKUPS.lockedChestPassiveChance) return [{ type: 'passive' }];
  const range = type === 'chest' ? PICKUPS.chestContents : PICKUPS.lockedChestContents;
  const items: ChestItem[] = Array.from({ length: rng.int(range.min, range.max) }, () => ({ type: rng.pick(['heart', 'key', 'bomb'] as const) }));
  if (rng.next() < PICKUPS.statUpChance[type]) items[rng.int(0, items.length - 1)] = { type: rng.pick(['damageUp', 'rateUp'] as const) };
  return items;
}

/** Loot an idea placed: shown from the start, with any chest filled here. */
const placeLoot = (p: PickupSpawn, rng: Rng): PickupSpawn => ({
  ...p,
  visible: true,
  ...((p.type === 'chest' || p.type === 'lockedChest') && !p.contents ? { contents: rollChestContents(p.type, rng) } : {}),
});

export const WORM_LENGTH = 4;
export const WORM_BOSS_LENGTH = 20;

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
