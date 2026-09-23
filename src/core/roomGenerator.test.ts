import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { generateRoom } from './roomGenerator';

const ALL_DOORS = ['up', 'down', 'left', 'right'] as const;
const room = (seed: number, doors: readonly (typeof ALL_DOORS)[number][] = ALL_DOORS) =>
  generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, 0, createRng(seed));
const count = (r: ReturnType<typeof room>, tile: string) => r.tiles.flat().filter((t) => t === tile).length;

/** Walkable cells reachable from `from`, 4-connected. */
function reachable(r: ReturnType<typeof room>, from: { x: number; y: number }) {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const c = stack.pop()!;
    const key = `${c.x},${c.y}`;
    if (seen.has(key) || c.x < 0 || c.y < 0 || c.x >= r.width || c.y >= r.height) continue;
    if (r.tiles[c.y][c.x] !== 'floor') continue;
    seen.add(key);
    stack.push({ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 });
  }
  return seen;
}

describe('generateRoom terrain', () => {
  it('keeps every door and every floor cell mutually reachable', () => {
    const doorSets = [ALL_DOORS, ['left'], ['up', 'right'], ['down', 'left', 'right']] as const;
    for (let seed = 0; seed < 500; seed++) {
      for (const doors of doorSets) {
        const r = room(seed, doors);
        const seen = reachable(r, r.doors[0].cell);
        for (const d of r.doors) expect(seen.has(`${d.cell.x},${d.cell.y}`), `seed ${seed} door ${d.side}`).toBe(true);
        expect(seen.size, `seed ${seed} doors ${doors}`).toBe(count(r, 'floor'));
      }
    }
  });

  it('leaves the start room free of terrain', () => {
    for (let seed = 0; seed < 40; seed++) {
      const start = generateRoom({ id: '0,0', kind: 'start', doors: ['up'] }, 0, createRng(seed));
      expect(count(start, 'floor')).toBe(13 * 7);
    }
  });

  it('is identical for the same seed', () => {
    expect(room(9)).toEqual(room(9));
  });

  it('places obstacles and holes that vary between seeds', () => {
    const rooms = Array.from({ length: 40 }, (_, seed) => room(seed));
    expect(rooms.filter((r) => count(r, 'obstacle') > 0).length).toBeGreaterThan(20);
    expect(rooms.filter((r) => count(r, 'hole') > 0).length).toBeGreaterThan(10);
    expect(new Set(rooms.map((r) => JSON.stringify(r.tiles))).size).toBeGreaterThan(30);
  });
});

describe('generateRoom worm boss arena (floor 1)', () => {
  const arena = (seed: number) =>
    generateRoom(
      { id: '0,0', kind: 'boss', doors: [{ side: 'up', at: { x: 0, y: 0 } }, { side: 'right', at: { x: 1, y: 1 } }] },
      0,
      createRng(seed),
    );

  it('is a labyrinth that differs per seed', () => {
    const arenas = Array.from({ length: 30 }, (_, seed) => arena(seed));
    for (const a of arenas) expect(count(a, 'obstacle')).toBeGreaterThan(26 * 14 * 0.15);
    expect(new Set(arenas.map((a) => JSON.stringify(a.tiles))).size).toBe(30);
  });

  it('places exactly one worm boss as a long chain on valid cells away from the doors', () => {
    for (let seed = 0; seed < 200; seed++) {
      const a = arena(seed);
      expect(a.enemies.map((e) => e.type), `seed ${seed}`).toEqual(['wormBoss']);
      const chain = [a.enemies[0].cell, ...(a.enemies[0].tail ?? [])];
      expect(chain.length).toBeGreaterThanOrEqual(6);
      expect(new Set(chain.map((c) => `${c.x},${c.y}`)).size).toBe(chain.length);
      chain.forEach((c, i) => {
        expect(a.tiles[c.y][c.x], `seed ${seed}`).toBe('floor');
        for (const d of a.doors) expect(Math.abs(d.cell.x - c.x) + Math.abs(d.cell.y - c.y), `seed ${seed}`).toBeGreaterThan(3);
        if (i > 0) expect(Math.abs(c.x - chain[i - 1].x) + Math.abs(c.y - chain[i - 1].y)).toBe(1);
      });
    }
  });

  it('keeps every door and floor cell connected, with no one-wide dead ends', () => {
    for (let seed = 0; seed < 300; seed++) {
      const a = arena(seed);
      const seen = reachable(a, a.doors[0].cell);
      expect(seen.size, `seed ${seed}`).toBe(count(a, 'floor'));
      for (const d of a.doors) expect(seen.has(`${d.cell.x},${d.cell.y}`), `seed ${seed}`).toBe(true);
      a.tiles.forEach((row, y) =>
        row.forEach((tile, x) => {
          if (tile !== 'floor') return;
          const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => a.tiles[y + dy]?.[x + dx] === 'floor');
          expect(open.length, `seed ${seed} at ${x},${y}`).toBeGreaterThanOrEqual(2);
        }),
      );
    }
  });
});

