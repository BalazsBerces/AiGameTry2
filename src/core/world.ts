import { archetypeById, assignArchetypes } from './archetypes';
import { assignRoomThemes } from './roomThemes';
import { createRng, type Rng } from './rng';
import {
  cellKey,
  generateFloor,
  roomDoors,
  type Cell,
  type Direction,
  type FloorLayout,
  type FloorRoom,
  type RoomDoor,
} from './floorGenerator';
import { generateRoom, type ChampionDrop, type ChestItem, type PickupType, type RoomLayout } from './roomGenerator';
import { bombDestructible, hitsToBreak, isWalkable } from './tiles';
import { floodFill } from './grid';
import type { Passive, PassiveLevels, StatUps } from './weaponModel';
import { offerPassive, pickUpgrade } from './passivePool';

export interface WorldRoom {
  floorIndex: number;
  floorRoom: FloorRoom;
  layout: RoomLayout;
  /** Ids of rooms reachable through this room's doors. */
  neighbors: string[];
}

export interface PlayerState {
  /** Health in half-heart units. */
  health: number;
  /** Maximum health in half-heart units (two per heart container). */
  maxHealth: number;
  keys: number;
  bombs: number;
  passives: PassiveLevels;
  statUps: Required<StatUps>;
}

export interface WorldPickup {
  id: number;
  type: PickupType | 'openChest';
  cell: Cell;
  passive?: Passive;
  contents?: ChestItem[];
  /** Shown before the room is cleared. */
  visible?: boolean;
}

export const HEART_HEAL = 2;

export interface World {
  seed: number;
  floors: FloorLayout[];
  rooms: Map<string, WorldRoom>;
  currentRoomId: string;
  /** Rooms whose enemies are all dead; they never respawn. */
  cleared: Set<string>;
  /** Rooms the player has stood in (drawn filled on the minimap). */
  visited: Set<string>;
  player: PlayerState;
  /** Pickups still lying in each room (shown once the room is cleared). */
  pickups: Map<string, WorldPickup[]>;
  nextPickupId: number;
  /** Player hits taken so far by rocks still standing, keyed `roomId|x,y`. */
  tileHits: Map<string, number>;
}

export const STARTING_HEARTS = 3;
export const STARTING_BOMBS = 1;
/** Tiles whose centre lies within this many tiles of the bomb's are blown away: the 3x3 around it. */
export const BOMB_RADIUS = 1.5;

export const FLOOR_COUNT = 3;

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Doors between floors: each boss room's exit and the next floor's start room. */
function crossFloorDoors(floors: FloorLayout[], floorIndex: number, room: FloorRoom): RoomDoor[] {
  const next = floors[floorIndex + 1];
  const prev = floors[floorIndex - 1];
  if (room.kind === 'boss' && next) {
    const { side, at } = floors[floorIndex].exit;
    return [{ side, at, to: next.startRoomId }];
  }
  if (room.kind === 'start' && prev) {
    const prevBoss = prev.rooms.find((r) => r.kind === 'boss')!;
    return [{ side: OPPOSITE[prev.exit.side], at: { x: 0, y: 0 }, to: prevBoss.id }];
  }
  return [];
}

function buildFloor(world: World, rng: Rng, floor: FloorLayout) {
  const doorsOf = new Map(
    floor.rooms.map((r) => [r.id, [...roomDoors(floor, r.id), ...crossFloorDoors(world.floors, floor.floorIndex, r)]]),
  );
  // Themes steer which ideas the rooms are built from; those ideas' own tags then have the last
  // word, and the rooms without one (big, start, item, boss) fill in around them.
  const graph = floor.rooms.map((r) => ({ id: r.id, neighbors: roomDoors(floor, r.id).map((d) => d.to) }));
  const wanted = assignRoomThemes(graph, floor.floorIndex, rng.fork('themes'));
  const archetypes = assignArchetypes(
    floor.rooms.map((r) => ({
      id: r.id,
      kind: r.kind,
      doors: doorsOf.get(r.id)!.map((d) => d.side),
      shape: r.shape,
      theme: wanted.get(r.id),
    })),
    floor.floorIndex,
    rng.fork('archetypes'),
  );
  const tagged = graph.map((r) => ({ ...r, fixed: archetypeById(archetypes.get(r.id) ?? '')?.theme }));
  const themes = assignRoomThemes(tagged, floor.floorIndex, rng.fork('settled themes'));
  for (const floorRoom of floor.rooms) {
    const doors = doorsOf.get(floorRoom.id)!;
    const archetype = archetypes.get(floorRoom.id);
    const layout = generateRoom(
      { id: floorRoom.id, kind: floorRoom.kind, doors, archetype, shape: floorRoom.shape, theme: themes.get(floorRoom.id) },
      floor.floorIndex,
      rng.fork(`room ${floorRoom.id}`),
    );
    world.rooms.set(floorRoom.id, { floorIndex: floor.floorIndex, floorRoom, layout, neighbors: doors.map((d) => d.to) });
    world.pickups.set(
      floorRoom.id,
      layout.pickups.map((p) => ({ id: world.nextPickupId++, ...p })),
    );
  }
}

