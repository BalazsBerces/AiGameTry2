import { ARCHETYPES } from '../rooms/archetypes';
import { ENCOUNTERS, LAYOUTS } from '../rooms/composer';
import { createWorld, type World, type WorldRoom } from './world';

/**
 * Finding rooms to jump to (playtesting): the URL's `?boss` and `?room=` and the console's
 * `boss`, `room` and `restart room` all look rooms up here.
 */

/** Every id a room can be asked for by: archetypes, then composed layouts and encounters. */
export const ROOM_IDS: readonly string[] = [...new Set([...ARCHETYPES, ...LAYOUTS, ...ENCOUNTERS].map((idea) => idea.id))];

/** Whether the room was built from the archetype, layout or encounter `id`. */
export const roomHasId = ({ layout }: WorldRoom, id: string) => [layout.archetype, layout.layout, layout.encounter].includes(id);

export const bossRoom = (world: World, floorIndex: number) =>
  [...world.rooms.values()].find((r) => r.floorRoom.kind === 'boss' && r.floorIndex === floorIndex);

/** The room with `id` nearest the current one on the map, if the world has one. */
export function nearestRoomWithId(world: World, id: string): WorldRoom | undefined {
  const here = world.rooms.get(world.currentRoomId)!.floorRoom.cell;
  const dist = (r: WorldRoom) => Math.abs(r.floorRoom.cell.x - here.x) + Math.abs(r.floorRoom.cell.y - here.y);
  return [...world.rooms.values()].filter((r) => roomHasId(r, id)).sort((a, b) => dist(a) - dist(b))[0];
}

/** How many seeds from 0 up are searched for a room with an id. */
const SEED_SEARCH = 300;

/** The first seed whose world has a room with `id`. */
export function seedWithRoom(id: string): number | undefined {
  for (let seed = 0; seed < SEED_SEARCH; seed++) if ([...createWorld(seed).rooms.values()].some((r) => roomHasId(r, id))) return seed;
  return undefined;
}

/** Where a URL run starts instead of the start room: `?boss=N`'s boss room, else the first `?room=` room. */
export function urlStartRoom(world: World, ask: { boss?: number; room?: string }): WorldRoom | undefined {
  const boss = ask.boss !== undefined ? bossRoom(world, ask.boss - 1) : undefined;
  return boss ?? (ask.room ? [...world.rooms.values()].find((r) => roomHasId(r, ask.room!)) : undefined);
}
