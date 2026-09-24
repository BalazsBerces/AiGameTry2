import { describe, expect, it } from 'vitest';
import { validateRoom } from './roomValidator';
import {
  burstGlowshroom,
  createWorld,
  detonateBomb,
  dropChampionLoot,
  enterRoom,
  hitTile,
  placeBomb,
  roomLabel,
  shownPickups,
  smashRock,
  sproutTile,
  touchPickup,
  upgradeAfterBoss,
  type WorldRoom,
} from './world';
import { archetypeById, supportsShape } from './archetypes';
import { CELL_TILES, PASSIVE_POOL, roomPadding } from './roomGenerator';

const firstNormalRoom = (world: ReturnType<typeof createWorld>) =>
  [...world.rooms.values()].find((r) => r.floorRoom.kind === 'normal')!;

describe('roomLabel', () => {
  it("names a normal room by its kind, sub-theme and the idea it was built from", () => {
    const room = firstNormalRoom(createWorld(1));
    room.layout.archetype = 'thornMaze';
    room.layout.theme = 'bramble';
    expect(roomLabel(room)).toBe('normal · bramble · thornMaze');
  });

  it('names a composed room by its kind, sub-theme, layout and encounter', () => {
    const room = firstNormalRoom(createWorld(1));
    room.layout.archetype = undefined;
    Object.assign(room.layout, { theme: 'marsh', layout: 'gauntlet', encounter: 'ledgeSentries' });
    expect(roomLabel(room)).toBe('normal · marsh · gauntlet + ledgeSentries');
  });

  it('names a boss arena by its sub-theme and the boss waiting in it', () => {
    const room = [...createWorld(1).rooms.values()].find((r) => r.floorRoom.kind === 'boss')!;
    room.layout.enemies = [{ type: 'ironMaiden', cell: { x: 6, y: 3 } }];
    room.layout.theme = 'crypt';
    expect(roomLabel(room)).toBe('boss · crypt · ironMaiden');
  });

  it('names the empty start room by its kind and sub-theme', () => {
    const world = createWorld(1);
    const start = world.rooms.get(world.currentRoomId)!;
    start.layout.theme = 'grove';
    expect(roomLabel(start)).toBe('start · grove');
  });
});

