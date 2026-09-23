import { describe, expect, it } from 'vitest';
import { createWorld, hitTile, shownPickups, touchPickup } from './world';

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
