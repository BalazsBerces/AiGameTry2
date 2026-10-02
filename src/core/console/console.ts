import { cellKey, STEP, type Cell, type Direction } from '../map/floorGenerator';
import { isWalkable } from '../map/tiles';
import { bossRoom, nearestRoomWithId, ROOM_IDS, seedWithRoom } from '../map/travel';
import {
  applyConsumable,
  currentFloorIndex,
  FLOOR_COUNT,
  type Cheats,
  type ConsumableType,
  type World,
  type WorldPickup,
  type WorldRoom,
} from '../map/world';
import { PASSIVE_NAMES, resolveWeapon, type Passive, type PassiveLevel, type Weapon } from '../player/weaponModel';
import { createRng } from '../rng';
import { findSeamGlow, GLOW_NAMES, SEAM_GLOWS, type SeamGlow } from '../art/seamGlow';
import { PASSIVE_POOL, rollChestContents, type EnemySpawn } from '../rooms/roomGenerator';
import { ENEMY_TYPES, parseArenaQuery, placeSpawns, SLIME_TIERS, type ArenaRequest, type ArenaSpawn } from '../rooms/testArena';

/**
 * The in-game dev console's commands (playtesting). `run` carries out one typed line: what
 * changes core state changes the world here, and what needs the scene (teleports, spawns,
 * restarts) comes back as actions for it to carry out. `complete` is the Tab key.
 */

export interface ConsoleContext {
  world: World;
  /** The player's interior tile in the current room. */
  playerCell: Cell;
  /** Where the player last aimed (or faced), for `drop`. */
  aim: Direction;
}

/** What the scene carries out after a command. */
export type ConsoleAction =
  /** Redraw the current room's pickups. */
  | { kind: 'pickups' }
  /** A cheat was flipped (it is already, in `world.cheats`). */
  | { kind: 'toggle'; cheat: keyof Cheats }
  /** End the run as a loss. */
  | { kind: 'die' }
  /** Kill every enemy in the room through the normal death path. */
  | { kind: 'kill' }
  /** Scale game speed (1 is normal). */
  | { kind: 'speed'; factor: number }
  /** Show or hide the physics outlines. */
  | { kind: 'hitboxes' }
  /** Show the worm boss's seams in this glow from now on. */
  | { kind: 'glow'; glow: SeamGlow }
  /** Move the player to `cell` in the room, keeping the run. */
  | { kind: 'teleport'; roomId: string; cell: Cell }
  /** A new run: on `seed` (random if left out), starting at a `room` with that id if given. */
  | { kind: 'restart'; seed?: number; room?: string }
  /** Doors were unlocked (in `world.unlocked`): lift the current room's locks. */
  | { kind: 'open' }
  /** Bring these enemies into the current room, outside its own fight. */
  | { kind: 'spawn'; spawns: EnemySpawn[] }
  /** A new run in the test arena. */
  | { kind: 'arena'; request: ArenaRequest };

const CHEATS: readonly (keyof Cheats)[] = ['god', 'noclip', 'freeze', 'onehit'];

/** The HUD's reminder of the cheats that are on, e.g. `GOD · NOCLIP`; empty when none are. */
export const cheatTag = (cheats: Cheats) =>
  CHEATS.filter((c) => cheats[c])
    .map((c) => c.toUpperCase())
    .join(' · ');

const CHEAT_USAGE: Record<keyof Cheats, string> = {
  god: 'god — health never drops (hits still land)',
  noclip: 'noclip — walk through terrain, holes and thorns',
  freeze: 'freeze — enemies stand still',
  onehit: 'onehit — your hits kill anything',
};

export interface ConsoleResult {
  log: string[];
  actions: ConsoleAction[];
}

/** Something a name can pick out: its id and the other names it goes by. */
interface Named {
  id: string;
  names?: string[];
}

type Match<T> = { found: T } | { error: string };

/**
 * Picks the entry `query` names, ignoring case: an exact id or name wins, otherwise the one
 * entry whose id or a name starts with it. Several such entries is an error listing them.
 */