describe('room sub-themes', () => {
  const FLOOR_THEMES = [
    ['grove', 'marsh', 'bramble'],
    ['grotto', 'hollow', 'rift'],
    ['crypt', 'cellblock', 'machineHall'],
  ];
  const worlds = Array.from({ length: 40 }, (_, seed) => createWorld(seed));

  it("gives every room one of its floor's sub-themes", () => {
    for (const world of worlds) {
      for (const room of world.rooms.values()) expect(FLOOR_THEMES[room.floorIndex]).toContain(room.layout.theme);
    }
  });

  it('uses all three sub-themes on every floor', () => {
    for (const world of worlds) {
      for (const floorIndex of [0, 1, 2]) {
        const used = new Set([...world.rooms.values()].filter((r) => r.floorIndex === floorIndex).map((r) => r.layout.theme));
        expect(used).toEqual(new Set(FLOOR_THEMES[floorIndex]));
      }
    }
  });

  it("gives a 1x1 room the theme of the idea it was built from", () => {
    for (const world of worlds) {
      for (const room of world.rooms.values()) {
        const tag = archetypeById(room.layout.archetype ?? '')?.theme;
        if (tag) expect(room.layout.theme).toBe(tag);
      }
    }
  });

  it('makes neighbouring rooms share a theme far more often than chance', () => {
    let pairs = 0;
    let shared = 0;
    for (const world of worlds) {
      for (const floor of world.floors) {
        for (const [a, b] of floor.connections) {
          pairs++;
          if (world.rooms.get(a)!.layout.theme === world.rooms.get(b)!.layout.theme) shared++;
        }
      }
    }
    expect(shared / pairs).toBeGreaterThan(0.5);
  });

  it("composes big rooms to suit their own theme: the fight leans the theme's way", { timeout: 60_000 }, () => {
    // Each theme's fitting fight, and how often big rooms get it in that theme versus elsewhere on its floor.
    const FAVOURITE: Record<string, string> = {
      grove: 'boarCharge', marsh: 'waspSwarm', bramble: 'ambush',
      grotto: 'ledgeSentries', hollow: 'batColony', rift: 'wormNest',
      crypt: 'haunting', cellblock: 'knightPatrol', machineHall: 'siege',
    };
    const tally = { own: [0, 0], elsewhere: [0, 0] };
    for (let seed = 0; seed < 150; seed++) {
      const big = [...createWorld(seed).rooms.values()].filter((r) => r.floorRoom.shape !== '1x1' && r.floorRoom.kind === 'normal');
      for (const room of big) {
        for (const [theme, favourite] of Object.entries(FAVOURITE)) {
          if (!FLOOR_THEMES[room.floorIndex].includes(theme)) continue;
          const side = tally[room.layout.theme === theme ? 'own' : 'elsewhere'];
          side[0]++;
          if (room.layout.encounter === favourite) side[1]++;
        }
      }
    }
    expect(tally.own[1] / tally.own[0]).toBeGreaterThan(2 * (tally.elsewhere[1] / tally.elsewhere[0]));
  });

  it('dresses every room with decor on its floor, the same for the same seed', () => {
    for (const world of worlds.slice(0, 10)) {
      for (const room of world.rooms.values()) {
        const where = `seed ${world.seed} ${room.floorRoom.id}`;
        expect(room.layout.decor?.length, where).toBeGreaterThan(0);
        for (const d of room.layout.decor!) expect(room.layout.tiles[d.cell.y][d.cell.x], where).toBe('floor');
      }
    }
    const dressing = (seed: number) => [...createWorld(seed).rooms.values()].map((r) => [r.layout.decor, r.layout.variants, r.layout.regions]);
    expect(dressing(3)).toEqual(dressing(3));
    for (const room of worlds[0].rooms.values()) {
      expect(room.layout.variants?.length, room.floorRoom.id).toBe(room.layout.height);
      const holes = room.layout.tiles.flat().filter((t) => t === 'hole').length;
      expect(room.layout.regions!.reduce((n, r) => n + r.cells.length, 0), room.floorRoom.id).toBe(holes);
    }
  });

  it('gives the same themes for the same seed', () => {
    const themes = (seed: number) => [...createWorld(seed).rooms.values()].map((r) => `${r.floorRoom.id}:${r.layout.theme}`);
    expect(themes(11)).toEqual(themes(11));
  });
});

describe('hitTile', () => {
  it('breaks a rock on the third player hit, leaving floor behind', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[3][6] = 'rock';
    const at = { x: 6, y: 3 };
    expect(hitTile(world, room.floorRoom.id, at)).toBe('damaged');
    expect(hitTile(world, room.floorRoom.id, at)).toBe('damaged');
    expect(room.layout.tiles[3][6]).toBe('rock');
    expect(hitTile(world, room.floorRoom.id, at)).toBe('broken');
    expect(room.layout.tiles[3][6]).toBe('floor');
  });

  it('leaves stone and floor untouched', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[3][6] = 'obstacle';
    for (let i = 0; i < 5; i++) expect(hitTile(world, room.floorRoom.id, { x: 6, y: 3 })).toBe('none');
    expect(room.layout.tiles[3][6]).toBe('obstacle');
    room.layout.tiles[0][0] = 'floor';
    expect(hitTile(world, room.floorRoom.id, { x: 0, y: 0 })).toBe('none');
  });
});

