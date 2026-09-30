import { describe, expect, it } from 'vitest';
import type { Cell } from '../map/floorGenerator';
import { createWorld, type World } from '../map/world';
import type { EnemySpawn } from '../rooms/roomGenerator';
import { seedWithRoom } from '../map/travel';
import { cheatTag, complete, run, type ConsoleContext } from './console';

const context = (world: World = createWorld(7)): ConsoleContext => ({ world, playerCell: { x: 6, y: 3 }, aim: 'right' });

describe('console basics', () => {
  it('prints the seed', () => {
    expect(run('seed', context(createWorld(42))).log).toEqual(['seed 42']);
  });

  it('lists every command with its usage under help', () => {
    const { log } = run('help', context());
    expect(log.some((l) => l.startsWith('seed'))).toBe(true);
    expect(log.some((l) => l.startsWith('help'))).toBe(true);
  });

  it('says so for an unknown command', () => {
    const { log, actions } = run('fly', context());
    expect(log).toEqual(['unknown command "fly" (try help)']);
    expect(actions).toEqual([]);
  });

  it('ignores an empty line', () => {
    expect(run('   ', context())).toEqual({ log: [], actions: [] });
  });

  it('completes a command name', () => {
    expect(complete('se')).toEqual({ line: 'seed ', candidates: [] });
    expect(complete('SE')).toEqual({ line: 'seed ', candidates: [] });
  });
});

describe('give', () => {
  const tripleNumber = () => {
    const line = run('items', context()).log.find((l) => / triple /.test(l))!;
    return line.trim().split(/\s+/)[0];
  };

  it.each(['triple', 'TRIPLE', '"triple shot"', 'triple shot', 'Triple Shot', 'tri'])('gives Triple shot for "give %s"', (name) => {
    const world = createWorld(7);
    const { log } = run(`give ${name}`, context(world));
    expect(world.player.passives).toEqual({ triple: 1 });
    expect(log).toEqual(['Triple shot level 1']);
  });

  const listed = (command: string) => run(command, context()).log.map((l) => l.trim().split(/\s+/)[1]);

  it('lists the passives under items', () => {
    expect(listed('items')).toContain('triple');
    expect(listed('items')).not.toContain('key');
    expect(listed('items')).not.toContain('damageUp');
  });

  it('lists pickups, stat-ups and chests under drops, numbered on from the passives', () => {
    expect(listed('drops')).toEqual(['heart', 'key', 'bomb', 'heartContainer', 'damageUp', 'rateUp', 'chest', 'lockedChest']);
    const [heart] = run('drops', context()).log;
    const world = createWorld(7);
    world.player.health = 1;
    run(`give ${heart.trim().split(/\s+/)[0]}`, context(world));
    expect(world.player.health).toBe(3);
  });

  it('gives an item by its number in the item list', () => {
    const world = createWorld(7);
    run(`give ${tripleNumber()}`, context(world));
    expect(world.player.passives).toEqual({ triple: 1 });
  });

  it('lists the candidates for an ambiguous name and gives nothing', () => {
    const world = createWorld(7);
    const { log } = run('give s', context(world));
    expect(log).toEqual(['"s" could be: sword (Sword), spectral (Spectral)']);
    expect(world.player.passives).toEqual({});
  });

  it('says so for an item that does not exist', () => {
    expect(run('give laser', context()).log).toEqual(['no item called "laser" (try items or drops)']);
  });

  it('raises a passive to level 2 when given twice, or at once with a level', () => {
    const world = createWorld(7);
    run('give sword', context(world));
    run('give sword', context(world));
    expect(world.player.passives.sword).toBe(2);
    run('give boomerang 2', context(world));
    expect(world.player.passives.boomerang).toBe(2);
  });

  it('gives every passive with all, at level 2 if asked', () => {
    const world = createWorld(7);
    run('give all 2', context(world));
    expect(Object.keys(world.player.passives)).toHaveLength(13);
    expect(Object.values(world.player.passives).every((l) => l === 2)).toBe(true);
  });

  it('removes a passive', () => {
    const world = createWorld(7);
    run('give sword', context(world));
    expect(run('remove sword', context(world)).log).toEqual(['removed Sword']);
    expect(world.player.passives).toEqual({});
  });

  it('adds pickups and stat-ups like picking them up, n at a time', () => {
    const world = createWorld(7);
    const { player } = world;
    run('give bomb 5', context(world));
    run('give key 2', context(world));
    run('give heartContainer', context(world));
    run('give damageUp 3', context(world));
    run('give rateUp', context(world));
    expect(player.bombs).toBe(6);
    expect(player.keys).toBe(2);
    expect([player.health, player.maxHealth]).toEqual([8, 8]);
    expect(player.statUps).toEqual({ damage: 3, rate: 1 });
  });

  it('heals with hearts, never past max health', () => {
    const world = createWorld(7);
    world.player.health = 1;
    run('give heart', context(world));
    expect(world.player.health).toBe(3);
    run('give heart 9', context(world));
    expect(world.player.health).toBe(6);
  });

  it('does not give a chest straight into the inventory', () => {
    expect(run('give chest', context()).log).toEqual(['chest can only be dropped (drop chest)']);
  });

  it('lists the inventory', () => {
    const world = createWorld(7);
    run('give sword 2', context(world));
    run('give damageUp', context(world));
    expect(run('inv', context(world)).log).toEqual(['health 6/6  keys 0  bombs 1', 'passives: Sword 2', 'stat-ups: damage 1, rate 0']);
  });

  it('completes item names after give, drop and remove', () => {
    expect(complete('give boo')).toEqual({ line: 'give boomerang ', candidates: [] });
    expect(complete('give bo')).toEqual({ line: 'give bo', candidates: ['boomerang', 'bomb'] });
    expect(complete('drop lo')).toEqual({ line: 'drop lockedChest ', candidates: [] });
  });
});