export function matchName<T extends Named>(query: string, entries: readonly T[], what: string, hint = ''): Match<T> {
  const q = query.toLowerCase();
  if (!q) return { error: `which ${what}?${hint}` };
  const namesOf = (e: T) => [e.id, ...(e.names ?? [])].map((n) => n.toLowerCase());
  const exact = entries.find((e) => namesOf(e).includes(q));
  if (exact) return { found: exact };
  const starts = entries.filter((e) => namesOf(e).some((n) => n.startsWith(q)));
  if (starts.length === 1) return { found: starts[0] };
  if (!starts.length) return { error: `no ${what} called "${query}"${hint}` };
  const list = starts.map((e) => (e.names?.length ? `${e.id} (${e.names[0]})` : e.id)).join(', ');
  return { error: `"${query}" could be: ${list}` };
}

type Item =
  | { kind: 'passive'; id: Passive; names: string[] }
  | { kind: 'consumable'; id: ConsumableType; names?: string[] }
  | { kind: 'chest'; id: 'chest' | 'lockedChest'; names?: string[] };

/** Everything `give` and `drop` know, in the order (and so by the numbers) `items` lists them. */
export const ITEMS: readonly Item[] = [
  ...PASSIVE_POOL.map((id): Item => ({ kind: 'passive', id, names: [PASSIVE_NAMES[id]] })),
  ...(['heart', 'key', 'bomb', 'heartContainer', 'damageUp', 'rateUp'] as const).map((id): Item => ({ kind: 'consumable', id })),
  ...(['chest', 'lockedChest'] as const).map((id): Item => ({ kind: 'chest', id })),
];

const itemName = (item: Item) => item.names?.[0] ?? item.id;

/** The item a name, or its number in `items`, stands for. */
function findItem(query: string): Match<Item> {
  const n = Number(query);
  if (Number.isInteger(n) && n >= 1 && n <= ITEMS.length) return { found: ITEMS[n - 1] };
  return matchName(query, ITEMS, 'item', ' (try items or drops)');
}

/** The items `which` picks, each with its number (which `give` and `drop` take): one numbering across `items` and `drops`. */
const itemList = (which: (item: Item) => boolean) =>
  ITEMS.flatMap((item, i) =>
    which(item) ? [`${String(i + 1).padStart(3)} ${item.id}${item.names ? ` — ${item.names[0]}` : ''}${item.kind === 'chest' ? ' (drop only)' : ''}`] : [],
  );

/** A whole number, if the word is one. */
const integer = (word: string | undefined) => (word !== undefined && /^-?\d+$/.test(word) ? Number(word) : undefined);

/** The words as a name and a trailing count, if there is one: `triple shot 2` is `triple shot` and 2. */
function nameAndCount(args: string[]): { name: string; count?: number } {
  const count = args.length > 1 ? integer(args[args.length - 1]) : undefined;
  return { name: (count === undefined ? args : args.slice(0, -1)).join(' '), count };
}

function setPassive(world: World, passive: Passive, level?: number): string {
  const { passives } = world.player;
  const next: PassiveLevel = level === 2 || (level === undefined && passives[passive]) ? 2 : 1;
  passives[passive] = next;
  return `${PASSIVE_NAMES[passive]} level ${next}`;
}

/**
 * Up to `n` free floor tiles for dropped pickups: the one ahead of the player where they aim
 * first, then the nearest others to it. Never the player's own tile or one a pickup lies on.
 */
function dropCells({ world, playerCell, aim }: ConsoleContext, n: number): Cell[] {
  const { tiles } = world.rooms.get(world.currentRoomId)!.layout;
  const ahead = { x: playerCell.x + STEP[aim].x, y: playerCell.y + STEP[aim].y };
  const taken = new Set([playerCell, ...(world.pickups.get(world.currentRoomId) ?? []).map((p) => p.cell)].map(cellKey));
  const free: Cell[] = [];
  tiles.forEach((row, y) => row.forEach((tile, x) => isWalkable(tile) && !taken.has(cellKey({ x, y })) && free.push({ x, y })));
  const dist = (c: Cell) => Math.hypot(c.x - ahead.x, c.y - ahead.y);
  return free.sort((a, b) => dist(a) - dist(b)).slice(0, n);
}