describe('smashRock', () => {
  it('breaks a rock outright, for good, forgetting any cracks it had', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    const id = room.floorRoom.id;
    room.layout.tiles[3][6] = 'rock';
    hitTile(world, id, { x: 6, y: 3 });
    expect(smashRock(world, id, { x: 6, y: 3 })).toBe(true);
    expect(world.rooms.get(id)!.layout.tiles[3][6]).toBe('floor');
    room.layout.tiles[3][6] = 'rock';
    expect(hitTile(world, id, { x: 6, y: 3 })).toBe('damaged');
    expect(hitTile(world, id, { x: 6, y: 3 })).toBe('damaged');
  });

  it('leaves stone, holes and floor alone', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    const tiles = room.layout.tiles;
    tiles[1][1] = 'obstacle';
    tiles[1][2] = 'hole';
    tiles[1][3] = 'floor';
    for (const x of [1, 2, 3]) expect(smashRock(world, room.floorRoom.id, { x, y: 1 })).toBe(false);
    expect(tiles[1].slice(1, 4)).toEqual(['obstacle', 'hole', 'floor']);
  });
});

describe('sproutTile', () => {
  it('grows a seed pod into rock that stays in the room until it is broken', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[3][6] = 'floor';
    expect(sproutTile(world, room.floorRoom.id, { x: 6, y: 3 }, 'rock')).toBe(true);
    expect(world.rooms.get(room.floorRoom.id)!.layout.tiles[3][6]).toBe('rock');
    let result = hitTile(world, room.floorRoom.id, { x: 6, y: 3 });
    expect(result).toBe('damaged');
    while (result === 'damaged') result = hitTile(world, room.floorRoom.id, { x: 6, y: 3 });
    expect(result).toBe('broken');
    expect(room.layout.tiles[3][6]).toBe('floor');
  });

  it('grows a thorn bush on floor', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[2][4] = 'floor';
    expect(sproutTile(world, room.floorRoom.id, { x: 4, y: 2 }, 'thorn')).toBe(true);
    expect(room.layout.tiles[2][4]).toBe('thorn');
  });

  it('only sprouts on floor inside the room', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[3][6] = 'hole';
    room.layout.tiles[3][7] = 'obstacle';
    expect(sproutTile(world, room.floorRoom.id, { x: 6, y: 3 }, 'rock')).toBe(false);
    expect(sproutTile(world, room.floorRoom.id, { x: 7, y: 3 }, 'thorn')).toBe(false);
    expect(sproutTile(world, room.floorRoom.id, { x: -1, y: 3 }, 'rock')).toBe(false);
    expect(room.layout.tiles[3][6]).toBe('hole');
    expect(room.layout.tiles[3][7]).toBe('obstacle');
  });
});

describe('burstGlowshroom', () => {
  it('pops a glowshroom on the first shot, leaving floor for the rest of the run', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[3][6] = 'glowshroom';
    expect(burstGlowshroom(world, room.floorRoom.id, { x: 6, y: 3 })).toBe(true);
    expect(world.rooms.get(room.floorRoom.id)!.layout.tiles[3][6]).toBe('floor');
    expect(burstGlowshroom(world, room.floorRoom.id, { x: 6, y: 3 })).toBe(false);
  });

  it('leaves every other tile alone', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    const tiles = room.layout.tiles;
    tiles[1][1] = 'rock';
    tiles[1][2] = 'obstacle';
    tiles[1][3] = 'crystal';
    tiles[1][4] = 'floor';
    for (const x of [1, 2, 3, 4]) expect(burstGlowshroom(world, room.floorRoom.id, { x, y: 1 })).toBe(false);
    expect(tiles[1].slice(1, 5)).toEqual(['rock', 'obstacle', 'crystal', 'floor']);
    expect(burstGlowshroom(world, room.floorRoom.id, { x: -1, y: 1 })).toBe(false);
  });

  it('is not cracked by shots nor smashed by a charge like a rock', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[3][6] = 'glowshroom';
    expect(hitTile(world, room.floorRoom.id, { x: 6, y: 3 })).toBe('none');
    expect(smashRock(world, room.floorRoom.id, { x: 6, y: 3 })).toBe(false);
    expect(room.layout.tiles[3][6]).toBe('glowshroom');
  });
});

