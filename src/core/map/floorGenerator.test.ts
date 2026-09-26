import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { generateFloor, roomDoors } from './floorGenerator';

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;

const firstFloor = (seed: number) =>
  generateFloor({ occupied: new Set(), start: { x: 0, y: 0 }, floorIndex: 0, rng: createRng(seed) });

describe('generateFloor', () => {
  it('produces an identical floor for the same seed', () => {
    expect(firstFloor(42)).toEqual(firstFloor(42));
  });

  it('every door leads to a room whose facing door leads back', () => {
    for (let seed = 0; seed < 50; seed++) {
      const floor = firstFloor(seed);
      for (const room of floor.rooms) {
        for (const door of roomDoors(floor, room.id)) {
          const back = roomDoors(floor, door.to).find((d) => d.side === OPPOSITE[door.side]);
          expect(back?.to, `seed ${seed} room ${room.id} ${door.side}`).toBe(room.id);
        }
      }
    }
  });

  it('the start room has at least one door', () => {
    const floor = firstFloor(3);
    expect(roomDoors(floor, floor.startRoomId).length).toBeGreaterThan(0);
  });
});

const SWEEP = Array.from({ length: 300 }, (_, seed) => seed);

/** Three floors generated the way a run chains them: each starts behind the previous exit. */
function chain(seed: number) {
  const rng = createRng(seed);
  const occupied = new Set<string>();
  const floors = [];
  let start = { x: 0, y: 0 };
  for (let floorIndex = 0; floorIndex < 3; floorIndex++) {
    const floor = generateFloor({ occupied, start, floorIndex, rng: rng.fork(`floor ${floorIndex}`) });
    floors.push(floor);
    for (const c of floor.rooms.flatMap((r) => r.cells)) occupied.add(`${c.x},${c.y}`);
    start = floor.exit.cell;
  }
  return floors;
}

describe('three chained floors', () => {
  it('each floor starts in the cell behind the previous exit', () => {
    for (const seed of SWEEP) {
      const floors = chain(seed);
      for (let i = 1; i < 3; i++) {
        const start = floors[i].rooms.find((r) => r.id === floors[i].startRoomId)!;
        expect(start.cell, `seed ${seed} floor ${i}`).toEqual(floors[i - 1].exit.cell);
      }
    }
  });

  it('never overlap, each reaches the target size, and only touch at exit doors', () => {
    for (const seed of SWEEP) {
      const floors = chain(seed);
      const owner = new Map<string, number>();
      floors.forEach((floor, i) => {
        expect(floor.rooms.length, `seed ${seed} floor ${i}`).toBeGreaterThanOrEqual(12);
        expect(floor.rooms.length, `seed ${seed} floor ${i}`).toBeLessThanOrEqual(16);
        for (const c of floor.rooms.flatMap((r) => r.cells)) {
          expect(owner.has(`${c.x},${c.y}`), `seed ${seed} floor ${i} overlaps at ${c.x},${c.y}`).toBe(false);
          owner.set(`${c.x},${c.y}`, i);
        }
      });
      // Cells of different floors may only touch across an exit: previous boss cell <-> next start cell.
      const exitLinks = new Set(
        floors.slice(0, 2).flatMap((f) => {
          const boss = f.rooms.find((r) => r.kind === 'boss')!;
          const from = `${boss.cell.x + f.exit.at.x},${boss.cell.y + f.exit.at.y}`;
          const to = `${f.exit.cell.x},${f.exit.cell.y}`;
          return [`${from}|${to}`, `${to}|${from}`];
        }),
      );
      for (const [key, i] of owner) {
        const [x, y] = key.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const n = `${x + dx},${y + dy}`;
          const j = owner.get(n);
          if (j !== undefined && j !== i) expect(exitLinks.has(`${key}|${n}`), `seed ${seed} ${key}~${n}`).toBe(true);
        }
      }
    }
  });
});

