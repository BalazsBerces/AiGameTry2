import type { Rng } from '../rng';
import type { Tile } from './roomGenerator';
import { themeForFloor, type TileLook } from '../map/themes';

/**
 * What a composed room's layout paints (core/composer): each sub-theme decides the real tile.
 * `cover` blocks feet and shots, `breakable` can be shot through, `pit` stops feet but not shots,
 * `hazard` is the theme's dangerous ground and `feature` its centrepiece.
 */
export type Role = 'cover' | 'breakable' | 'pit' | 'hazard' | 'feature';

/** A room's own sense of place within its floor: a marsh or a crypt, not just "the forest". */
export interface RoomTheme {
  id: string;
  name: string;
  /** The only floor this sub-theme appears on. */
  floor: number;
  /** The tile each layout role becomes here. Only the bramble thicket's hazard is thorns. */
  roles: Record<Role, Tile>;
  /** How much likelier each encounter (by id) is here than one left out, which counts 1. */
  encounterWeights: Readonly<Record<string, number>>;
  /** Solid, purposeless pieces dressing the room's edges (core/filler): trees and bushes, rubble. Never thorns. */
  filler: readonly Tile[];
  /** Non-blocking floor dressing (core/dressing), each drawn as a faint placeholder mark until the art pass. */
  decor: readonly DecorKind[];
  /** How this sub-theme draws some tile kinds instead of the floor's look: a crypt's stone is an urn. Looks only, never play. */
  looks?: Partial<Record<TerrainTile, LookOverride>>;
}

/** Terrain tiles with a look of their own. */
type TerrainTile = Exclude<Tile, 'floor' | 'wall'>;

/** What a sub-theme may change about a tile's look: its name, colour, outline and shape. */
export type LookOverride = Partial<Pick<TileLook, 'name' | 'color' | 'stroke' | 'shape'>>;

/** A kind of decor and its placeholder: a faint mark in a colour of the theme's. */
export interface DecorKind {
  id: string;
  mark: 'dot' | 'dash' | 'cross' | 'ring';
  color: number;
}

const ROOM_THEMES: readonly RoomTheme[] = [
  {
    id: 'grove', name: 'grove', floor: 0,
    roles: { cover: 'obstacle', breakable: 'rock', pit: 'hole', hazard: 'obstacle', feature: 'obstacle' },
    filler: ['obstacle', 'rock'],
    decor: [{ id: 'flowers', mark: 'dot', color: 0xe8d86a }, { id: 'grass', mark: 'dash', color: 0x7ab04a }, { id: 'leaves', mark: 'cross', color: 0xa0703a }],
    looks: { obstacle: { name: 'oak', color: 0x2a5a24 } },
    encounterWeights: { boarCharge: 4, prowlers: 2 },
  },
  {
    id: 'marsh', name: 'marsh', floor: 0,
    roles: { cover: 'rock', breakable: 'rock', pit: 'hole', hazard: 'hole', feature: 'hole' },
    filler: ['rock', 'obstacle'],
    decor: [{ id: 'puddle', mark: 'ring', color: 0x4f86b8 }, { id: 'reeds', mark: 'dash', color: 0x6a8a3a }, { id: 'lilypad', mark: 'dot', color: 0x5aa05a }],
    looks: { obstacle: { name: 'willow', color: 0x4a7a3a }, rock: { name: 'reed clump', color: 0x8a9a4a }, hole: { name: 'bog', color: 0x3a4a2a, stroke: 0x5a6a3a } },
    encounterWeights: { waspSwarm: 4, ledgeSentries: 2 },
  },
  {
    id: 'bramble', name: 'bramble thicket', floor: 0,
    roles: { cover: 'rock', breakable: 'rock', pit: 'hole', hazard: 'thorn', feature: 'obstacle' },
    filler: ['rock'],
    decor: [{ id: 'thornLitter', mark: 'cross', color: 0x8a4a3a }, { id: 'leaves', mark: 'dot', color: 0x7a5a2a }, { id: 'berries', mark: 'dot', color: 0xc0506a }],
    looks: { rock: { name: 'bramble bush', color: 0x4a6a2a, stroke: 0x8a4a3a } },
    encounterWeights: { ambush: 4, prowlers: 2 },
  },
  {
    id: 'grotto', name: 'crystal grotto', floor: 1,
    roles: { cover: 'obstacle', breakable: 'rock', pit: 'hole', hazard: 'crystal', feature: 'crystal' },
    filler: ['crystal', 'obstacle'],
    decor: [{ id: 'shards', mark: 'cross', color: 0x9fe4f0 }, { id: 'glints', mark: 'dot', color: 0xd8f8ff }, { id: 'pebbles', mark: 'dot', color: 0x8a7458 }],
    looks: { obstacle: { name: 'crystal spire', shape: 'round', color: 0x4a6a74, stroke: 0x7fd4e0 } },
    encounterWeights: { ledgeSentries: 4, siege: 2 },
  },
  {
    id: 'hollow', name: 'mushroom hollow', floor: 1,
    roles: { cover: 'obstacle', breakable: 'rock', pit: 'hole', hazard: 'glowshroom', feature: 'glowshroom' },
    filler: ['obstacle', 'rock'],
    decor: [{ id: 'spores', mark: 'dot', color: 0x9ae0a0 }, { id: 'caps', mark: 'ring', color: 0xd0a060 }, { id: 'moss', mark: 'dash', color: 0x5a8a4a }],
    looks: { obstacle: { name: 'giant mushroom', color: 0xb07a4a, stroke: 0xe0c090 }, rock: { name: 'mushroom cap', color: 0xc08a5a } },
    encounterWeights: { batColony: 4, prowlers: 2 },
  },
  {
    id: 'rift', name: 'rift', floor: 1,
    roles: { cover: 'rock', breakable: 'rock', pit: 'hole', hazard: 'hole', feature: 'obstacle' },
    filler: ['obstacle', 'rock'],
    decor: [{ id: 'cracks', mark: 'dash', color: 0x2a1e14 }, { id: 'pebbles', mark: 'dot', color: 0x8a7458 }, { id: 'dust', mark: 'dot', color: 0xa89070 }],
    looks: { hole: { name: 'rift', color: 0x000000, stroke: 0x6a3a2a } },
    encounterWeights: { wormNest: 4, batColony: 2 },
  },
  {
    id: 'crypt', name: 'crypt', floor: 2,
    roles: { cover: 'obstacle', breakable: 'rock', pit: 'hole', hazard: 'hole', feature: 'obstacle' },
    filler: ['rock', 'obstacle'],
    decor: [{ id: 'bones', mark: 'cross', color: 0xe0dccc }, { id: 'cobweb', mark: 'ring', color: 0xc8c8d8 }, { id: 'cracks', mark: 'dash', color: 0x2a2230 }],
    looks: { obstacle: { name: 'urn', shape: 'round', color: 0x8a6a4a, stroke: 0xc0a070 }, rock: { name: 'broken coffin', color: 0x6a5040 } },
    encounterWeights: { haunting: 4, prowlers: 2 },
  },
  {
    id: 'cellblock', name: 'cellblock', floor: 2,
    roles: { cover: 'obstacle', breakable: 'rock', pit: 'hole', hazard: 'obstacle', feature: 'obstacle' },
    filler: ['obstacle'],
    decor: [{ id: 'straw', mark: 'dash', color: 0xc8a860 }, { id: 'chains', mark: 'ring', color: 0x8a8a94 }, { id: 'bones', mark: 'cross', color: 0xe0dccc }],
    looks: { obstacle: { name: 'iron bars', shape: 'block', color: 0x4a4c54, stroke: 0x9aa0a8 } },
    encounterWeights: { knightPatrol: 4, ledgeSentries: 2 },
  },
  {
    id: 'machineHall', name: 'machine hall', floor: 2,
    roles: { cover: 'obstacle', breakable: 'rock', pit: 'hole', hazard: 'hole', feature: 'obstacle' },
    filler: ['obstacle', 'rock'],
    decor: [{ id: 'oil', mark: 'ring', color: 0x14121a }, { id: 'bolts', mark: 'dot', color: 0x9aa0a8 }, { id: 'cracks', mark: 'dash', color: 0x2a2230 }],
    looks: { obstacle: { name: 'machine', color: 0x5c6068, stroke: 0xc8a040 }, hole: { name: 'grate', color: 0x1a1a20, stroke: 0x5c6068 } },
    encounterWeights: { siege: 4, ambush: 2 },
  },
];

