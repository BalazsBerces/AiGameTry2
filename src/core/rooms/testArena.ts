import { candleCells } from '../bosses/candleWitch';
import type { SlimeTier } from '../enemies/slime';
import type { Cell } from '../map/floorGenerator';
import type { WorldRoom } from '../map/world';
import { ROOM_HEIGHT, ROOM_WIDTH, WORM_BOSS_LENGTH, WORM_LENGTH, type EnemySpawn, type EnemyType, type Tile } from './roomGenerator';

/**
 * The enemy test arena (playtesting): naming enemies in the URL drops the player into a hand-made
 * room with just them in it. `?zombie` spawns one, `?zombie=3` three, `?zombie&bat` one of each.
 */

/** Every enemy the arena can spawn, by its enemy-type id. */
const ENEMY_NAMES: Record<EnemyType, true> = {
  zombie: true,
  turret: true,
  worm: true,
  wormBoss: true,
  ironMaiden: true,
  candleWitch: true,
  treantBoss: true,
  goblin: true,
  seedSpitter: true,
  ghoul: true,
  crystalTurret: true,
  gargoyle: true,
  knight: true,
  wasp: true,
  boar: true,
  ghost: true,
  bat: true,
  slime: true,
};

const isEnemyType = (name: string): name is EnemyType => Object.hasOwn(ENEMY_NAMES, name);

export interface ArenaSpawn {
  type: EnemyType;
  count: number;
  /** A slime's size. */
  tier?: SlimeTier;
}

/** Params that belong to other playtest shortcuts (`?seed`, `?boss`, `?room=`), never enemy names. */
const RESERVED = new Set(['seed', 'boss', 'room']);
const TIERS: readonly SlimeTier[] = ['big', 'medium', 'small'];

export interface ArenaRequest {
  spawns: ArenaSpawn[];
  champion: boolean;
  /** Names in the URL that are no enemy, for the scene to warn about. */
  unknown: string[];
}

