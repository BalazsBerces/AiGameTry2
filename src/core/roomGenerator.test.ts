import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { ARCHETYPES } from './archetypes';
import { ENEMY_CLASS } from './enemies';
import { generateRoom, WORM_LENGTH } from './roomGenerator';

const ALL_DOORS = ['up', 'down', 'left', 'right'] as const;
const room = (seed: number, doors: readonly (typeof ALL_DOORS)[number][] = ALL_DOORS) =>
  generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, 0, createRng(seed));
const count = (r: ReturnType<typeof room>, tile: string) => r.tiles.flat().filter((t) => t === tile).length;

/**
 * Walkable cells reachable from `from`, 4-connected. `rocksBroken` walks through rocks as if
 * shot away; `crossHoles` also crosses holes, the way shots do.
 */
function reachable(r: ReturnType<typeof room>, from: { x: number; y: number }, rocksBroken = false, crossHoles = false) {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const c = stack.pop()!;
    const key = `${c.x},${c.y}`;
    if (seen.has(key) || c.x < 0 || c.y < 0 || c.x >= r.width || c.y >= r.height) continue;
    const tile = r.tiles[c.y][c.x];
    if (tile !== 'floor' && !(rocksBroken && tile === 'rock') && !(crossHoles && tile === 'hole')) continue;
    seen.add(key);
    stack.push({ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 });
  }
  return seen;
}