describe('bombs', () => {
  it('start at one and are spent by placing them', () => {
    const world = createWorld(1);
    expect(world.player.bombs).toBe(1);
    expect(placeBomb(world)).toBe(true);
    expect(world.player.bombs).toBe(0);
    expect(placeBomb(world)).toBe(false);
    expect(world.player.bombs).toBe(0);
  });

  it('are restocked by bomb pickups', () => {
    const world = createWorld(1);
    const id = firstNormalRoom(world).floorRoom.id;
    world.pickups.set(id, [{ id: 7, type: 'bomb', cell: { x: 2, y: 2 } }]);
    expect(touchPickup(world, id, 7)).toBe('bomb');
    expect(world.player.bombs).toBe(2);
    expect(world.pickups.get(id)).toEqual([]);
  });

  it('blow away rock and stone next to them, but not holes or anything further out', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    const tiles = room.layout.tiles;
    tiles.forEach((row) => row.fill('floor'));
    tiles[3][6] = 'rock';
    tiles[2][5] = 'obstacle';
    tiles[4][7] = 'rock';
    tiles[3][5] = 'hole';
    tiles[3][8] = 'obstacle';
    tiles[1][6] = 'rock';
    const destroyed = detonateBomb(world, room.floorRoom.id, { x: 6, y: 3 });
    expect(destroyed.map((c) => `${c.x},${c.y}`).sort()).toEqual(['5,2', '6,3', '7,4']);
    expect(tiles[3][6]).toBe('floor');
    expect(tiles[2][5]).toBe('floor');
    expect(tiles[4][7]).toBe('floor');
    expect(tiles[3][5]).toBe('hole');
    expect(tiles[3][8]).toBe('obstacle');
    expect(tiles[1][6]).toBe('rock');
  });

  it('finish off a rock that was already cracked without leaving its hits behind', () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    room.layout.tiles[3][6] = 'rock';
    hitTile(world, room.floorRoom.id, { x: 6, y: 3 });
    detonateBomb(world, room.floorRoom.id, { x: 6, y: 3 });
    room.layout.tiles[3][6] = 'rock';
    expect(hitTile(world, room.floorRoom.id, { x: 6, y: 3 })).toBe('damaged');
    expect(hitTile(world, room.floorRoom.id, { x: 6, y: 3 })).toBe('damaged');
  });
});

describe('createWorld room shapes', () => {
  const SIZE: Record<string, [number, number]> = {
    '1x1': [13, 7], '2x1': [26, 7], '1x2': [13, 14], '2x2': [26, 14],
    'L-tl': [26, 14], 'L-tr': [26, 14], 'L-bl': [26, 14], 'L-br': [26, 14],
  };
  /** A door's tile in world tile coordinates: the room's block origin, its wall padding, then the door cell. */
  const doorTile = (room: WorldRoom, cell: { x: number; y: number }) => {
    const pad = roomPadding(room.layout.width, room.layout.height);
    return { x: room.floorRoom.cell.x * CELL_TILES.w + pad.x + cell.x, y: room.floorRoom.cell.y * CELL_TILES.h + pad.y + cell.y };
  };

  it('sizes every room by its shape, composes big rooms and builds 1x1 rooms from ideas', () => {
    for (let seed = 0; seed < 40; seed++) {
      const world = createWorld(seed);
      for (const room of world.rooms.values()) {
        const where = `seed ${seed} ${room.floorRoom.id} ${room.floorRoom.shape}`;
        expect([room.layout.width, room.layout.height], where).toEqual(SIZE[room.floorRoom.shape]);
        if (room.floorRoom.kind !== 'normal') continue;
        if (room.floorRoom.shape !== '1x1') {
          expect([room.layout.layout, room.layout.encounter].every(Boolean), where).toBe(true);
          continue;
        }
        expect(supportsShape(archetypeById(room.layout.archetype!)!, '1x1'), where).toBe(true);
      }
    }
  });

  it('lines every door up with the neighbour’s door on the same tile row or column', () => {
    for (let seed = 0; seed < 40; seed++) {
      const world = createWorld(seed);
      for (const room of world.rooms.values()) {
        for (const door of room.layout.doors) {
          const here = doorTile(room, door.cell);
          const facing = { up: 'down', down: 'up', left: 'right', right: 'left' }[door.side];
          const matches = room.neighbors
            .map((id) => world.rooms.get(id)!)
            .flatMap((n) => n.layout.doors.filter((d) => d.side === facing).map((d) => doorTile(n, d.cell)))
            .filter((there) => (door.side === 'up' || door.side === 'down' ? there.x === here.x : there.y === here.y))
            // Across the two rooms' walls: at most two tiles of padding each, plus one step.
            .filter((there) => Math.abs(there.x - here.x) + Math.abs(there.y - here.y) <= 5);
          expect(matches, `seed ${seed} ${room.floorRoom.id} ${door.side} at ${here.x},${here.y}`).toHaveLength(1);
        }
      }
    }
  });
});

