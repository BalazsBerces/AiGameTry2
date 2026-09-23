import { describe, expect, it } from 'vitest';
import { validateRoom } from './roomValidator';
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

describe('forest cast', () => {
  it('fills floor 1 rooms with goblins and seed-spitters only, and valid rooms', () => {
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
    expect([...seen].sort()).toEqual(['goblin', 'seedSpitter']);
  });
});