describe('drop', () => {
  /** A world whose current room is plain floor, so placement is easy to follow. */
  const openRoom = () => {
    const world = createWorld(7);
    const room = world.rooms.get(world.currentRoomId)!;
    room.layout.tiles = room.layout.tiles.map((row) => row.map(() => 'floor'));
    world.pickups.set(world.currentRoomId, []);
    return { world, tiles: room.layout.tiles };
  };
  const dropped = (world: World) => world.pickups.get(world.currentRoomId)!;

  it('places a chest one tile ahead in the aim direction, in plain sight and full', () => {
    const { world } = openRoom();
    const { actions } = run('drop chest', { world, playerCell: { x: 6, y: 3 }, aim: 'up' });
    expect(dropped(world)).toHaveLength(1);
    expect(dropped(world)[0]).toMatchObject({ type: 'chest', cell: { x: 6, y: 2 }, visible: true });
    expect(dropped(world)[0].contents?.length).toBeGreaterThan(0);
    expect(actions).toEqual([{ kind: 'pickups' }]);
  });

  it('uses the nearest free floor when the tile ahead is blocked', () => {
    const { world, tiles } = openRoom();
    tiles[3][7] = 'rock';
    run('drop key', { world, playerCell: { x: 6, y: 3 }, aim: 'right' });
    const { cell } = dropped(world)[0];
    expect(tiles[cell.y][cell.x]).toBe('floor');
    expect(Math.hypot(cell.x - 7, cell.y - 3)).toBe(1);
    expect(cell).not.toEqual({ x: 6, y: 3 });
  });

  it('spreads several over different tiles', () => {
    const { world } = openRoom();
    run('drop bomb 4', { world, playerCell: { x: 6, y: 3 }, aim: 'left' });
    const cells = dropped(world).map((p) => `${p.cell.x},${p.cell.y}`);
    expect(new Set(cells).size).toBe(4);
    expect(cells[0]).toBe('5,3');
  });

  it('drops a passive and a locked chest', () => {
    const { world } = openRoom();
    run('drop boomerang', context(world));
    run('drop lockedChest', context(world));
    expect(dropped(world).map((p) => [p.type, p.passive])).toEqual([['passive', 'boomerang'], ['lockedChest', undefined]]);
  });
});