export type PickupResult = 'none' | 'healed' | 'key' | 'bomb' | 'opened' | 'passive' | 'damageUp' | 'rateUp';

/** The player touched a pickup. Applies its effect and updates the room's pickups. */
export function touchPickup(world: World, roomId: string, pickupId: number): PickupResult {
  const list = world.pickups.get(roomId) ?? [];
  const pickup = list.find((p) => p.id === pickupId);
  if (!pickup) return 'none';
  const { player } = world;
  const remove = () => world.pickups.set(roomId, (world.pickups.get(roomId) ?? []).filter((p) => p !== pickup));
  switch (pickup.type) {
    case 'heart':
      if (player.health >= player.maxHealth) return 'none';
      player.health = Math.min(player.maxHealth, player.health + HEART_HEAL);
      remove();
      return 'healed';
    case 'key':
      player.keys++;
      remove();
      return 'key';
    case 'bomb':
      player.bombs++;
      remove();
      return 'bomb';
    case 'damageUp':
      player.statUps.damage++;
      remove();
      return 'damageUp';
    case 'rateUp':
      player.statUps.rate++;
      remove();
      return 'rateUp';
    case 'lockedChest':
      if (player.keys === 0) return 'none';
      player.keys--;
      openChest(world, roomId, pickup);
      return 'opened';
    case 'chest':
      openChest(world, roomId, pickup);
      return 'opened';
    case 'passive':
      if (pickup.passive && !player.passives[pickup.passive]) player.passives[pickup.passive] = 1;
      remove();
      return 'passive';
    case 'openChest':
      return 'none';
  }
}

/** Empties a chest onto the walkable cells around it. */
function openChest(world: World, roomId: string, chest: WorldPickup) {
  const { layout } = world.rooms.get(roomId)!;
  const list = world.pickups.get(roomId)!;
  const occupied = new Set(list.map((p) => `${p.cell.x},${p.cell.y}`));
  const around: Cell[] = [];
  for (let r = 1; r <= 2 && around.length < (chest.contents?.length ?? 0); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = { x: chest.cell.x + dx, y: chest.cell.y + dy };
        const tile = layout.tiles[c.y]?.[c.x];
        if (tile && isWalkable(tile) && !occupied.has(`${c.x},${c.y}`)) {
          around.push(c);
          occupied.add(`${c.x},${c.y}`);
        }
      }
    }
  }
  chest.type = 'openChest';
  (chest.contents ?? []).forEach((item, i) => {
    const pickup: WorldPickup = { id: world.nextPickupId++, type: item.type, cell: around[i] ?? chest.cell, visible: chest.visible };
    if (item.type === 'passive') pickup.passive = item.passive;
    list.push(pickup);
    decidePassive(world, pickup);
  });
  chest.contents = undefined;
}

/**
 * Settles what an undecided passive pickup holds, as late as possible so it knows what the
 * player owns by then: one they lack, or a heart once they have them all. Its own RNG stream,
 * so the same seed and the same collection always get the same offer.
 */
function decidePassive(world: World, pickup: WorldPickup) {
  if (pickup.type !== 'passive' || pickup.passive) return;
  const offer = offerPassive(world.player.passives, createRng(world.seed).fork(`passive ${pickup.id}`));
  if (offer) pickup.passive = offer;
  else pickup.type = 'heart';
}

/** A boss died: one of the player's level-1 passives goes up to level 2. Returns which, if any. */
export function upgradeAfterBoss(world: World, roomId: string): Passive | undefined {
  const upgrade = pickUpgrade(world.player.passives, createRng(world.seed).fork(`upgrade ${roomId}`));
  if (upgrade) world.player.passives[upgrade] = 2;
  return upgrade;
}

/**
 * A champion died on `cell`: its extra pickup lands there, in plain sight, or on the nearest
 * floor the player can walk to if it died somewhere they can't (a flyer over a pond, a ghost in stone).
 */