describe('generateRoom terrain', () => {
  it('keeps every door reachable, and every floor cell once rocks are broken or holes crossed', () => {
    const doorSets = [ALL_DOORS, ['left'], ['up', 'right'], ['down', 'left', 'right']] as const;
    for (let seed = 0; seed < 500; seed++) {
      for (const doors of doorSets) {
        const r = room(seed, doors);
        const seen = reachable(r, r.doors[0].cell);
        for (const d of r.doors) expect(seen.has(`${d.cell.x},${d.cell.y}`), `seed ${seed} door ${d.side}`).toBe(true);
        const opened = reachable(r, r.doors[0].cell, true, true);
        expect(opened.size, `seed ${seed} doors ${doors}`).toBe(count(r, 'floor') + count(r, 'rock') + count(r, 'hole'));
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

  it('spawns only on distinct floor cells, not next to a door, that walkers can walk to and turrets be shot across holes', () => {
    const doorSets = [ALL_DOORS, ['left'], ['up', 'right']] as const;
    for (const floorIndex of [0, 1, 2]) {
      for (let seed = 0; seed < 300; seed++) {
        for (const doors of doorSets) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          const walk = reachable(r, r.doors[0].cell);
          const shoot = reachable(r, r.doors[0].cell, false, true);
          const cells = r.enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])].map((c) => ({ c, turret: ENEMY_CLASS[e.type] === 'stationary' })));
          for (const { c, turret } of cells) {
            const where = `floor ${floorIndex} seed ${seed} doors ${doors} at ${c.x},${c.y}`;
            expect(r.tiles[c.y]?.[c.x], where).toBe('floor');
            expect((turret ? shoot : walk).has(`${c.x},${c.y}`), where).toBe(true);
            for (const d of r.doors) {
              const near = Math.abs(d.cell.x - c.x) <= 1 && Math.abs(d.cell.y - c.y) <= 1;
              expect(near, `${where} near door ${d.side}`).toBe(false);
            }
          }
          expect(new Set(cells.map(({ c }) => `${c.x},${c.y}`)).size).toBe(cells.length);
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

  it('floor 1 (forest) has only goblins and seed-spitters, and both of them', () => {
    const types = new Set(sample(0).flat().map((e) => e.type));
    expect([...types].sort()).toEqual(['goblin', 'seedSpitter']);
  });

  it('floor 2 adds worms', () => {
    expect(sample(1).flat().some((e) => e.type === 'worm')).toBe(true);
  });

  it('floor 3 skews toward worms and turrets', () => {
    expect(share(sample(2), ['worm', 'turret'])).toBeGreaterThan(share(sample(1), ['worm', 'turret']) + 0.1);
    expect(share(sample(2), ['worm', 'turret'])).toBeGreaterThan(0.6);
  });

  it('asks for more damage to clear a room on each later floor', () => {
    // Hit points: zombie 3, turret 4, worm 4 segments of 2, goblin 3, seed-spitter 4.
    const HP: Record<string, number> = { zombie: 3, turret: 4, worm: 8, goblin: 3, seedSpitter: 4 };
    const mean = (floorIndex: number) =>
      sample(floorIndex).reduce((sum, r) => sum + r.reduce((s, e) => s + HP[e.type], 0), 0) / 600;
    expect(mean(1)).toBeGreaterThan(mean(0) + 1);
    expect(mean(2)).toBeGreaterThan(mean(1) + 1);
  });
});

describe('generateRoom pickups', () => {
  it('rolls pickups in some rooms, on reachable floor cells no enemy or other pickup uses', () => {
    let withPickups = 0;
    for (let seed = 0; seed < 400; seed++) {
      const r = room(seed);
      if (r.pickups.length) withPickups++;
      const seen = reachable(r, r.doors[0].cell, true);
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

  it('puts the room-clear drop in the middle of the room when the middle is free', () => {
    const drops = ['pillaredHall', 'fourCorners']
      .flatMap((archetype) =>
        Array.from({ length: 100 }, (_, seed) =>
          generateRoom({ id: '0,0', kind: 'normal', doors: [...ALL_DOORS], archetype }, 0, createRng(seed)).pickups,
        ),
      )
      .flat();
    expect(drops.length).toBeGreaterThan(40);
    for (const p of drops) expect(p.cell).toEqual({ x: 6, y: 3 });
  });

  it('never puts pickups in the start room', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(generateRoom({ id: '0,0', kind: 'start', doors: ['up'] }, 0, createRng(seed)).pickups).toEqual([]);
    }
  });

  it('fills chests at generation: unlocked with 1-3 hearts/keys/bombs, locked with 2-3 pickups', () => {
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
      for (const item of c.contents!) expect(['heart', 'key', 'bomb']).toContain(item.type);
    }
  });

  it('includes bombs among room-clear drops and chest contents', () => {
    const pickups = Array.from({ length: 1500 }, (_, seed) => room(seed).pickups).flat();
    expect(pickups.some((p) => p.type === 'bomb')).toBe(true);
    expect(pickups.flatMap((p) => p.contents ?? []).some((item) => item.type === 'bomb')).toBe(true);
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

describe('The Stash (floor 1 puzzle)', () => {
  const stash = (seed: number, doors: readonly (typeof ALL_DOORS)[number][] = ALL_DOORS) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'stash' }, 0, createRng(seed));
  const walkable = (r: ReturnType<typeof room>, breakRocks: boolean) => ({
    ...r,
    tiles: r.tiles.map((row) => row.map((t) => (breakRocks && t === 'rock' ? 'floor' : t))),
  });

  it('shows a chest from the start that only breaking rocks can reach', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const doors of [ALL_DOORS, ['left'], ['up', 'right']] as const) {
        const r = stash(seed, doors);
        expect(r.archetype).toBe('stash');
        const chests = r.pickups.filter((p) => p.visible);
        expect(chests.map((p) => p.type), `seed ${seed}`).toEqual(['chest']);
        const at = `${chests[0].cell.x},${chests[0].cell.y}`;
        expect(reachable(walkable(r, false), r.doors[0].cell).has(at), `seed ${seed}`).toBe(false);
        expect(reachable(walkable(r, true), r.doors[0].cell).has(at), `seed ${seed}`).toBe(true);
        expect(r.enemies.every((e) => e.type === 'goblin')).toBe(true);
        expect(r.enemies).toHaveLength(2);
      }
    }
  });
});

const SIDES = ['up', 'down', 'left', 'right'] as const;
const EVERY_DOOR_SET = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((m) => SIDES.filter((_, i) => m & (1 << i)));
const STEP_OF = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } } as const;

describe('The Jar (floor 1)', () => {
  const jar = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'jar' }, 0, createRng(seed));

  it('is a goblin den: 4-5 goblins behind a single opening that never faces a door', () => {
    let built = 0;
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 40; seed++) {
        const r = jar(seed, doors);
        if (r.archetype !== 'jar') continue; // the jar can't fit this door set
        built++;
        const where = `seed ${seed} doors ${doors}`;
        expect(r.enemies.every((e) => e.type === 'goblin'), where).toBe(true);
        expect(r.enemies.length, where).toBeGreaterThanOrEqual(4);
        expect(r.enemies.length, where).toBeLessThanOrEqual(5);
        // Some single floor cell, once blocked, cuts every zombie off from the doors: the opening.
        const outsideWith = (x: number, y: number) =>
          reachable({ ...r, tiles: r.tiles.map((row, yy) => row.map((tt, xx) => (xx === x && yy === y ? 'obstacle' : tt))) }, r.doors[0].cell);
        const isDoor = (x: number, y: number) => r.doors.some((d) => d.cell.x === x && d.cell.y === y);
        // (The tile just outside it can be a chokepoint too; the opening is the one nearest the horde.)
        const toHorde = (x: number, y: number) => Math.min(...r.enemies.map((e) => Math.abs(e.cell.x - x) + Math.abs(e.cell.y - y)));
        const opening = r.tiles
          .flatMap((row, y) => row.map((t, x) => ({ t, x, y })))
          .filter(({ t, x, y }) => {
            const seen = t === 'floor' && !isDoor(x, y) ? outsideWith(x, y) : undefined;
            return !!seen && r.enemies.every((e) => !seen.has(`${e.cell.x},${e.cell.y}`));
          })
          .sort((a, b) => toHorde(a.x, a.y) - toHorde(b.x, b.y))[0];
        expect(opening, where).toBeDefined();
        // It faces the side whose neighbour is outside the jar.
        const outside = outsideWith(opening!.x, opening!.y);
        const facing = SIDES.find((s) => outside.has(`${opening!.x + STEP_OF[s].x},${opening!.y + STEP_OF[s].y}`));
        expect(facing, where).toBeDefined();
        expect(doors, where).not.toContain(facing);
      }
    }
    expect(built).toBeGreaterThan(200);
  });
});