/** A teleport to the room's first door. */
const toDoor = (room: WorldRoom): ConsoleAction => ({ kind: 'teleport', roomId: room.floorRoom.id, cell: room.layout.doors[0].cell });

const floorRooms = (world: World) => [...world.rooms.values()].filter((r) => r.floorIndex === currentFloorIndex(world));

/** A number as short as it reads: 0.75, 4, 0.3. */
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** `stats`: the resolved weapon, three lines. */
function weaponStats(w: Weapon): string[] {
  const pierce = w.piercesTerrain ? 'enemies+terrain' : w.piercesEnemies ? 'enemies' : 'no';
  const spectral = w.passesShields ? '+shields' : w.spectral ? 'yes' : 'no';
  const dash = w.dash ? `${w.dash.cooldownMs}ms cooldown${w.dash.damage ? `, ${w.dash.damage} damage` : ''}` : 'no';
  const poison = w.poison ? `${num(w.poison.damagePerTick)}/${w.poison.tickMs}ms for ${w.poison.durationMs}ms` : 'no';
  const chain = w.chain ? `${w.chain.jumps} jumps` : 'no';
  const freeze = w.freeze ? `${Math.round(w.freeze.chance * 100)}% for ${w.freeze.stunMs}ms` : 'no';
  return [
    `mode ${w.mode}  fire delay ${Math.round(w.fireDelayMs)}ms  damage ${num(w.damage)}`,
    `shots ${w.shots} (${w.spreadDeg}° apart)  bounces ${w.bounces}  pierce ${pierce}  spectral ${spectral}`,
    `orbitals ${w.orbitals}  dash ${dash}  poison ${poison}  chain ${chain}  freeze ${freeze}`,
  ];
}

interface Command {
  name: string;
  usage: string;
  /** What Tab offers for the words after the command's name. */
  args?: () => string[];
  run(args: string[], ctx: ConsoleContext, out: ConsoleResult): void;
}

const itemIds = () => ITEMS.map((i) => i.id);