export function dropChampionLoot(world: World, roomId: string, drop: ChampionDrop, cell: Cell) {
  const list = world.pickups.get(roomId) ?? [];
  list.push({ id: world.nextPickupId++, ...drop, cell: reachableNear(world.rooms.get(roomId)!.layout, cell), visible: true });
  world.pickups.set(roomId, list);
}

/** `cell` if the player can walk to it from the doors, else the nearest cell they can. */
function reachableNear(layout: RoomLayout, cell: Cell): Cell {
  const from = layout.doors[0]?.cell;
  if (!from) return cell;
  const reachable = floodFill(layout.tiles, from, isWalkable);
  if (reachable.has(`${cell.x},${cell.y}`)) return cell;
  let best = cell;
  let bestDist = Infinity;
  for (const key of reachable) {
    const [x, y] = key.split(',').map(Number);
    const d = Math.hypot(x - cell.x, y - cell.y);
    if (d < bestDist) [best, bestDist] = [{ x, y }, d];
  }
  return best;
}

export type TileHitResult = 'none' | 'damaged' | 'broken';

/**
 * A player shot hit a terrain tile. Breakable tiles turn into floor after their `hitsToBreak`; the
 * room's tiles are the world's, so a broken rock stays broken for the rest of the run.
 */
export function hitTile(world: World, roomId: string, cell: Cell): TileHitResult {
  const tiles = world.rooms.get(roomId)?.layout.tiles;
  const tile = tiles?.[cell.y]?.[cell.x];
  const toBreak = tile && hitsToBreak(tile);
  if (!tiles || !toBreak) return 'none';
  const key = `${roomId}|${cell.x},${cell.y}`;
  const hits = (world.tileHits.get(key) ?? 0) + 1;
  if (hits < toBreak) {
    world.tileHits.set(key, hits);
    return 'damaged';
  }
  world.tileHits.delete(key);
  tiles[cell.y][cell.x] = 'floor';
  return 'broken';
}

/** A charging boar ran into `cell`: a breakable tile (rock) there turns into floor at once, for good. */
export function smashRock(world: World, roomId: string, cell: Cell): boolean {
  const tiles = world.rooms.get(roomId)?.layout.tiles;
  const tile = tiles?.[cell.y]?.[cell.x];
  if (!tiles || !tile || !hitsToBreak(tile)) return false;
  tiles[cell.y][cell.x] = 'floor';
  world.tileHits.delete(`${roomId}|${cell.x},${cell.y}`);
  return true;
}

/**
 * A seed pod landed on `cell` and sprouts `tile` there. Only floor can sprout; like a broken
 * rock, the change is the world's and lasts for the rest of the run. True if it sprouted.
 */
export function sproutTile(world: World, roomId: string, cell: Cell, tile: 'rock' | 'thorn'): boolean {
  const tiles = world.rooms.get(roomId)?.layout.tiles;
  if (tiles?.[cell.y]?.[cell.x] !== 'floor') return false;
  tiles[cell.y][cell.x] = tile;
  world.tileHits.delete(`${roomId}|${cell.x},${cell.y}`);
  return true;
}

/** The Treant crushed one of its own sprouts: the rock or thorn at `cell` is floor again, for good. True if it was one. */
export function clearSprout(world: World, roomId: string, cell: Cell): boolean {
  const tiles = world.rooms.get(roomId)?.layout.tiles;
  const tile = tiles?.[cell.y]?.[cell.x];
  if (!tiles || (tile !== 'rock' && tile !== 'thorn')) return false;
  tiles[cell.y][cell.x] = 'floor';
  world.tileHits.delete(`${roomId}|${cell.x},${cell.y}`);
  return true;
}

/**
 * A player shot hit `cell`: a glowshroom there bursts (its stun cloud is `stunBurst`) and is
 * floor from then on, for the rest of the run. True if one burst.
 */
export function burstGlowshroom(world: World, roomId: string, cell: Cell): boolean {
  const tiles = world.rooms.get(roomId)?.layout.tiles;
  if (tiles?.[cell.y]?.[cell.x] !== 'glowshroom') return false;
  tiles[cell.y][cell.x] = 'floor';
  return true;
}

/** Spends a bomb if the player has one; true if one was placed. */
export function placeBomb(world: World): boolean {
  if (world.player.bombs <= 0) return false;
  world.player.bombs--;
  return true;
}

/**
 * A bomb went off on `cell`: every rock and stone tile within `BOMB_RADIUS` becomes floor,
 * for good. Holes survive, and room walls aren't tiles at all. Returns the cells destroyed.
 */