describe('shownPickups', () => {
  it('shows only loot the room placed in plain sight until the room is cleared', () => {
    const world = createWorld(1);
    const id = firstNormalRoom(world).floorRoom.id;
    world.cleared.delete(id);
    world.pickups.set(id, [
      { id: 1, type: 'chest', cell: { x: 6, y: 3 }, visible: true },
      { id: 2, type: 'heart', cell: { x: 2, y: 2 } },
    ]);
    expect(shownPickups(world, id).map((p) => p.id)).toEqual([1]);
    world.cleared.add(id);
    expect(shownPickups(world, id).map((p) => p.id)).toEqual([1, 2]);
  });

  it('shows what a placed chest releases right away, even mid-fight', () => {
    const world = createWorld(1);
    const id = firstNormalRoom(world).floorRoom.id;
    world.cleared.delete(id);
    world.pickups.set(id, [{ id: 1, type: 'chest', cell: { x: 6, y: 3 }, visible: true, contents: [{ type: 'heart' }, { type: 'key' }] }]);
    world.rooms.get(id)!.layout.tiles.forEach((row) => row.fill('floor'));
    expect(touchPickup(world, id, 1)).toBe('opened');
    expect(shownPickups(world, id).map((p) => p.type).sort()).toEqual(['heart', 'key', 'openChest']);
  });
});