const COMMANDS: Command[] = [
  {
    name: 'help',
    usage: 'help — list every command',
    run: (_args, _ctx, out) => out.log.push(...COMMANDS.map((c) => c.usage)),
  },
  {
    name: 'seed',
    usage: "seed — print this run's seed",
    run: (_args, { world }, out) => out.log.push(`seed ${world.seed}`),
  },
  {
    name: 'items',
    usage: 'items — list the passives give and drop take, by number',
    run: (_args, _ctx, out) => out.log.push(...itemList((item) => item.kind === 'passive')),
  },
  {
    name: 'drops',
    usage: 'drops — list the pickups, stat-ups and chests give and drop take, by number',
    run: (_args, _ctx, out) => out.log.push(...itemList((item) => item.kind !== 'passive')),
  },
  {
    name: 'give',
    usage: 'give <item> [n] — a passive (n = level), n pickups or stat-ups; give all [2]',
    args: () => ['all', ...itemIds()],
    run: (args, { world }, out) => {
      const { name, count } = nameAndCount(args);
      if (name.toLowerCase() === 'all') {
        for (const p of PASSIVE_POOL) world.player.passives[p] = count === 2 ? 2 : 1;
        return void out.log.push(`every passive, level ${count === 2 ? 2 : 1}`);
      }
      const match = findItem(name);
      if ('error' in match) return void out.log.push(match.error);
      const item = match.found;
      if (item.kind === 'passive') return void out.log.push(setPassive(world, item.id, count));
      if (item.kind === 'chest') return void out.log.push(`${item.id} can only be dropped (drop ${item.id})`);
      const n = Math.max(1, count ?? 1);
      for (let i = 0; i < n; i++) applyConsumable(world.player, item.id);
      out.log.push(`${n} x ${item.id}`);
    },
  },
  {
    name: 'remove',
    usage: 'remove <passive> — take a passive away',
    args: () => [...PASSIVE_POOL],
    run: (args, { world }, out) => {
      const match = matchName(args.join(' '), ITEMS.filter((i) => i.kind === 'passive'), 'passive');
      if ('error' in match) return void out.log.push(match.error);
      delete world.player.passives[match.found.id as Passive];
      out.log.push(`removed ${itemName(match.found)}`);
    },
  },
  {
    name: 'inv',
    usage: 'inv — list passives, stat-ups, keys, bombs and health',
    run: (_args, { world: { player } }, out) => {
      const owned = PASSIVE_POOL.filter((p) => player.passives[p]).map((p) => `${PASSIVE_NAMES[p]} ${player.passives[p]}`);
      out.log.push(
        `health ${player.health}/${player.maxHealth}  keys ${player.keys}  bombs ${player.bombs}`,
        `passives: ${owned.join(', ') || 'none'}`,
        `stat-ups: damage ${player.statUps.damage}, rate ${player.statUps.rate}`,
      );
    },
  },
  {
    name: 'drop',
    usage: 'drop <item> [n] — place pickups one tile ahead of where you aim',
    args: itemIds,
    run: (args, ctx, out) => {
      const { name, count } = nameAndCount(args);
      const match = findItem(name);
      if ('error' in match) return void out.log.push(match.error);
      const item = match.found;
      const { world } = ctx;
      const roomId = world.currentRoomId;
      const cells = dropCells(ctx, Math.max(1, count ?? 1));
      const list = world.pickups.get(roomId) ?? [];
      for (const cell of cells) {
        const id = world.nextPickupId++;
        const pickup: WorldPickup = { id, type: item.kind === 'passive' ? 'passive' : item.id, cell, visible: true };
        if (item.kind === 'passive') pickup.passive = item.id;
        if (item.kind === 'chest') pickup.contents = rollChestContents(item.id, createRng(world.seed).fork(`console drop ${id}`));
        list.push(pickup);
      }
      world.pickups.set(roomId, list);
      out.log.push(cells.length ? `dropped ${cells.length} x ${item.id}` : 'no free floor to drop on');
      if (cells.length) out.actions.push({ kind: 'pickups' });
    },
  },
  ...(['hp', 'keys', 'bombs'] as const).map(
    (stat): Command => ({
      name: stat,
      usage: stat === 'hp' ? 'hp <n> — set health in half-hearts (up to max health)' : `${stat} <n> — set ${stat}`,
      run: ([value], { world: { player } }, out) => {
        const n = integer(value);
        if (n === undefined) return void out.log.push(`usage: ${stat} <n>`);
        if (stat === 'keys') player.keys = Math.max(0, n);
        if (stat === 'bombs') player.bombs = Math.max(0, n);
        if (stat === 'hp') player.health = Math.min(player.maxHealth, Math.max(1, n));
        out.log.push(stat === 'hp' ? `health ${player.health}/${player.maxHealth}` : `${stat} ${player[stat]}`);
      },
    }),
  ),
  {
    name: 'heal',
    usage: 'heal — fill health',
    run: (_args, { world: { player } }, out) => {
      player.health = player.maxHealth;
      out.log.push(`health ${player.health}/${player.maxHealth}`);
    },
  },
  {
    name: 'die',
    usage: 'die — end the run as a loss',
    run: (_args, _ctx, out) => out.actions.push({ kind: 'die' }),
  },
  {
    name: 'kill',
    usage: 'kill — kill every enemy in the room, rewards and all',
    run: (_args, _ctx, out) => out.actions.push({ kind: 'kill' }),
  },
  {
    name: 'speed',
    usage: 'speed <x> — scale game speed (0.25 slow motion, 1 normal)',
    run: ([value], _ctx, out) => {
      const factor = Number(value);
      if (!value || !Number.isFinite(factor) || factor <= 0) return void out.log.push('usage: speed <factor above 0>, e.g. 0.25, 1, 2');
      out.log.push(`speed ×${factor}`);
      out.actions.push({ kind: 'speed', factor });
    },
  },
  {
    name: 'hitboxes',
    usage: 'hitboxes — show or hide the physics outlines',
    run: (_args, _ctx, out) => out.actions.push({ kind: 'hitboxes' }),
  },
  {
    name: 'glow',
    usage: "glow blood|ember — show the worm boss's seams blood red or molten ember, to compare",
    args: () => SEAM_GLOWS.map((g) => g.id),
    run: ([value = '', ...rest], _ctx, out) => {
      const glow = findSeamGlow([value, ...rest].join(' '));
      if (!glow) return void out.log.push('usage: glow blood|ember');
      out.log.push(`worm boss glow: ${GLOW_NAMES[glow]}`);
      out.actions.push({ kind: 'glow', glow });
    },
  },
  {
    name: 'stats',
    usage: 'stats — print the weapon your passives and stat-ups make',
    run: (_args, { world: { player } }, out) => out.log.push(...weaponStats(resolveWeapon(player.passives, player.statUps))),
  },
  {
    name: 'boss',
    usage: "boss [floor] — teleport to that floor's boss room door (default: this floor)",
    run: ([value], { world }, out) => {
      const floor = value === undefined ? currentFloorIndex(world) + 1 : integer(value);
      const room = floor !== undefined ? bossRoom(world, floor - 1) : undefined;
      if (!room) return void out.log.push(`usage: boss [floor 1-${FLOOR_COUNT}]`);
      out.log.push(`to floor ${floor}'s boss room`);
      out.actions.push(toDoor(room));
    },
  },
  {
    name: 'floor',
    usage: "floor <n> — teleport to that floor's start room",
    run: ([value], { world }, out) => {
      const n = integer(value);
      const start = n !== undefined ? world.floors[n - 1]?.startRoomId : undefined;
      if (!start) return void out.log.push(`usage: floor <1-${FLOOR_COUNT}>`);
      const { layout } = world.rooms.get(start)!;
      out.log.push(`to floor ${n}'s start room`);
      out.actions.push({ kind: 'teleport', roomId: start, cell: { x: Math.floor(layout.width / 2), y: Math.floor(layout.height / 2) } });
    },
  },
  {
    name: 'room',
    usage: 'room <id> — teleport to the door of the nearest room built from that archetype, layout or encounter',
    args: () => [...ROOM_IDS],
    run: (args, { world }, out) => {
      const match = matchName(args.join(' '), ROOM_IDS.map((id) => ({ id })), 'room id');
      if ('error' in match) return void out.log.push(match.error);
      const { id } = match.found;
      const room = nearestRoomWithId(world, id);
      if (!room) return void out.log.push(`this world has no ${id} room (try restart room ${id})`);
      out.log.push(`to the nearest ${id} room`);
      out.actions.push(toDoor(room));
    },
  },
  {
    name: 'restart',
    usage: 'restart [seed] | restart room <id> — start a new run',
    run: (args, _ctx, out) => {
      if (args[0]?.toLowerCase() === 'room') {
        const match = matchName(args.slice(1).join(' '), ROOM_IDS.map((id) => ({ id })), 'room id');
        if ('error' in match) return void out.log.push(match.error);
        const room = match.found.id;
        const seed = seedWithRoom(room);
        if (seed === undefined) return void out.log.push(`no seed found with a ${room} room`);
        return void out.actions.push({ kind: 'restart', seed, room });
      }
      if (args[0] === undefined) return void out.actions.push({ kind: 'restart' });
      const seed = integer(args[0]);
      if (seed === undefined) return void out.log.push('usage: restart [seed] | restart room <id>');
      out.actions.push({ kind: 'restart', seed });
    },
  },
  {
    name: 'reveal',
    usage: 'reveal — show the whole current floor on the minimap',
    run: (_args, { world }, out) => {
      for (const room of floorRooms(world)) world.visited.add(room.floorRoom.id);
      out.log.push('floor revealed');
    },
  },
  {
    name: 'open',
    usage: 'open — unlock every door on the current floor',
    run: (_args, { world }, out) => {
      for (const room of floorRooms(world)) world.unlocked.add(room.floorRoom.id);
      out.log.push('doors on this floor unlocked');
      out.actions.push({ kind: 'open' });
    },
  },
  {
    name: 'spawn',
    usage: 'spawn <enemy> [n] [champion] [big|medium|small] — enemies in this room (arena names)',
    args: () => [...ENEMY_TYPES],
    run: ([name, ...rest], { world, playerCell }, out) => {
      const match = matchName(name ?? '', ENEMY_TYPES.map((id) => ({ id })), 'enemy');
      if ('error' in match) return void out.log.push(match.error);
      const type = match.found.id;
      const words = rest.map((w) => w.toLowerCase());
      const tier = SLIME_TIERS.find((t) => words.includes(t)) ?? (type === 'slime' ? 'big' : undefined);
      const champion = words.includes('champion');
      const count = Math.max(1, words.map((w) => integer(w)).find((n) => n !== undefined) ?? 1);
      const ask: ArenaSpawn = { type, count, ...(tier ? { tier } : {}) };
      const { tiles } = world.rooms.get(world.currentRoomId)!.layout;
      const { spawns, missed } = placeSpawns({ spawns: [ask], champion }, { tiles, player: playerCell });
      const label = (n: number) => `${n} x ${tier && type === 'slime' ? `${tier} ` : ''}${type}`;
      if (spawns.length) out.log.push(`spawned ${label(spawns.length)}${champion ? ' (champion)' : ''}`);
      if (missed.length) out.log.push(`didn't fit: ${label(missed[0].count)}`);
      if (spawns.length) out.actions.push({ kind: 'spawn', spawns });
    },
  },
  {
    name: 'arena',
    usage: 'arena <enemies> — the test arena, URL style: arena zombie=3 bat champion',
    run: (args, _ctx, out) => {
      const request = parseArenaQuery(args.join('&'));
      if (!request) return void out.log.push('usage: arena zombie=3 bat champion');
      if (request.unknown.length) out.log.push(`no enemy called ${request.unknown.join(', ')}`);
      if (request.spawns.length) out.actions.push({ kind: 'arena', request });
    },
  },
  ...CHEATS.map(
    (cheat): Command => ({
      name: cheat,
      usage: CHEAT_USAGE[cheat],
      run: (_args, { world }, out) => {
        world.cheats[cheat] = !world.cheats[cheat];
        out.log.push(`${cheat} ${world.cheats[cheat] ? 'ON' : 'off'}`);
        out.actions.push({ kind: 'toggle', cheat });
      },
    }),
  ),
];