describe('cheat toggles', () => {
  it.each(['god', 'noclip', 'freeze', 'onehit'] as const)('%s flips its switch for the run and says so', (cheat) => {
    const world = createWorld(7);
    const on = run(cheat, context(world));
    expect(world.cheats[cheat]).toBe(true);
    expect(on.log).toEqual([`${cheat} ON`]);
    expect(on.actions).toEqual([{ kind: 'toggle', cheat }]);
    expect(run(cheat, context(world)).log).toEqual([`${cheat} off`]);
    expect(world.cheats[cheat]).toBe(false);
  });

  it('starts every run with every cheat off', () => {
    expect(createWorld(7).cheats).toEqual({ god: false, noclip: false, freeze: false, onehit: false });
  });

  it('shares its switch with whoever flipped it before (the arena keys)', () => {
    const world = createWorld(7);
    world.cheats.god = true;
    run('god', context(world));
    expect(world.cheats.god).toBe(false);
  });

  it('names the cheats that are on for the HUD', () => {
    const world = createWorld(7);
    expect(cheatTag(world.cheats)).toBe('');
    run('noclip', context(world));
    run('god', context(world));
    expect(cheatTag(world.cheats)).toBe('GOD · NOCLIP');
  });
});

describe('resources and debug', () => {
  it('sets health in half-hearts, capped at max health and never below half a heart', () => {
    const world = createWorld(7);
    expect(run('hp 99', context(world)).log).toEqual(['health 6/6']);
    expect(world.player.health).toBe(6);
    run('hp 1', context(world));
    expect(world.player.health).toBe(1);
    run('hp 0', context(world));
    expect(world.player.health).toBe(1);
  });

  it('sets keys and bombs exactly', () => {
    const world = createWorld(7);
    run('keys 4', context(world));
    run('bombs 0', context(world));
    expect([world.player.keys, world.player.bombs]).toEqual([4, 0]);
  });

  it('rejects a value that is not a number', () => {
    const world = createWorld(7);
    expect(run('keys lots', context(world)).log).toEqual(['usage: keys <n>']);
    expect(world.player.keys).toBe(0);
  });

  it('fills health with heal', () => {
    const world = createWorld(7);
    world.player.health = 1;
    run('heal', context(world));
    expect(world.player.health).toBe(6);
  });

  it('hands die, kill and hitboxes to the scene', () => {
    expect(run('die', context()).actions).toEqual([{ kind: 'die' }]);
    expect(run('kill', context()).actions).toEqual([{ kind: 'kill' }]);
    expect(run('hitboxes', context()).actions).toEqual([{ kind: 'hitboxes' }]);
  });

  it('scales game speed, refusing zero, negatives and words', () => {
    expect(run('speed 0.25', context()).actions).toEqual([{ kind: 'speed', factor: 0.25 }]);
    expect(run('speed 2', context()).actions).toEqual([{ kind: 'speed', factor: 2 }]);
    for (const bad of ['0', '-1', 'fast', '']) {
      const { log, actions } = run(`speed ${bad}`, context());
      expect(actions).toEqual([]);
      expect(log).toEqual(['usage: speed <factor above 0>, e.g. 0.25, 1, 2']);
    }
  });

  it('prints the weapon the passives and stat-ups make', () => {
    const world = createWorld(7);
    run('give triple', context(world));
    run('give ricochet 2', context(world));
    run('give poison', context(world));
    expect(run('stats', context(world)).log).toEqual([
      'mode shots  fire delay 495ms  damage 0.75',
      'shots 3 (14° apart)  bounces 4  pierce no  spectral no',
      'orbitals 0  dash no  poison 0.3/500ms for 3000ms  chain no  freeze no',
    ]);
  });

  it('shows the sword and its level-2 extras in stats', () => {
    const world = createWorld(7);
    run('give sword', context(world));
    run('give pierce 2', context(world));
    run('give spectral 2', context(world));
    run('give orbital 2', context(world));
    run('give dash 2', context(world));
    run('give chain', context(world));
    run('give freeze 2', context(world));
    run('give damageUp 2', context(world));
    expect(run('stats', context(world)).log).toEqual([
      'mode sword  fire delay 450ms  damage 4',
      'shots 1 (14° apart)  bounces 0  pierce enemies+terrain  spectral +shields',
      'orbitals 2  dash 550ms cooldown, 2 damage  poison no  chain 1 jumps  freeze 30% for 1200ms',
    ]);
  });
});