describe('generateRoom enemies', () => {
  it('spawns enemies in normal rooms but never in the start room', () => {
    const rooms = Array.from({ length: 40 }, (_, seed) => room(seed));
    expect(rooms.every((r) => r.enemies.length > 0)).toBe(true);
    const start = generateRoom({ id: '0,0', kind: 'start', doors: ['up'] }, 0, createRng(1));
    expect(start.enemies).toEqual([]);
  });

  it('spawns only on distinct, reachable floor cells that are not next to a door', () => {
    const doorSets = [ALL_DOORS, ['left'], ['up', 'right']] as const;
    for (const floorIndex of [0, 1, 2]) {
      for (let seed = 0; seed < 300; seed++) {
        for (const doors of doorSets) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          const seen = reachable(r, r.doors[0].cell);
          const cells = r.enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])]);
          for (const c of cells) {
            const where = `floor ${floorIndex} seed ${seed} doors ${doors} at ${c.x},${c.y}`;
            expect(r.tiles[c.y]?.[c.x], where).toBe('floor');
            expect(seen.has(`${c.x},${c.y}`), where).toBe(true);
            for (const d of r.doors) {
              const near = Math.abs(d.cell.x - c.x) <= 1 && Math.abs(d.cell.y - c.y) <= 1;
              expect(near, `${where} near door ${d.side}`).toBe(false);
            }
          }
          expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(cells.length);
        }
      }
    }
  });

  it('spawns worms from floor 2 as a contiguous chain of cells', () => {
    let worms = 0;
    for (let seed = 0; seed < 200; seed++) {
      const r = generateRoom({ id: '0,0', kind: 'normal', doors: ['left'] }, 1, createRng(seed));
      for (const w of r.enemies.filter((e) => e.type === 'worm')) {
        worms++;
        const chain = [w.cell, ...(w.tail ?? [])];
        expect(chain.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < chain.length; i++) {
          expect(Math.abs(chain[i].x - chain[i - 1].x) + Math.abs(chain[i].y - chain[i - 1].y)).toBe(1);
        }
      }
    }
    expect(worms).toBeGreaterThan(20);
  });
});

describe('generateRoom hive turret arena (floor 2)', () => {
  const arena = (seed: number) =>
    generateRoom(
      { id: '0,0', kind: 'boss', doors: [{ side: 'left', at: { x: 0, y: 1 } }, { side: 'down', at: { x: 1, y: 1 } }] },
      1,
      createRng(seed),
    );

  it('has cover obstacles and stays fully connected', () => {
    for (let seed = 0; seed < 300; seed++) {
      const a = arena(seed);
      expect(count(a, 'obstacle'), `seed ${seed}`).toBeGreaterThanOrEqual(8);
      const seen = reachable(a, a.doors[0].cell);
      expect(seen.size, `seed ${seed}`).toBe(count(a, 'floor'));
      for (const d of a.doors) expect(seen.has(`${d.cell.x},${d.cell.y}`), `seed ${seed}`).toBe(true);
    }
  });

  it('puts the hive core on floor cells in the middle, with valid summon points for its zombies', () => {
    for (let seed = 0; seed < 300; seed++) {
      const a = arena(seed);
      expect(a.enemies.map((e) => e.type), `seed ${seed}`).toEqual(['hiveBoss']);
      const core = a.enemies[0].cell;
      expect(Math.abs(core.x + 0.5 - 12.5)).toBeLessThanOrEqual(2);
      expect(Math.abs(core.y + 0.5 - 6.5)).toBeLessThanOrEqual(2);
      const coreCells = [0, 1].flatMap((dx) => [0, 1].map((dy) => ({ x: core.x + dx, y: core.y + dy })));
      for (const c of coreCells) expect(a.tiles[c.y][c.x], `seed ${seed}`).toBe('floor');

      const seen = reachable(a, a.doors[0].cell);
      expect(a.summonPoints.length).toBeGreaterThanOrEqual(6);
      for (const p of a.summonPoints) {
        expect(seen.has(`${p.x},${p.y}`), `seed ${seed}`).toBe(true);
        expect(coreCells.some((c) => c.x === p.x && c.y === p.y), `seed ${seed}`).toBe(false);
        for (const d of a.doors) expect(Math.abs(d.cell.x - p.x) > 1 || Math.abs(d.cell.y - p.y) > 1, `seed ${seed}`).toBe(true);
      }
    }
  });
});