/** A line split into words; "double quotes" keep a multi-word name together. */
export function tokenize(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"?|(\S+)/g)].map((m) => m[1] ?? m[2]).filter((t) => t !== '');
}

export function run(line: string, ctx: ConsoleContext): ConsoleResult {
  const out: ConsoleResult = { log: [], actions: [] };
  const [name, ...args] = tokenize(line);
  if (!name) return out;
  const command = COMMANDS.find((c) => c.name === name.toLowerCase());
  if (!command) out.log.push(`unknown command "${name}" (try help)`);
  else command.run(args, ctx, out);
  return out;
}

/** The longest start every candidate shares, ignoring case. */
function commonPrefix(words: string[]): string {
  let prefix = words[0] ?? '';
  for (const w of words) while (!w.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  return prefix;
}

/**
 * Tab: completes the word being typed as far as its candidates agree, with a space after a
 * single match. `candidates` lists them when more than one is left.
 */
export function complete(line: string): { line: string; candidates: string[] } {
  const words = line.split(' ');
  const typed = words[words.length - 1];
  const command = words.length > 1 ? COMMANDS.find((c) => c.name === words[0].toLowerCase()) : undefined;
  const pool = words.length === 1 ? COMMANDS.map((c) => c.name) : words.length === 2 ? (command?.args?.() ?? []) : [];
  const matches = pool.filter((w) => w.toLowerCase().startsWith(typed.toLowerCase()));
  if (!matches.length) return { line, candidates: [] };
  const head = words.slice(0, -1).join(' ');
  const done = matches.length === 1 ? `${matches[0]} ` : commonPrefix(matches);
  return { line: head ? `${head} ${done}` : done, candidates: matches.length > 1 ? matches : [] };
}