/** `=N` asks for N; anything else (a bare name) for one. */
function countOf(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** A slime's `size`, `size:N` or `N` (big if no size is given). */
function slimeSpawn(value: string): ArenaSpawn {
  const [first, second] = value.split(':');
  const tier = TIERS.find((t) => t === first);
  return { type: 'slime', count: countOf(tier ? (second ?? '') : first), tier: tier ?? 'big' };
}

/**
 * What the query string asks the arena for: `champion` crowns every spawn, `slime` takes a size
 * (`?slime=small:3`). Names that are no enemy are reported, not spawned. Nothing when the query
 * names nothing but other shortcuts (a normal run).
 */
export function parseArenaQuery(query: string): ArenaRequest | undefined {
  const request: ArenaRequest = { spawns: [], champion: false, unknown: [] };
  for (const [name, value] of new URLSearchParams(query)) {
    if (RESERVED.has(name)) continue;
    if (name === 'champion') request.champion = true;
    else if (name === 'slime') request.spawns.push(slimeSpawn(value));
    else if (isEnemyType(name)) request.spawns.push({ type: name, count: countOf(value) });
    else request.unknown.push(name);
  }
  return request.spawns.length || request.unknown.length ? request : undefined;
}

export const ARENA_ID = 'arena';

/**
 * The arena, one normal room's size: `O` a stone pillar cluster, `R` a scattered line of rocks,
 * `H` a small pit, `T` a thorn patch, `P` where the player starts. The right side is kept open
 * for the enemies (a Treant's clearing, a worm boss's coils).
 */
const ARENA_MAP = [
  '......R......',
  '...OO........',
  '...OO.R......',
  '.P...........',
  '......R......',
  '..HH...TT....',
  '..HH..RTT....',
];
const ARENA_TILES: Record<string, Tile> = { '.': 'floor', P: 'floor', O: 'obstacle', R: 'rock', H: 'hole', T: 'thorn' };
/** Enemies start at or right of this column. */
const ENEMY_SIDE_X = 8;
/** Where a boss that stands in one spot starts (the Treant needs open ground all round it). */
const BOSS_CELL = { x: 11, y: 3 };

const key = (c: Cell) => `${c.x},${c.y}`;

/**
 * The arena as a room of its own at map cell `at`, outside the generated floors (doorless, in
 * the first floor's look), with the request's enemies on free floor across from the player,
 * spread so they don't stack. Enemies that don't fit are left out.
 */
export function arenaRoom(request: ArenaRequest, at: Cell): { room: WorldRoom; player: Cell } {
  const tiles = ARENA_MAP.map((row) => [...row].map((ch) => ARENA_TILES[ch]));
  const player = { x: ARENA_MAP[3].indexOf('P'), y: 3 };
  return {
    room: {
      floorIndex: 0,
      floorRoom: { id: ARENA_ID, kind: 'normal', cell: at, cells: [at], shape: '1x1' },
      layout: { id: ARENA_ID, width: ROOM_WIDTH, height: ROOM_HEIGHT, tiles, doors: [], enemies: placeEnemies(request, tiles), pickups: [] },
      neighbors: [],
    },
    player,
  };
}

function placeEnemies(request: ArenaRequest, tiles: Tile[][]): EnemySpawn[] {
  const taken = new Set<string>();
  const free = (c: Cell) => tiles[c.y]?.[c.x] === 'floor' && !taken.has(key(c));
  const take = (...cells: Cell[]) => cells.forEach((c) => taken.add(key(c)));
  const champion = request.champion ? { champion: { drop: { type: 'heart' as const } } } : {};
  const enemySide: Cell[] = [];
  for (let y = 0; y < ROOM_HEIGHT; y++) for (let x = ENEMY_SIDE_X; x < ROOM_WIDTH; x++) if (tiles[y][x] === 'floor') enemySide.push({ x, y });
  // Worms coil up and down the columns from the far wall in, each cell next to the one before.
  const coil = [...Array(ROOM_WIDTH - ENEMY_SIDE_X).keys()].flatMap((i) => {
    const column = [...Array(ROOM_HEIGHT).keys()].map((y) => ({ x: ROOM_WIDTH - 1 - i, y }));
    return i % 2 ? column.reverse() : column;
  });
  const coiled = (length: number): Cell[] | undefined => {
    for (let i = 0; i + length <= coil.length; i++) {
      const run = coil.slice(i, i + length);
      if (run.every(free)) return run;
    }
    return undefined;
  };
  // Singles take every other cell first, nearest the middle of their side, so a crowd starts apart.
  const middle = { x: (ENEMY_SIDE_X + ROOM_WIDTH - 1) / 2, y: (ROOM_HEIGHT - 1) / 2 };
  const spread = [...enemySide].sort(
    (a, b) =>
      Number(a.x % 2 || a.y % 2) - Number(b.x % 2 || b.y % 2) ||
      Math.hypot(a.x - middle.x, a.y - middle.y) - Math.hypot(b.x - middle.x, b.y - middle.y),
  );
  const single = () => spread.find(free);

  const spawns: EnemySpawn[] = [];
  // Many-cell and fixed-spot enemies first, while there is room for them.
  const order = (s: ArenaSpawn) => (s.type === 'wormBoss' || s.type === 'treantBoss' ? 0 : s.type === 'worm' ? 1 : 2);
  for (const s of [...request.spawns].sort((a, b) => order(a) - order(b))) {
    for (let n = 0; n < s.count; n++) {
      if (s.type === 'wormBoss' || s.type === 'worm') {
        const body = coiled(s.type === 'wormBoss' ? WORM_BOSS_LENGTH : WORM_LENGTH);
        if (!body) break;
        take(...body);
        spawns.push({ type: s.type, cell: body[0], tail: body.slice(1), ...(s.type === 'worm' ? champion : {}) });
        continue;
      }
      if (s.type === 'candleWitch') {
        const cell = { x: Math.floor((ROOM_WIDTH - 1) / 2), y: Math.floor((ROOM_HEIGHT - 1) / 2) };
        spawns.push({ type: s.type, cell, anchors: candleCells(ROOM_WIDTH, ROOM_HEIGHT) });
        take(cell);
        continue;
      }
      if (s.type === 'treantBoss' || s.type === 'ironMaiden') {
        const clearing = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: BOSS_CELL.x + dx, y: BOSS_CELL.y + dy })));
        const cell = clearing.every(free) ? BOSS_CELL : single();
        if (!cell) break;
        take(...(cell === BOSS_CELL ? clearing : [cell]));
        spawns.push({ type: s.type, cell });
        continue;
      }
      const cell = single();
      if (!cell) break;
      take(cell);
      spawns.push({ type: s.type, cell, ...champion, ...(s.tier ? { slimeTier: s.tier } : {}) });
    }
  }
  return spawns;
}