describe('generateRoom shadow arena (floor 3)', () => {
  const arena = (seed: number) =>
    generateRoom({ id: '0,0', kind: 'boss', doors: [{ side: 'up', at: { x: 1, y: 0 } }] }, 2, createRng(seed));

  it('has pillars and stays fully connected', () => {
    for (let seed = 0; seed < 300; seed++) {
      const a = arena(seed);
      expect(count(a, 'obstacle'), `seed ${seed}`).toBeGreaterThanOrEqual(6);
      const seen = reachable(a, a.doors[0].cell);
      expect(seen.size, `seed ${seed}`).toBe(count(a, 'floor'));
    }
  });

  it('is not point-symmetric, so pillars block the mirrored shadow differently from the player', () => {
    const symmetric = Array.from({ length: 100 }, (_, seed) => arena(seed)).filter((a) =>
      a.tiles.every((row, y) => row.every((t, x) => t === a.tiles[a.height - 1 - y][a.width - 1 - x])),
    );
    expect(symmetric.length).toBeLessThan(5);
  });

  it('places the shadow on a floor cell mirrored across the room from the entrance', () => {
    for (let seed = 0; seed < 300; seed++) {
      const a = arena(seed);
      expect(a.enemies.map((e) => e.type), `seed ${seed}`).toEqual(['shadowBoss']);
      const s = a.enemies[0].cell;
      expect(a.tiles[s.y][s.x], `seed ${seed}`).toBe('floor');
      // The entrance is on the top wall, so the shadow starts in the bottom half.
      expect(s.y, `seed ${seed}`).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('generateRoom enemy mix per floor', () => {
  const sample = (floorIndex: number) =>
    Array.from({ length: 600 }, (_, seed) =>
      generateRoom({ id: '0,0', kind: 'normal', doors: ['left', 'right'] }, floorIndex, createRng(seed)).enemies,
    );
  const share = (rooms: ReturnType<typeof sample>, types: string[]) => {
    const all = rooms.flat();
    return all.filter((e) => types.includes(e.type)).length / all.length;
  };

  it('floor 1 has only zombies and turrets', () => {
    const types = new Set(sample(0).flat().map((e) => e.type));
    expect([...types].sort()).toEqual(['turret', 'zombie']);
  });

  it('floor 2 adds worms', () => {
    expect(sample(1).flat().some((e) => e.type === 'worm')).toBe(true);
  });

  it('floor 3 skews toward worms and turrets', () => {
    expect(share(sample(2), ['worm', 'turret'])).toBeGreaterThan(share(sample(1), ['worm', 'turret']) + 0.1);
    expect(share(sample(2), ['worm', 'turret'])).toBeGreaterThan(0.6);
  });

  it('has more enemies per room on each later floor', () => {
    const mean = (floorIndex: number) => sample(floorIndex).reduce((sum, r) => sum + r.length, 0) / 600;
    expect(mean(1)).toBeGreaterThan(mean(0) + 0.3);
    expect(mean(2)).toBeGreaterThan(mean(1) + 0.3);
  });
});

describe('generateRoom pickups', () => {
  it('rolls pickups in some rooms, on reachable floor cells no enemy or other pickup uses', () => {
    let withPickups = 0;
    for (let seed = 0; seed < 400; seed++) {
      const r = room(seed);
      if (r.pickups.length) withPickups++;
      const seen = reachable(r, r.doors[0].cell);
      const taken = new Set(r.enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])]).map((c) => `${c.x},${c.y}`));
      for (const p of r.pickups) {
        const key = `${p.cell.x},${p.cell.y}`;
        expect(r.tiles[p.cell.y][p.cell.x], `seed ${seed}`).toBe('floor');
        expect(seen.has(key), `seed ${seed}`).toBe(true);
        expect(taken.has(key), `seed ${seed} ${key}`).toBe(false);
        taken.add(key);
      }
    }
    expect(withPickups).toBeGreaterThan(80);
    expect(withPickups).toBeLessThan(320);
  });

  it('never puts pickups in the start room', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(generateRoom({ id: '0,0', kind: 'start', doors: ['up'] }, 0, createRng(seed)).pickups).toEqual([]);
    }
  });

  it('fills chests at generation: unlocked with 1-3 hearts/keys, locked with 2-3 pickups', () => {
    const chests = Array.from({ length: 2000 }, (_, seed) => room(seed).pickups)
      .flat()
      .filter((p) => p.type === 'chest' || p.type === 'lockedChest');
    expect(chests.some((c) => c.type === 'chest')).toBe(true);
    expect(chests.some((c) => c.type === 'lockedChest')).toBe(true);
    for (const c of chests) {
      const holdsPassive = c.contents!.some((item) => item.type === 'passive');
      if (c.type === 'lockedChest' && holdsPassive) {
        expect(c.contents).toHaveLength(1);
        continue;
      }
      const n = c.contents!.length;
      if (c.type === 'chest') expect(n).toBeGreaterThanOrEqual(1);
      else expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
      for (const item of c.contents!) expect(['heart', 'key']).toContain(item.type);
    }
  });

  it('locked chests hold a passive item about 35% of the time', () => {
    const locked = Array.from({ length: 4000 }, (_, seed) => room(seed).pickups)
      .flat()
      .filter((p) => p.type === 'lockedChest');
    const share = locked.filter((c) => c.contents!.some((i) => i.type === 'passive')).length / locked.length;
    expect(locked.length).toBeGreaterThan(100);
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.45);
  });

  it('always puts one passive item, and nothing else, in the item room', () => {
    for (let seed = 0; seed < 100; seed++) {
      const r = generateRoom({ id: '0,0', kind: 'item', doors: ['left'] }, 0, createRng(seed));
      expect(r.enemies).toEqual([]);
      expect(r.pickups.map((p) => p.type)).toEqual(['passive']);
      expect(['homing', 'fireRate', 'sword']).toContain(r.pickups[0].passive);
      const c = r.pickups[0].cell;
      expect(r.tiles[c.y][c.x]).toBe('floor');
    }
  });
});

