import type { Rng } from './rng';

/** A room's own sense of place within its floor: a marsh or a crypt, not just "the forest". */
export interface RoomTheme {
  id: string;
  name: string;
  /** The only floor this sub-theme appears on. */
  floor: number;
}

const ROOM_THEMES: readonly RoomTheme[] = [
  { id: 'grove', name: 'grove', floor: 0 },
  { id: 'marsh', name: 'marsh', floor: 0 },
  { id: 'bramble', name: 'bramble thicket', floor: 0 },
  { id: 'grotto', name: 'crystal grotto', floor: 1 },
  { id: 'hollow', name: 'mushroom hollow', floor: 1 },
  { id: 'rift', name: 'rift', floor: 1 },
  { id: 'crypt', name: 'crypt', floor: 2 },
  { id: 'cellblock', name: 'cellblock', floor: 2 },
  { id: 'machineHall', name: 'machine hall', floor: 2 },
];

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