describe('generateFloor layout', () => {
  it('has about 14 rooms', () => {
    const counts = SWEEP.map((seed) => firstFloor(seed).rooms.length);
    for (const [seed, n] of counts.entries()) {
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(12);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(16);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(13);
    expect(mean).toBeLessThan(15);
  });

  it('is a tree: every room is reachable from the start and there are no loops', () => {
    for (const seed of SWEEP) {
      const floor = firstFloor(seed);
      expect(floor.connections.length, `seed ${seed}`).toBe(floor.rooms.length - 1);
      const seen = new Set([floor.startRoomId]);
      const queue = [floor.startRoomId];
      while (queue.length) {
        for (const d of roomDoors(floor, queue.shift()!)) {
          if (!seen.has(d.to)) seen.add(d.to) && queue.push(d.to);
        }
      }
      expect(seen.size, `seed ${seed}`).toBe(floor.rooms.length);
    }
  });

  it('has 1-3 shaped normal rooms on every floor, each a wide 2x1, tall 1x2, big 2x2 or L block', () => {
    const seen = new Set<string>();
    for (const seed of SWEEP) {
      for (const [i, floor] of chain(seed).entries()) {
        const shaped = floor.rooms.filter((r) => r.cells.length > 1 && r.kind !== 'boss');
        expect(shaped.length, `seed ${seed} floor ${i}`).toBeGreaterThanOrEqual(1);
        expect(shaped.length, `seed ${seed} floor ${i}`).toBeLessThanOrEqual(3);
        for (const r of shaped) {
          expect(r.kind, `seed ${seed} ${r.id}`).toBe('normal');
          const xs = r.cells.map((c) => c.x);
          const ys = r.cells.map((c) => c.y);
          const cols = Math.max(...xs) - Math.min(...xs) + 1;
          const rows = Math.max(...ys) - Math.min(...ys) + 1;
          const span = `${cols}x${rows}`;
          expect(new Set(r.cells.map((c) => `${c.x},${c.y}`)).size, `seed ${seed} ${r.id}`).toBe(r.cells.length);
          expect(r.cell).toEqual({ x: Math.min(...xs), y: Math.min(...ys) });
          if (r.cells.length === 3) {
            // An L: three cells of a 2x2 block, named for the corner it leaves out.
            expect(span, `seed ${seed} ${r.id}`).toBe('2x2');
            const gap = [0, 1].flatMap((y) => [0, 1].map((x) => ({ x, y })))
              .find((o) => !r.cells.some((c) => c.x === r.cell.x + o.x && c.y === r.cell.y + o.y))!;
            expect(r.shape, `seed ${seed} ${r.id}`).toBe(`L-${gap.y ? 'b' : 't'}${gap.x ? 'r' : 'l'}`);
            seen.add(r.shape);
            continue;
          }
          expect(['2x1', '1x2', '2x2'], `seed ${seed} ${r.id}`).toContain(span);
          // A full block: every cell of the span is the room's.
          expect(r.cells, `seed ${seed} ${r.id}`).toHaveLength(cols * rows);
          expect(r.shape, `seed ${seed} ${r.id}`).toBe(span);
          seen.add(span);
        }
        for (const r of floor.rooms.filter((room) => room.kind !== 'boss' && room.cells.length === 1)) expect(r.shape).toBe('1x1');
      }
    }
    expect([...seen].sort()).toEqual(['1x2', '2x1', '2x2', 'L-bl', 'L-br', 'L-tl', 'L-tr']);
  });

  it('lines doors up: each door opens into the cell holding the neighbour’s facing door', () => {
    for (const seed of SWEEP) {
      for (const floor of chain(seed)) {
        const byId = new Map(floor.rooms.map((r) => [r.id, r]));
        for (const room of floor.rooms) {
          const doors = roomDoors(floor, room.id);
          // One door per neighbour: connected rooms share a single cell edge.
          expect(new Set(doors.map((d) => d.to)).size, `seed ${seed} ${room.id}`).toBe(doors.length);
          for (const door of doors) {
            const other = byId.get(door.to)!;
            const back = roomDoors(floor, other.id).find((d) => d.to === room.id)!;
            expect(back.side, `seed ${seed} ${room.id}`).toBe(OPPOSITE[door.side]);
            const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[door.side];
            const through = { x: room.cell.x + door.at.x + step[0], y: room.cell.y + door.at.y + step[1] };
            expect(through, `seed ${seed} ${room.id}->${other.id}`).toEqual({ x: other.cell.x + back.at.x, y: other.cell.y + back.at.y });
            // Rooms touch nowhere else.
            const shared = room.cells.flatMap((a) =>
              other.cells.filter((b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1),
            );
            expect(shared, `seed ${seed} ${room.id}~${other.id}`).toHaveLength(1);
          }
        }
      }
    }
  });

  it('starts floor 1 at the requested world centre', () => {
    for (const seed of SWEEP.slice(0, 20)) {
      const floor = firstFloor(seed);
      expect(floor.rooms.find((r) => r.id === floor.startRoomId)?.cell).toEqual({ x: 0, y: 0 });
    }
  });

  it('has exactly one item room, on a dead end', () => {
    for (const seed of SWEEP) {
      const floor = firstFloor(seed);
      const items = floor.rooms.filter((r) => r.kind === 'item');
      expect(items.length, `seed ${seed}`).toBe(1);
      expect(roomDoors(floor, items[0].id).length, `seed ${seed}`).toBe(1);
    }
  });

  it('places a 2x2 boss room on the dead end farthest from the start', () => {
    for (const seed of SWEEP) {
      const floor = firstFloor(seed);
      const bosses = floor.rooms.filter((r) => r.kind === 'boss');
      expect(bosses.length, `seed ${seed}`).toBe(1);
      const boss = bosses[0];

      const xs = boss.cells.map((c) => c.x);
      const ys = boss.cells.map((c) => c.y);
      expect(boss.cells.length).toBe(4);
      expect(new Set(boss.cells.map((c) => `${c.x},${c.y}`)).size).toBe(4);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(1);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(1);
      expect(roomDoors(floor, boss.id).length, `seed ${seed}`).toBe(1);

      const depth = new Map([[floor.startRoomId, 0]]);
      const queue = [floor.startRoomId];
      while (queue.length) {
        const id = queue.shift()!;
        for (const d of roomDoors(floor, id)) {
          if (!depth.has(d.to)) depth.set(d.to, depth.get(id)! + 1) && queue.push(d.to);
        }
      }
      const deadEnds = floor.rooms.filter((r) => r.id !== floor.startRoomId && roomDoors(floor, r.id).length === 1);
      for (const r of deadEnds) expect(depth.get(boss.id)!, `seed ${seed} vs ${r.id}`).toBeGreaterThanOrEqual(depth.get(r.id)!);
    }
  });

  it('has an exit cell just outside the boss room, opposite its entrance, touching nothing else', () => {
    for (const seed of SWEEP) {
      const floor = firstFloor(seed);
      const boss = floor.rooms.find((r) => r.kind === 'boss')!;
      const entrance = roomDoors(floor, boss.id)[0];
      expect(floor.exit.side, `seed ${seed}`).toBe(OPPOSITE[entrance.side]);

      const from = { x: boss.cell.x + floor.exit.at.x, y: boss.cell.y + floor.exit.at.y };
      expect(boss.cells, `seed ${seed}`).toContainEqual(from);
      const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[floor.exit.side];
      expect(floor.exit.cell).toEqual({ x: from.x + step[0], y: from.y + step[1] });

      const taken = new Set(floor.rooms.flatMap((r) => r.cells).map((c) => `${c.x},${c.y}`));
      const bossCells = new Set(boss.cells.map((c) => `${c.x},${c.y}`));
      const { x, y } = floor.exit.cell;
      expect(taken.has(`${x},${y}`), `seed ${seed}`).toBe(false);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${y + dy}`;
        if (!bossCells.has(key)) expect(taken.has(key), `seed ${seed} exit touches ${key}`).toBe(false);
      }
    }
  });

  it('rooms never overlap and only touch where a door connects them', () => {
    for (const seed of SWEEP) {
      const floor = firstFloor(seed);
      const owner = new Map<string, string>();
      for (const r of floor.rooms) {
        for (const c of r.cells) {
          expect(owner.has(`${c.x},${c.y}`), `seed ${seed} overlap at ${c.x},${c.y}`).toBe(false);
          owner.set(`${c.x},${c.y}`, r.id);
        }
      }
      const linked = new Set(floor.connections.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
      for (const r of floor.rooms) {
        for (const c of r.cells) {
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const other = owner.get(`${c.x + dx},${c.y + dy}`);
            if (other && other !== r.id) expect(linked.has(`${r.id}|${other}`), `seed ${seed} ${r.id}~${other}`).toBe(true);
          }
        }
      }
    }
  });
});