describe('generateRoom', () => {
  it('builds a 13x7 normal room with a door on each connected side', () => {
    const room = generateRoom({ id: '0,0', kind: 'normal', doors: ['left', 'up'] }, 0, createRng(1));
    expect(room.width).toBe(13);
    expect(room.height).toBe(7);
    expect(room.tiles).toHaveLength(7);
    expect(room.tiles.every((row) => row.length === 13)).toBe(true);
    expect(room.doors.map((d) => d.side).sort()).toEqual(['left', 'up']);
  });

  it('builds a 26x14 boss room with doors lined up with the map cell they open from', () => {
    const boss = generateRoom(
      {
        id: '0,0',
        kind: 'boss',
        doors: [
          { side: 'left', at: { x: 0, y: 1 } },
          { side: 'up', at: { x: 1, y: 0 } },
        ],
      },
      0,
      createRng(1),
    );
    expect(boss.width).toBe(26);
    expect(boss.height).toBe(14);
    // A 2x2 block is 30x18 tiles; the 26x14 interior sits 2 tiles in, and doors line up with
    // the centre of the neighbouring 15x9-tile cell (column 7 / row 4 of that cell).
    expect(boss.doors.find((d) => d.side === 'left')?.cell).toEqual({ x: 0, y: 9 + 4 - 2 });
    expect(boss.doors.find((d) => d.side === 'up')?.cell).toEqual({ x: 15 + 7 - 2, y: 0 });
  });

  it('places doors at the middle of their wall', () => {
    const room = generateRoom(
      { id: '0,0', kind: 'normal', doors: ['up', 'down', 'left', 'right'] },
      0,
      createRng(1),
    );
    const at = (side: string) => room.doors.find((d) => d.side === side)?.cell;
    expect(at('up')).toEqual({ x: 6, y: 0 });
    expect(at('down')).toEqual({ x: 6, y: 6 });
    expect(at('left')).toEqual({ x: 0, y: 3 });
    expect(at('right')).toEqual({ x: 12, y: 3 });
  });
});
