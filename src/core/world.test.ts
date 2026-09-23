import { describe, expect, it } from 'vitest';
import { createWorld, detonateBomb, hitTile, placeBomb, shownPickups, touchPickup, type WorldRoom } from './world';
import { archetypeById, supportsShape } from './archetypes';
import { CELL_TILES, roomPadding } from './roomGenerator';

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

describe('createWorld room shapes', () => {
  const SIZE: Record<string, [number, number]> = { '1x1': [13, 7], '2x1': [26, 7], '1x2': [13, 14], '2x2': [26, 14] };
  /** A door's tile in world tile coordinates: the room's block origin, its wall padding, then the door cell. */
  const doorTile = (room: WorldRoom, cell: { x: number; y: number }) => {
    const pad = roomPadding(room.layout.width, room.layout.height);
    return { x: room.floorRoom.cell.x * CELL_TILES.w + pad.x + cell.x, y: room.floorRoom.cell.y * CELL_TILES.h + pad.y + cell.y };
  };

  it('sizes every room by its shape and builds shaped rooms from ideas drawn for that shape', () => {
    for (let seed = 0; seed < 40; seed++) {
      const world = createWorld(seed);
      for (const room of world.rooms.values()) {
        const where = `seed ${seed} ${room.floorRoom.id} ${room.floorRoom.shape}`;
        expect([room.layout.width, room.layout.height], where).toEqual(SIZE[room.floorRoom.shape]);
        if (room.floorRoom.kind !== 'normal') continue;
        expect(supportsShape(archetypeById(room.layout.archetype!)!, room.floorRoom.shape), where).toBe(true);
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
