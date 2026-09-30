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

/** Every enemy by the name the arena, the URL and the dev console's `spawn` know it by. */
export const ENEMY_TYPES = Object.keys(ENEMY_NAMES) as EnemyType[];

export interface ArenaSpawn {
  type: EnemyType;
  count: number;
  /** A slime's size. */
  tier?: SlimeTier;
}

/** Params that belong to other playtest shortcuts (`?seed`, `?boss`, `?room=`), never enemy names. */
const RESERVED = new Set(['seed', 'boss', 'room']);
export const SLIME_TIERS: readonly SlimeTier[] = ['big', 'medium', 'small'];

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
  const tier = SLIME_TIERS.find((t) => t === first);
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

const key = (c: Cell) => `${c.x},${c.y}`;

/**
 * The arena, as a room of its own at map cell `at`, outside the generated floors (doorless, in
 * the first floor's look), with the request's enemies on free floor across from the player,
 * spread so they don't stack. Enemies that don't fit are left out.
 */
export function arenaRoom(request: ArenaRequest, at: Cell): { room: WorldRoom; player: Cell } {
  const tiles = ARENA_MAP.map((row) => [...row].map((ch) => ARENA_TILES[ch]));
  const player = { x: ARENA_MAP[3].indexOf('P'), y: 3 };
  const { spawns } = placeSpawns(request, { tiles, player, allowed: (c) => c.x >= ENEMY_SIDE_X });
  return {
    room: {
      floorIndex: 0,
      floorRoom: { id: ARENA_ID, kind: 'normal', cell: at, cells: [at], shape: '1x1' },
      layout: { id: ARENA_ID, width: ROOM_WIDTH, height: ROOM_HEIGHT, tiles, doors: [], enemies: spawns, pickups: [] },
      neighbors: [],
    },
    player,
  };
}

/** Enemies start at least this many tiles from the player. */
export const SPAWN_DISTANCE = 3;

/** Where enemies may be placed: a room's tiles, the player's tile, and any further limit on the cells. */
export interface SpawnGround {
  tiles: Tile[][];
  player: Cell;
  allowed?: (c: Cell) => boolean;
}

/**
 * The request's enemies placed on free floor at least `SPAWN_DISTANCE` from the player (the
 * test arena's and the dev console's `spawn`): singles spread apart, worms coiled over free
 * cells from the far side in, and bosses that stand in one spot given a clearing round them.
 * `missed` counts what didn't fit.
 */
export function placeSpawns(request: Pick<ArenaRequest, 'spawns' | 'champion'>, ground: SpawnGround): { spawns: EnemySpawn[]; missed: ArenaSpawn[] } {
  const { tiles, player, allowed = () => true } = ground;
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const taken = new Set<string>();
  const open = (c: Cell) =>
    tiles[c.y]?.[c.x] === 'floor' && allowed(c) && Math.hypot(c.x - player.x, c.y - player.y) >= SPAWN_DISTANCE;
  const free = (c: Cell) => open(c) && !taken.has(key(c));
  const take = (...cells: Cell[]) => cells.forEach((c) => taken.add(key(c)));
  // A drop of its own for each champion: the scene tells loot carriers apart by their drop.
  const champion = () => (request.champion ? { champion: { drop: { type: 'heart' as const } } } : {});
  const standable: Cell[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (open({ x, y })) standable.push({ x, y });
  // Worms coil up and down the columns from the wall far from the player in, each cell next to the one before.
  const fromLeft = [...Array(width).keys()];
  const columns = player.x < width / 2 ? fromLeft.reverse() : fromLeft;
  const coil = columns.flatMap((x, i) => {
    const column = [...Array(height).keys()].map((y) => ({ x, y }));
    return i % 2 ? column.reverse() : column;
  });
  const coiled = (length: number): Cell[] | undefined => {
    for (let i = 0; i + length <= coil.length; i++) {
      const run = coil.slice(i, i + length);
      if (run.every(free)) return run;
    }
    return undefined;
  };
  // Singles take every other cell first, nearest the middle of the ground they may stand on, so a crowd starts apart.
  const middle = {
    x: standable.reduce((sum, c) => sum + c.x, 0) / (standable.length || 1),
    y: standable.reduce((sum, c) => sum + c.y, 0) / (standable.length || 1),
  };
  const fromMiddle = (c: Cell) => Math.hypot(c.x - middle.x, c.y - middle.y);
  const spread = [...standable].sort((a, b) => Number(a.x % 2 || a.y % 2) - Number(b.x % 2 || b.y % 2) || fromMiddle(a) - fromMiddle(b));
  const single = () => spread.find(free);
  const clearingAround = (c: Cell) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: c.x + dx, y: c.y + dy })));
  const clearing = () => [...standable].sort((a, b) => fromMiddle(a) - fromMiddle(b)).find((c) => clearingAround(c).every(free));

  const spawns: EnemySpawn[] = [];
  const missed: ArenaSpawn[] = [];
  // Many-cell and fixed-spot enemies first, while there is room for them.
  const order = (s: ArenaSpawn) => (s.type === 'wormBoss' || s.type === 'treantBoss' ? 0 : s.type === 'worm' ? 1 : 2);
  for (const s of [...request.spawns].sort((a, b) => order(a) - order(b))) {
    let placed = 0;
    for (; placed < s.count; placed++) {
      if (s.type === 'wormBoss' || s.type === 'worm') {
        const body = coiled(s.type === 'wormBoss' ? WORM_BOSS_LENGTH : WORM_LENGTH);
        if (!body) break;
        take(...body);
        spawns.push({ type: s.type, cell: body[0], tail: body.slice(1), ...(s.type === 'worm' ? champion() : {}) });
        continue;
      }
      if (s.type === 'candleWitch') {
        // She starts in the middle of the room, between her candles, if it's free.
        const middleCell = { x: Math.floor((width - 1) / 2), y: Math.floor((height - 1) / 2) };
        const cell = free(middleCell) ? middleCell : single();
        if (!cell) break;
        take(cell);
        spawns.push({ type: s.type, cell, anchors: candleCells(width, height) });
        continue;
      }
      if (s.type === 'treantBoss' || s.type === 'ironMaiden') {
        const centre = clearing();
        const cell = centre ?? single();
        if (!cell) break;
        take(...(centre ? clearingAround(centre) : [cell]));
        spawns.push({ type: s.type, cell });
        continue;
      }
      const cell = single();
      if (!cell) break;
      take(cell);
      spawns.push({ type: s.type, cell, ...champion(), ...(s.tier ? { slimeTier: s.tier } : {}) });
    }
    if (placed < s.count) missed.push({ ...s, count: s.count - placed });
  }
  return { spawns, missed };
}