export const roomThemeById = (id: string) => ROOM_THEMES.find((t) => t.id === id);

/** How each tile is drawn in a room of this sub-theme: the floor's looks with the sub-theme's overrides laid over them. */
export function roomLooks(floorIndex: number, themeId: string): Record<TerrainTile, TileLook> {
  const floor = themeForFloor(floorIndex).looks;
  const overrides = roomThemeById(themeId)?.looks ?? {};
  return Object.fromEntries(
    Object.entries(floor).map(([tile, look]) => [tile, { ...look, ...overrides[tile as TerrainTile] }]),
  ) as Record<TerrainTile, TileLook>;
}

/** The floor's sub-themes; floors past the last keep its themes. */
export const roomThemesFor = (floorIndex: number): RoomTheme[] => {
  const last = Math.max(...ROOM_THEMES.map((t) => t.floor));
  const floor = Math.min(Math.max(floorIndex, 0), last);
  return ROOM_THEMES.filter((t) => t.floor === floor);
};

export interface ThemeRoom {
  id: string;
  /** Ids of the rooms it has doors to. */
  neighbors: readonly string[];
  /** A theme the room already has (from the idea it was built from); kept as it is. */
  fixed?: string;
}

/** Chance a room spreading a neighbour's theme picks any of the floor's themes instead. */
export const STRAY_THEME_CHANCE = 0.15;

/**
 * A sub-theme for every room on a floor. Rooms with a fixed theme keep it; each theme none of
 * them has starts in one free room. Then themes spread room by room through the doors (now and
 * then a room strays to any theme), so neighbours tend to share one and every theme is used when
 * there are free rooms enough.
 */
export function assignRoomThemes(rooms: readonly ThemeRoom[], floorIndex: number, rng: Rng): Map<string, string> {
  const ids = roomThemesFor(floorIndex).map((t) => t.id);
  const themes = new Map(rooms.flatMap((r) => (r.fixed ? [[r.id, r.fixed] as const] : [])));
  const unthemed = () => rooms.filter((r) => !themes.has(r.id));
  const used = new Set(themes.values());
  for (const id of ids.filter((t) => !used.has(t))) {
    const free = unthemed();
    if (free.length) themes.set(rng.pick(free).id, id);
  }
  for (let free = unthemed(); free.length; free = unthemed()) {
    const frontier = free.filter((r) => r.neighbors.some((n) => themes.has(n)));
    if (!frontier.length) {
      themes.set(rng.pick(free).id, rng.pick(ids));
      continue;
    }
    const room = rng.pick(frontier);
    const near = room.neighbors.filter((n) => themes.has(n)).map((n) => themes.get(n)!);
    themes.set(room.id, rng.next() < STRAY_THEME_CHANCE ? rng.pick(ids) : rng.pick(near));
  }
  return themes;
}