describe('travel', () => {
  const bossOf = (world: World, floorIndex: number) =>
    [...world.rooms.values()].find((r) => r.floorRoom.kind === 'boss' && r.floorIndex === floorIndex)!;

  it("teleports to the door of a floor's boss room, the current floor's by default", () => {
    const world = createWorld(7);
    const boss2 = bossOf(world, 1);
    expect(run('boss 2', context(world)).actions).toEqual([
      { kind: 'teleport', roomId: boss2.floorRoom.id, cell: boss2.layout.doors[0].cell },
    ]);
    const boss1 = bossOf(world, 0);
    expect(run('boss', context(world)).actions).toEqual([
      { kind: 'teleport', roomId: boss1.floorRoom.id, cell: boss1.layout.doors[0].cell },
    ]);
    expect(run('boss 4', context(world)).log).toEqual(['usage: boss [floor 1-3]']);
  });

  it("teleports to a floor's start room", () => {
    const world = createWorld(7);
    const [action] = run('floor 3', context(world)).actions;
    expect(action).toMatchObject({ kind: 'teleport', roomId: world.floors[2].startRoomId });
  });

  it('keeps the inventory: nothing about the player changes', () => {
    const world = createWorld(7);
    run('give sword', context(world));
    run('boss 3', context(world));
    expect(world.player.passives).toEqual({ sword: 1 });
  });

  it('teleports to the door of the nearest room with that id', () => {
    const seed = seedWithRoom('slimePit')!;
    const world = createWorld(seed);
    const pits = [...world.rooms.values()].filter((r) => r.layout.encounter === 'slimePit');
    const [action] = run('room slimepit', context(world)).actions;
    expect(action).toMatchObject({ kind: 'teleport' });
    const target = pits.find((r) => r.floorRoom.id === (action as { roomId: string }).roomId)!;
    expect(target).toBeDefined();
    expect(action).toEqual({ kind: 'teleport', roomId: target.floorRoom.id, cell: target.layout.doors[0].cell });
  });

  it('says when this world has no such room and suggests a restart', () => {
    const world = createWorld(7);
    const absent = ['slimePit', 'haunting', 'batRoost', 'glowshroomCave'].find(
      (id) => ![...world.rooms.values()].some((r) => [r.layout.archetype, r.layout.layout, r.layout.encounter].includes(id)),
    )!;
    const { log, actions } = run(`room ${absent}`, context(world));
    expect(actions).toEqual([]);
    expect(log).toEqual([`this world has no ${absent} room (try restart room ${absent})`]);
  });

  it('refuses a room id that exists nowhere', () => {
    expect(run('room nosuchthing', context()).log).toEqual(['no room id called "nosuchthing"']);
  });

  it('restarts on a random seed, a given one, or at a room', () => {
    expect(run('restart', context()).actions).toEqual([{ kind: 'restart' }]);
    expect(run('restart 42', context()).actions).toEqual([{ kind: 'restart', seed: 42 }]);
    expect(run('restart room slimePit', context()).actions).toEqual([{ kind: 'restart', seed: seedWithRoom('slimePit'), room: 'slimePit' }]);
  });

  it('reveals the whole current floor on the minimap', () => {
    const world = createWorld(7);
    run('reveal', context(world));
    const floor = [...world.rooms.values()].filter((r) => r.floorIndex === 0);
    expect(floor.every((r) => world.visited.has(r.floorRoom.id))).toBe(true);
    expect([...world.rooms.values()].filter((r) => r.floorIndex === 1).some((r) => world.visited.has(r.floorRoom.id))).toBe(false);
  });

  it("unlocks every door on the current floor", () => {
    const world = createWorld(7);
    const { actions } = run('open', context(world));
    const floor = [...world.rooms.values()].filter((r) => r.floorIndex === 0);
    expect(floor.every((r) => world.unlocked.has(r.floorRoom.id))).toBe(true);
    expect(actions).toEqual([{ kind: 'open' }]);
  });

  it('completes room ids', () => {
    expect(complete('room slimeP')).toEqual({ line: 'room slimePit ', candidates: [] });
  });
});