describe('passives', () => {
  const itemRoomOf = (world: ReturnType<typeof createWorld>) => [...world.rooms.values()].find((r) => r.floorRoom.kind === 'item')!.floorRoom.id;
  const passiveIn = (world: ReturnType<typeof createWorld>, id: string) => world.pickups.get(id)!.find((p) => p.type === 'passive');

  it('leaves the item room’s passive undecided until the player walks in', () => {
    const world = createWorld(3);
    expect(passiveIn(world, itemRoomOf(world))!.passive).toBeUndefined();
  });

  it('offers a passive the player doesn’t own when they walk into the item room', () => {
    for (let seed = 0; seed < 20; seed++) {
      const world = createWorld(seed);
      world.player.passives = Object.fromEntries(PASSIVE_POOL.filter((p) => p !== 'fireRate').map((p) => [p, 1]));
      const id = itemRoomOf(world);
      enterRoom(world, id);
      expect(passiveIn(world, id)!.passive, `seed ${seed}`).toBe('fireRate');
    }
  });

  it('offers the same passive again on the same seed', () => {
    const offered = (seed: number) => {
      const world = createWorld(seed);
      enterRoom(world, itemRoomOf(world));
      return passiveIn(world, itemRoomOf(world))!.passive;
    };
    for (const seed of [1, 2, 3]) expect(offered(seed)).toBe(offered(seed));
  });

  it('puts a heart in the item room instead once the player owns every passive', () => {
    const world = createWorld(4);
    world.player.passives = Object.fromEntries(PASSIVE_POOL.map((p) => [p, 1]));
    const id = itemRoomOf(world);
    enterRoom(world, id);
    expect(world.pickups.get(id)!.map((p) => p.type)).toEqual(['heart']);
  });

  it('decides a chest’s passive when it is opened, never one the player owns', () => {
    const world = createWorld(1);
    const id = firstNormalRoom(world).floorRoom.id;
    world.rooms.get(id)!.layout.tiles.forEach((row) => row.fill('floor'));
    world.player.passives = Object.fromEntries(PASSIVE_POOL.filter((p) => p !== 'homing').map((p) => [p, 1]));
    world.pickups.set(id, [{ id: 1, type: 'chest', cell: { x: 6, y: 3 }, contents: [{ type: 'passive' }] }]);
    touchPickup(world, id, 1);
    expect(world.pickups.get(id)!.find((p) => p.type === 'passive')!.passive).toBe('homing');
  });

  it('gives a picked-up passive at level 1', () => {
    const world = createWorld(1);
    const id = firstNormalRoom(world).floorRoom.id;
    world.pickups.set(id, [{ id: 5, type: 'passive', passive: 'homing', cell: { x: 2, y: 2 } }]);
    expect(touchPickup(world, id, 5)).toBe('passive');
    expect(world.player.passives).toEqual({ homing: 1 });
  });

  it('upgrades one level-1 passive to level 2 when a boss dies, and says which', () => {
    const world = createWorld(1);
    world.player.passives = { homing: 2, sword: 1 };
    expect(upgradeAfterBoss(world, 'boss-room')).toBe('sword');
    expect(world.player.passives).toEqual({ homing: 2, sword: 2 });
  });

  it('upgrades nothing when a boss dies and no passive is left at level 1', () => {
    const world = createWorld(1);
    world.player.passives = { homing: 2 };
    expect(upgradeAfterBoss(world, 'boss-room')).toBeUndefined();
    expect(world.player.passives).toEqual({ homing: 2 });
  });
});

describe('champions', () => {
  const worlds = Array.from({ length: 150 }, (_, seed) => createWorld(seed));
  const championsIn = (world: ReturnType<typeof createWorld>, kind: string) =>
    [...world.rooms.values()].filter((r) => r.floorRoom.kind === kind).flatMap((r) => r.layout.enemies.filter((e) => e.champion));

  it('appear in normal rooms across runs, but never in boss or item rooms', () => {
    expect(worlds.some((w) => championsIn(w, 'normal').length > 0)).toBe(true);
    for (const w of worlds) {
      expect(championsIn(w, 'boss'), `seed ${w.seed}`).toEqual([]);
      expect(championsIn(w, 'item'), `seed ${w.seed}`).toEqual([]);
    }
  });

  it('are the same for the same seed', () => {
    const crowned = (w: ReturnType<typeof createWorld>) =>
      [...w.rooms.values()].flatMap((r) => r.layout.enemies.filter((e) => e.champion).map((e) => ({ room: r.floorRoom.id, ...e })));
    for (const seed of [3, 17, 42]) {
      expect(crowned(worlds[seed]).length).toBeGreaterThan(0);
      expect(crowned(createWorld(seed))).toEqual(crowned(worlds[seed]));
    }
  });
});

