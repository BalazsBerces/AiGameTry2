import { describe, expect, it } from 'vitest';
import { createWorld, detonateBomb, hitTile, placeBomb, shownPickups, touchPickup } from './world';

const firstNormalRoom = (world: ReturnType<typeof createWorld>) =>
  [...world.rooms.values()].find((r) => r.floorRoom.kind === 'normal')!;

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
    expect(hitTile(world, room.floorRoom.id, { x: 0, y: 0 })).toBe('none');
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