describe('spawn and arena', () => {
  /** The current room turned to plain floor, the player at its left edge. */
  const openRoom = () => {
    const world = createWorld(7);
    const room = world.rooms.get(world.currentRoomId)!;
    room.layout.tiles = room.layout.tiles.map((row) => row.map(() => 'floor'));
    return { world, tiles: room.layout.tiles, ctx: { world, playerCell: { x: 1, y: 3 }, aim: 'right' as const } };
  };
  const spawnsOf = (actions: unknown[]) => (actions[0] as { spawns: EnemySpawn[] }).spawns;
  const far = (c: Cell, from: Cell) => Math.hypot(c.x - from.x, c.y - from.y);

  it('spawns champions on free floor at least three tiles from the player, apart from each other', () => {
    const { ctx, tiles } = openRoom();
    const { log, actions } = run('spawn zombie 3 champion', ctx);
    const spawns = spawnsOf(actions);
    expect(log).toEqual(['spawned 3 x zombie (champion)']);
    expect(spawns.map((s) => s.type)).toEqual(['zombie', 'zombie', 'zombie']);
    expect(spawns.every((s) => s.champion)).toBe(true);
    for (const s of spawns) {
      expect(far(s.cell, ctx.playerCell)).toBeGreaterThanOrEqual(3);
      expect(tiles[s.cell.y][s.cell.x]).toBe('floor');
    }
    for (const a of spawns) for (const b of spawns) if (a !== b) expect(far(a.cell, b.cell)).toBeGreaterThan(1);
  });

  it('keeps clear of terrain', () => {
    const { ctx, tiles } = openRoom();
    for (let y = 0; y < tiles.length; y++) for (let x = 0; x < tiles[0].length; x++) if (x % 2) tiles[y][x] = 'rock';
    const spawns = spawnsOf(run('spawn bat 6', ctx).actions);
    expect(spawns).toHaveLength(6);
    expect(spawns.every((s) => tiles[s.cell.y][s.cell.x] === 'floor')).toBe(true);
  });

  it('takes a slime size', () => {
    const { ctx } = openRoom();
    expect(spawnsOf(run('spawn slime 2 small', ctx).actions).map((s) => s.slimeTier)).toEqual(['small', 'small']);
    expect(spawnsOf(run('spawn slime', ctx).actions).map((s) => s.slimeTier)).toEqual(['big']);
  });

  it('coils a worm over neighbouring free cells', () => {
    const { ctx } = openRoom();
    const [worm] = spawnsOf(run('spawn worm', ctx).actions);
    const body = [worm.cell, ...worm.tail!];
    expect(body).toHaveLength(4);
    body.slice(1).forEach((c, i) => expect(Math.abs(c.x - body[i].x) + Math.abs(c.y - body[i].y)).toBe(1));
    expect(body.every((c) => far(c, ctx.playerCell) >= 3)).toBe(true);
  });

  it('matches enemy names like items, ignoring case and taking a unique prefix', () => {
    const { ctx } = openRoom();
    expect(spawnsOf(run('spawn GARG', ctx).actions).map((s) => s.type)).toEqual(['gargoyle']);
    expect(run('spawn g', ctx).log).toEqual(['"g" could be: goblin, ghoul, gargoyle, ghost']);
    expect(run('spawn dragon', ctx).log).toEqual(['no enemy called "dragon"']);
  });

  it('says which spawns did not fit', () => {
    const { ctx, tiles } = openRoom();
    for (const row of tiles) row.fill('rock');
    tiles[3][10] = 'floor';
    tiles[5][10] = 'floor';
    const { log, actions } = run('spawn zombie 3', ctx);
    expect(spawnsOf(actions)).toHaveLength(2);
    expect(log).toEqual(['spawned 2 x zombie', "didn't fit: 1 x zombie"]);
  });

  it('spawns a boss', () => {
    const { ctx } = openRoom();
    expect(spawnsOf(run('spawn treantBoss', ctx).actions).map((s) => s.type)).toEqual(['treantBoss']);
  });

  it('completes enemy names', () => {
    expect(complete('spawn gar')).toEqual({ line: 'spawn gargoyle ', candidates: [] });
  });

  it('jumps into the test arena with URL-style enemies', () => {
    expect(run('arena zombie=3 bat champion', context()).actions).toEqual([
      { kind: 'arena', request: { spawns: [{ type: 'zombie', count: 3 }, { type: 'bat', count: 1 }], champion: true, unknown: [] } },
    ]);
    expect(run('arena zombei', context())).toEqual({ log: ['no enemy called zombei'], actions: [] });
  });
});