describe('Sentry Island (floor 1)', () => {
  it('puts two seed-spitters on an island nobody can walk to', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'sentryIsland' }, 0, createRng(seed));
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('sentryIsland');
        expect(r.enemies.map((e) => e.type), where).toEqual(['seedSpitter', 'seedSpitter']);
        const seen = reachable(r, r.doors[0].cell);
        for (const e of r.enemies) expect(seen.has(`${e.cell.x},${e.cell.y}`), where).toBe(false);
        expect(count(r, 'hole'), where).toBeGreaterThan(0);
      }
    }
  });
});

describe('every archetype', () => {
  const ROSTER = [['goblin', 'seedSpitter'], ['zombie', 'turret', 'worm'], ['zombie', 'turret', 'worm']];

  it('builds its own idea for every door set it fits: deterministic, varied, within its floor roster', () => {
    for (const a of ARCHETYPES) {
      const layouts = new Set<string>();
      for (const doors of EVERY_DOOR_SET.filter((d) => a.fits(d))) {
        for (let seed = 0; seed < 25; seed++) {
          const spec = { id: '0,0', kind: a.kind, doors: [...doors], archetype: a.id };
          const r = generateRoom(spec, a.floor, createRng(seed));
          const where = `${a.id} seed ${seed} doors ${doors}`;
          expect(r.archetype, where).toBe(a.id);
          expect(generateRoom(spec, a.floor, createRng(seed)), where).toEqual(r);
          for (const e of r.enemies) expect(ROSTER[a.floor], where).toContain(e.type);
          for (const w of r.enemies.filter((e) => e.type === 'worm')) {
            const chain = [w.cell, ...(w.tail ?? [])];
            expect(chain, where).toHaveLength(WORM_LENGTH);
            for (let i = 1; i < chain.length; i++) {
              expect(Math.abs(chain[i].x - chain[i - 1].x) + Math.abs(chain[i].y - chain[i - 1].y), where).toBe(1);
            }
          }
          layouts.add(JSON.stringify([r.tiles, r.enemies]));
        }
      }
      expect(layouts.size, a.id).toBeGreaterThan(3);
    }
  });

  it.each([
    [1, ['jar', 'fourCorners', 'pillaredHall', 'sentryIsland', 'stash']],
    [2, ['courtyard', 'gallery', 'serpentGarden', 'track', 'twinJars', 'vault']],
    [3, ['crossfire', 'fortress', 'killbox', 'minefield', 'nest', 'ruins']],
  ])('gives floor %i its own set of ideas, one of them a breather that fits every door set', (floor, ids) => {
    const own = ARCHETYPES.filter((a) => a.floor === floor - 1 && a.kind === 'normal');
    expect(own.map((a) => a.id).sort()).toEqual([...ids].sort());
    expect(own.some((a) => a.breather && EVERY_DOOR_SET.every((d) => a.fits(d)))).toBe(true);
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 10; seed++) {
        const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floor - 1, createRng(seed));
        expect(ids).toContain(r.archetype);
      }
    }
  });
});

describe('item room showcases', () => {
  it('frame a lone passive in the middle of the room, in a style of the floor’s own', () => {
    const styles: string[][] = [[], [], []];
    for (const floorIndex of [0, 1, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 10; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'item', doors: [...doors] }, floorIndex, createRng(seed));
          const where = `floor ${floorIndex + 1} seed ${seed} doors ${doors}`;
          expect(r.archetype, where).toBeDefined();
          styles[floorIndex].push(r.archetype!);
          expect(r.enemies, where).toEqual([]);
          expect(r.pickups.map((p) => p.type), where).toEqual(['passive']);
          expect(r.pickups[0].cell, where).toEqual({ x: 6, y: 3 });
          expect(reachable(r, r.doors[0].cell).has('6,3'), where).toBe(true);
          expect(count(r, 'floor'), where).toBeLessThan(13 * 7);
        }
      }
    }
    const [f1, f2, f3] = styles.map((s) => new Set(s));
    for (const id of f1) expect(f2.has(id) || f3.has(id)).toBe(false);
    for (const id of f2) expect(f3.has(id)).toBe(false);
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