export function detonateBomb(world: World, roomId: string, cell: Cell): Cell[] {
  const tiles = world.rooms.get(roomId)?.layout.tiles;
  if (!tiles) return [];
  const reach = Math.floor(BOMB_RADIUS);
  const destroyed: Cell[] = [];
  for (let y = cell.y - reach; y <= cell.y + reach; y++) {
    for (let x = cell.x - reach; x <= cell.x + reach; x++) {
      const tile = tiles[y]?.[x];
      if (!tile || !bombDestructible(tile) || Math.hypot(x - cell.x, y - cell.y) > BOMB_RADIUS) continue;
      tiles[y][x] = 'floor';
      world.tileHits.delete(`${roomId}|${x},${y}`);
      destroyed.push({ x, y });
    }
  }
  return destroyed;
}

/** Pickups on show in a room: everything once it is cleared, before that only loot placed in plain sight. */
export function shownPickups(world: World, roomId: string): WorldPickup[] {
  const all = world.pickups.get(roomId) ?? [];
  return world.cleared.has(roomId) ? all : all.filter((p) => p.visible);
}

/** The player walks into a room; passives lying there are decided now, against what they own. */
export function enterRoom(world: World, roomId: string) {
  world.currentRoomId = roomId;
  world.visited.add(roomId);
  for (const p of world.pickups.get(roomId) ?? []) decidePassive(world, p);
}

/** Rooms shown on the minimap: visited ones, plus unvisited neighbours of visited ones (as outlines). */
export function minimapRooms(world: World): { room: WorldRoom; visited: boolean; current: boolean }[] {
  const shown = new Set(world.visited);
  for (const id of world.visited) for (const n of world.rooms.get(id)!.neighbors) shown.add(n);
  return [...shown].map((id) => ({
    room: world.rooms.get(id)!,
    visited: world.visited.has(id),
    current: id === world.currentRoomId,
  }));
}

export const currentFloorIndex = (world: World) => world.rooms.get(world.currentRoomId)!.floorIndex;

/**
 * The room's kind, sub-theme and the idea it was built from (a boss arena's boss, a composed
 * room's layout and encounter), for playtest reports: `normal · bramble · thornMaze`,
 * `normal · marsh · gauntlet + ledgeSentries`.
 */
export function roomLabel({ floorRoom, layout }: WorldRoom) {
  const composed = layout.layout && `${layout.layout} + ${layout.encounter}`;
  const idea = floorRoom.kind === 'boss' ? layout.enemies[0]?.type : (composed ?? layout.archetype);
  return [floorRoom.kind, layout.theme, idea].filter(Boolean).join(' · ');
}

/**
 * Generates the whole run up front: three floors, each growing from the cell behind the
 * previous boss room's exit. Every floor and room has its own RNG stream.
 */
export function createWorld(seed: number): World {
  const rng = createRng(seed);
  const floors: FloorLayout[] = [];
  const occupied = new Set<string>();
  let start: Cell = { x: 0, y: 0 };
  for (let floorIndex = 0; floorIndex < FLOOR_COUNT; floorIndex++) {
    const floor = generateFloor({ occupied, start, floorIndex, rng: rng.fork(`floor ${floorIndex}`) });
    floors.push(floor);
    for (const c of floor.rooms.flatMap((r) => r.cells)) occupied.add(cellKey(c));
    start = floor.exit.cell;
  }
  const world: World = {
    seed,
    floors,
    rooms: new Map(),
    currentRoomId: floors[0].startRoomId,
    cleared: new Set(),
    visited: new Set([floors[0].startRoomId]),
    player: { health: STARTING_HEARTS * 2, maxHealth: STARTING_HEARTS * 2, keys: 0, bombs: STARTING_BOMBS, passives: {}, statUps: { damage: 0, rate: 0 } },
    pickups: new Map(),
    nextPickupId: 1,
    tileHits: new Map(),
  };
  for (const floor of floors) buildFloor(world, rng.fork(`floor ${floor.floorIndex}`), floor);
  for (const [id, room] of world.rooms) if (room.layout.enemies.length === 0) world.cleared.add(id);
  return world;
}

export const isFinalFloor = (floorIndex: number) => floorIndex === FLOOR_COUNT - 1;

/** Applies one hit (half a heart). Returns true if the player died. */
export function damagePlayer(world: World): boolean {
  world.player.health = Math.max(0, world.player.health - 1);
  return world.player.health === 0;
}

export function roomAtCell(world: World, x: number, y: number): WorldRoom | undefined {
  for (const room of world.rooms.values()) {
    if (room.floorRoom.cells.some((c) => c.x === x && c.y === y)) return room;
  }
  return undefined;
}