describe('champion loot', () => {
  /** A normal room emptied out: floor everywhere, a pond (holes) in the middle walled off by stone on one side. */
  const pondRoom = () => {
    const world = createWorld(1);
    const room = firstNormalRoom(world);
    const tiles = room.layout.tiles;
    tiles.forEach((row) => row.fill('floor'));
    for (let x = 4; x <= 8; x++) for (let y = 2; y <= 4; y++) tiles[y][x] = 'hole';
    world.pickups.set(room.floorRoom.id, []);
    return { world, id: room.floorRoom.id, tiles };
  };
  const dropped = (world: ReturnType<typeof createWorld>, id: string) => world.pickups.get(id)!.map((p) => p.cell);

  it('lands where the champion died when that is open floor', () => {
    const { world, id } = pondRoom();
    dropChampionLoot(world, id, { type: 'key' }, { x: 1, y: 1 });
    expect(dropped(world, id)).toEqual([{ x: 1, y: 1 }]);
  });

  it('washes up on the nearest floor the player can reach when a flyer dies over a pond', () => {
    const { world, id, tiles } = pondRoom();
    dropChampionLoot(world, id, { type: 'key' }, { x: 6, y: 3 });
    const [cell] = dropped(world, id);
    expect(tiles[cell.y][cell.x]).toBe('floor');
    expect(Math.max(Math.abs(cell.x - 6), Math.abs(cell.y - 3))).toBe(2);
  });

  it('never lands on floor sealed off from the doors, even if it is nearer', () => {
    const { world, id, tiles } = pondRoom();
    // A pocket of floor at 6,3 ringed by the pond: nearest, but out of reach.
    tiles[3][6] = 'floor';
    tiles[3][7] = 'floor';
    dropChampionLoot(world, id, { type: 'key' }, { x: 7, y: 3 });
    const [cell] = dropped(world, id);
    expect(`${cell.x},${cell.y}`).not.toMatch(/^(6|7),3$/);
    expect(tiles[cell.y][cell.x]).toBe('floor');
  });
});

describe('forest cast', () => {
  it('fills floor 1 rooms with goblins, seed-spitters, wasps and boars only, and valid rooms', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const world = createWorld(seed);
      for (const room of world.rooms.values()) {
        if (room.floorIndex !== 0 || room.floorRoom.kind === 'boss') continue;
        const { layout } = room;
        for (const e of layout.enemies) seen.add(e.type);
        // Symmetry is checked per archetype in the room generator sweeps; here, everything else.
        const violations = validateRoom(layout, { axes: [] }).filter((v) => v.rule !== 'asymmetric');
        expect(violations, `seed ${seed} room ${layout.id}`).toEqual([]);
      }
    }
    expect([...seen].sort()).toEqual(['boar', 'goblin', 'seedSpitter', 'wasp']);
  });
});

describe('the caves cast', () => {
  it('fills floor 2 rooms with ghouls, crystal turrets, worms and bats only', () => {
    const types = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const room of createWorld(seed).rooms.values()) {
        if (room.floorIndex !== 1 || room.floorRoom.kind === 'boss') continue;
        for (const e of room.layout.enemies) types.add(e.type);
      }
    }
    expect([...types].sort()).toEqual(['bat', 'crystalTurret', 'ghoul', 'worm']);
  });
});

describe('floor casts across whole runs', () => {
  const castOf = (seed: number) => {
    const types: Set<string>[] = [new Set(), new Set(), new Set()];
    const hp: (number | undefined)[][] = [[], [], []];
    for (const room of createWorld(seed).rooms.values()) {
      if (room.floorRoom.kind !== 'normal') continue;
      for (const e of room.layout.enemies) {
        types[room.floorIndex].add(e.type);
        if (e.type === 'zombie') hp[room.floorIndex].push(e.hp);
      }
    }
    return { types, hp };
  };
  const runs = Array.from({ length: 60 }, (_, seed) => castOf(seed));

  it('never spawns worms or plain turrets on floor 3, whose turret is the gargoyle', () => {
    for (const { types } of runs) {
      expect(types[2].has('worm')).toBe(false);
      expect(types[2].has('turret')).toBe(false);
    }
    expect(runs.some(({ types }) => types[2].has('gargoyle'))).toBe(true);
  });

  it('keeps gargoyles off floors 1 and 2', () => {
    for (const { types } of runs) for (const f of [0, 1]) expect(types[f].has('gargoyle')).toBe(false);
  });

  it('makes floor 3 zombies tougher than the plain zombie (3 hit points) of floors 1 and 2', () => {
    const dungeon = runs.flatMap(({ hp }) => hp[2]);
    expect(dungeon.length).toBeGreaterThan(0);
    for (const h of dungeon) expect(h).toBeGreaterThan(3);
    for (const h of runs.flatMap(({ hp }) => [...hp[0], ...hp[1]])) expect(h).toBeUndefined();
  });
});
