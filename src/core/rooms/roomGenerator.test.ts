import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { ARCHETYPES, supportsShape } from './archetypes';
import { ENEMY_CLASS } from '../enemies/enemies';
import { generateRoom, WORM_LENGTH, type DoorSpec, type RoomLayout } from './roomGenerator';
import { createWorld } from '../map/world';
import { AXIS_DIRECTIONS, slideCrusher } from '../obstacles/crusher';
import { validateRoom } from './roomValidator';
import { GLOWSHROOM_RADIUS } from '../obstacles/glowshroom';
import { themeForFloor } from '../map/themes';
import { candleCells } from '../bosses/candleWitch';

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

describe('bosses per floor across whole runs', () => {
  const worlds = Array.from({ length: 40 }, (_, seed) => createWorld(seed));

  const bossesOf = (world: (typeof worlds)[number]) =>
    [...world.rooms.values()]
      .filter((r) => r.floorRoom.kind === 'boss')
      .sort((a, b) => a.floorIndex - b.floorIndex)
      .map((r) => r.layout.enemies.map((e) => e.type));

  it("puts the Treant on floor 1, the Worm boss on floor 2 and one of floor 3's pool on floor 3", () => {
    for (const world of worlds) {
      const [first, second, third] = bossesOf(world);
      expect([first, second], `seed ${world.seed}`).toEqual([['treantBoss'], ['wormBoss']]);
      expect(third.length, `seed ${world.seed}`).toBe(1);
      expect(themeForFloor(2).bosses, `seed ${world.seed}`).toContain(third[0]);
    }
  });

  it('meets the same floor 3 boss again on the same seed', () => {
    for (const seed of [0, 1, 2, 3, 4]) expect(bossesOf(createWorld(seed))).toEqual(bossesOf(worlds[seed]));
  });

  it('never spawns the retired Hive anywhere', () => {
    for (const world of worlds) {
      const types: string[] = [...world.rooms.values()].flatMap((r) => r.layout.enemies.map((e) => e.type));
      expect(types, `seed ${world.seed}`).not.toContain('hiveBoss');
    }
  });

  it('keeps every boss arena connected: all doors and floor cells reachable', () => {
    for (const world of worlds) {
      for (const r of [...world.rooms.values()].filter((r) => r.floorRoom.kind === 'boss')) {
        const a = r.layout;
        const seen = reachable(a, a.doors[0].cell);
        const where = `seed ${world.seed} floor ${r.floorIndex}`;
        expect(seen.size, where).toBe(count(a, 'floor'));
        for (const d of a.doors) expect(seen.has(`${d.cell.x},${d.cell.y}`), where).toBe(true);
      }
    }
  });
});

describe('generateRoom treant arena at the cave mouth (floor 1)', () => {
  const arena = (seed: number) =>
    generateRoom({ id: '0,0', kind: 'boss', doors: [{ side: 'left', at: { x: 0, y: 1 } }] }, 0, createRng(seed));

  it('is ringed by cave rock that differs per seed, with an open middle to dodge roots in', () => {
    const arenas = Array.from({ length: 30 }, (_, seed) => arena(seed));
    for (const a of arenas) {
      expect(count(a, 'obstacle')).toBeGreaterThanOrEqual(12);
      for (let y = 4; y < a.height - 4; y++) for (let x = 7; x < a.width - 7; x++) expect(a.tiles[y][x]).toBe('floor');
    }
    expect(new Set(arenas.map((a) => JSON.stringify(a.tiles))).size).toBe(30);
  });

  it('places exactly one treant on open floor across the room from the entrance', () => {
    for (let seed = 0; seed < 200; seed++) {
      const a = arena(seed);
      expect(a.enemies.map((e) => e.type), `seed ${seed}`).toEqual(['treantBoss']);
      const t = a.enemies[0].cell;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) expect(a.tiles[t.y + dy]?.[t.x + dx], `seed ${seed}`).toBe('floor');
      // The entrance is on the left wall, so the treant waits in the right half.
      expect(t.x, `seed ${seed}`).toBeGreaterThanOrEqual(a.width / 2);
    }
  });
});

describe('generateRoom worm boss arena (floor 2)', () => {
  const arena = (seed: number) =>
    generateRoom(
      { id: '0,0', kind: 'boss', doors: [{ side: 'up', at: { x: 0, y: 0 } }, { side: 'right', at: { x: 1, y: 1 } }] },
      1,
      createRng(seed),
    );

  it('is a labyrinth of breakable rock that differs per seed', () => {
    const arenas = Array.from({ length: 30 }, (_, seed) => arena(seed));
    for (const a of arenas) {
      expect(count(a, 'rock')).toBeGreaterThan(26 * 14 * 0.15);
      expect(count(a, 'obstacle')).toBe(0);
    }
    expect(new Set(arenas.map((a) => JSON.stringify(a.tiles))).size).toBe(30);
  });

  it('places exactly one worm boss, twenty-three segments long, on valid cells away from the doors', () => {
    for (let seed = 0; seed < 200; seed++) {
      const a = arena(seed);
      expect(a.enemies.map((e) => e.type), `seed ${seed}`).toEqual(['wormBoss']);
      const chain = [a.enemies[0].cell, ...(a.enemies[0].tail ?? [])];
      expect(chain.length, `seed ${seed}`).toBe(23);
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

  it('spawns only on distinct floor cells, not next to a door, that walkers can walk to and turrets and flyers be shot across holes', () => {
    const doorSets = [ALL_DOORS, ['left'], ['up', 'right']] as const;
    for (const floorIndex of [0, 1, 2]) {
      for (let seed = 0; seed < 300; seed++) {
        for (const doors of doorSets) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          const walk = reachable(r, r.doors[0].cell);
          const shoot = reachable(r, r.doors[0].cell, false, true);
          const cells = r.enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])].map((c) => ({ c, kind: ENEMY_CLASS[e.type] })));
          for (const { c, kind } of cells) {
            const where = `floor ${floorIndex} seed ${seed} doors ${doors} at ${c.x},${c.y}`;
            expect(r.tiles[c.y]?.[c.x], where).toBe('floor');
            // Ghosts drift through anything, so they may start where nobody can walk or shoot.
            if (kind !== 'phasing') expect((kind === 'walker' ? walk : shoot).has(`${c.x},${c.y}`), where).toBe(true);
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

  it('keeps worms out of 1x1 rooms: they only turn up in big ones', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 60; seed++) {
        const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, 1, createRng(seed));
        expect(r.enemies.some((e) => e.type === 'worm'), `seed ${seed} doors ${doors} ${r.archetype}`).toBe(false);
      }
    }
  });
});

describe('generateRoom Iron Maiden arena (floor 3)', () => {
  /** Floor 3 boss rooms on the seeds that drew the Iron Maiden. */
  const arenas = Array.from({ length: 300 }, (_, seed) =>
    generateRoom({ id: '0,0', kind: 'boss', doors: [{ side: 'up', at: { x: 1, y: 0 } }] }, 2, createRng(seed)),
  ).filter((a) => a.enemies[0]?.type === 'ironMaiden');

  it('turns up on floor 3', () => {
    expect(arenas.length).toBeGreaterThan(50);
  });

  it('has pillars for cover and stays fully connected', () => {
    for (const a of arenas) {
      expect(count(a, 'obstacle')).toBeGreaterThanOrEqual(6);
      const seen = reachable(a, a.doors[0].cell);
      expect(seen.size).toBe(count(a, 'floor'));
    }
  });

  it('places exactly one Iron Maiden on a floor cell across the room from the entrance', () => {
    for (const a of arenas) {
      expect(a.enemies.map((e) => e.type)).toEqual(['ironMaiden']);
      const m = a.enemies[0].cell;
      expect(a.tiles[m.y][m.x]).toBe('floor');
      // The entrance is on the top wall, so it starts in the bottom half.
      expect(m.y).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('generateRoom Candle Witch arena (floor 3)', () => {
  const arenas = Array.from({ length: 300 }, (_, seed) =>
    generateRoom({ id: '0,0', kind: 'boss', doors: [{ side: 'up', at: { x: 1, y: 0 } }] }, 2, createRng(seed)),
  ).filter((a) => a.enemies[0]?.type === 'candleWitch');

  it('turns up on floor 3', () => {
    expect(arenas.length).toBeGreaterThan(50);
  });

  it('is open floor, with the candles in its corners', () => {
    for (const a of arenas) {
      expect(count(a, 'floor')).toBe(a.width * a.height);
      for (const c of candleCells(a.width, a.height)) expect(a.tiles[c.y][c.x]).toBe('floor');
    }
  });

  it('floats exactly one witch in the middle of the room', () => {
    for (const a of arenas) {
      expect(a.enemies.map((e) => e.type)).toEqual(['candleWitch']);
      const w = a.enemies[0].cell;
      expect(Math.abs(w.x - (a.width - 1) / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(w.y - (a.height - 1) / 2)).toBeLessThanOrEqual(1);
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

  it('floor 1 (forest) has only goblins, seed-spitters, wasps and boars, and all of them', () => {
    const types = new Set(sample(0).flat().map((e) => e.type));
    expect([...types].sort()).toEqual(['boar', 'goblin', 'seedSpitter', 'wasp']);
  });

  it('floor 2 adds slimes', () => {
    expect(sample(1).flat().some((e) => e.type === 'slime')).toBe(true);
  });

  it('floor 2 (the caves) spawns ghouls, crystal turrets, bats and slimes, and no zombies or plain turrets', () => {
    const types = new Set<string>();
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 60; seed++) {
        for (const e of generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, 1, createRng(seed)).enemies) types.add(e.type);
      }
    }
    expect([...types].sort()).toEqual(['bat', 'crystalTurret', 'ghoul', 'slime']);
  });

  it('floor 3 has no worms or plain turrets, and gargoyles make up a good share of it', () => {
    const types = new Set(sample(2).flat().map((e) => e.type));
    expect(types.has('worm')).toBe(false);
    expect(types.has('turret')).toBe(false);
    expect(share(sample(2), ['gargoyle'])).toBeGreaterThan(0.3);
  });

  it('asks for more damage to clear a room on each later floor', () => {
    // Default hit points: zombie 3, turret 4, worm 4 segments of 2, goblin 3, seed-spitter 4, ghoul 4,
    // crystal turret 4, gargoyle 5, knight 6, a big slime and its brood 3 + 2x2 + 4x1; a spawn's own `hp`
    // (the dungeon's tougher zombies) overrides them.
    const HP: Record<string, number> = {
      zombie: 3, turret: 4, worm: 8, goblin: 3, seedSpitter: 4, ghoul: 4, crystalTurret: 4, gargoyle: 5, knight: 6,
      wasp: 1, boar: 4, ghost: 4, bat: 1, slime: 11,
    };
    const mean = (floorIndex: number) =>
      sample(floorIndex).reduce((sum, r) => sum + r.reduce((s, e) => s + (e.hp ?? HP[e.type]), 0), 0) / 600;
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
      for (const item of c.contents!) expect(['heart', 'key', 'bomb', 'damageUp', 'rateUp']).toContain(item.type);
      expect(c.contents!.filter(isStatUp).length).toBeLessThanOrEqual(1);
    }
  });

  const isStatUp = (item: { type: string }) => item.type === 'damageUp' || item.type === 'rateUp';

  it('swaps one item for a stat-up in about 30% of chests and 65% of locked ones without a passive', () => {
    const chests = Array.from({ length: 4000 }, (_, seed) => room(seed).pickups).flat();
    const share = (type: 'chest' | 'lockedChest') => {
      const pool = chests.filter((p) => p.type === type && !p.contents!.some((i) => i.type === 'passive'));
      expect(pool.length).toBeGreaterThan(100);
      return pool.filter((c) => c.contents!.some(isStatUp)).length / pool.length;
    };
    expect(share('chest')).toBeGreaterThan(0.23);
    expect(share('chest')).toBeLessThan(0.37);
    expect(share('lockedChest')).toBeGreaterThan(0.55);
    expect(share('lockedChest')).toBeLessThan(0.75);
  });

  it('makes chest stat-ups damage ups and fire rate ups about equally often', () => {
    const statUps = Array.from({ length: 4000 }, (_, seed) => room(seed).pickups)
      .flat()
      .flatMap((p) => p.contents ?? [])
      .filter(isStatUp);
    expect(statUps.length).toBeGreaterThan(200);
    const damageShare = statUps.filter((i) => i.type === 'damageUp').length / statUps.length;
    expect(damageShare).toBeGreaterThan(0.4);
    expect(damageShare).toBeLessThan(0.6);
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
      // Which one is decided when the player walks in (see the world's passives tests).
      expect(r.pickups[0].passive).toBeUndefined();
      const c = r.pickups[0].cell;
      expect(r.tiles[c.y][c.x]).toBe('floor');
    }
  });
});

describe('generateRoom champions', () => {
  const normalRooms = () =>
    [0, 1, 2].flatMap((floorIndex) =>
      Array.from({ length: 800 }, (_, seed) => generateRoom({ id: '0,0', kind: 'normal', doors: ['left', 'right'] }, floorIndex, createRng(seed))),
    );

  it('marks a champion in about 15% of normal rooms', () => {
    const rooms = normalRooms();
    const rate = rooms.filter((r) => r.enemies.some((e) => e.champion)).length / rooms.length;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.2);
  });

  it('crowns at most one enemy per room, and every champion carries an extra drop from the room-clear pool', () => {
    for (const r of normalRooms()) {
      const champions = r.enemies.filter((e) => e.champion);
      expect(champions.length).toBeLessThanOrEqual(1);
      for (const c of champions) {
        expect(['heart', 'key', 'bomb', 'chest', 'lockedChest']).toContain(c.champion!.drop.type);
        if (c.champion!.drop.type === 'chest' || c.champion!.drop.type === 'lockedChest') {
          expect(c.champion!.drop.contents?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('can crown any kind of regular enemy', () => {
    const spawned = new Set(normalRooms().flatMap((r) => r.enemies.map((e) => e.type)));
    const crowned = new Set(normalRooms().flatMap((r) => r.enemies.filter((e) => e.champion).map((e) => e.type)));
    expect(spawned.size).toBeGreaterThan(3);
    expect([...crowned].sort()).toEqual([...spawned].sort());
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

/** Every wall slot a door can take in each shape: a side of one of its map cells on the room's edge. */
const DOOR_SLOTS: Record<'1x1' | '2x1' | '1x2' | '2x2', DoorSpec[]> = {
  '1x1': SIDES.map((side) => ({ side, at: { x: 0, y: 0 } })),
  '2x1': [
    { side: 'up', at: { x: 0, y: 0 } }, { side: 'up', at: { x: 1, y: 0 } },
    { side: 'down', at: { x: 0, y: 0 } }, { side: 'down', at: { x: 1, y: 0 } },
    { side: 'left', at: { x: 0, y: 0 } }, { side: 'right', at: { x: 1, y: 0 } },
  ],
  '1x2': [
    { side: 'left', at: { x: 0, y: 0 } }, { side: 'left', at: { x: 0, y: 1 } },
    { side: 'right', at: { x: 0, y: 0 } }, { side: 'right', at: { x: 0, y: 1 } },
    { side: 'up', at: { x: 0, y: 0 } }, { side: 'down', at: { x: 0, y: 1 } },
  ],
  '2x2': [
    { side: 'up', at: { x: 0, y: 0 } }, { side: 'up', at: { x: 1, y: 0 } },
    { side: 'down', at: { x: 0, y: 1 } }, { side: 'down', at: { x: 1, y: 1 } },
    { side: 'left', at: { x: 0, y: 0 } }, { side: 'left', at: { x: 0, y: 1 } },
    { side: 'right', at: { x: 1, y: 0 } }, { side: 'right', at: { x: 1, y: 1 } },
  ],
};
const subsets = <T,>(items: T[]) =>
  Array.from({ length: (1 << items.length) - 1 }, (_, m) => items.filter((_, i) => (m + 1) & (1 << i)));

/** The three cells of each L, named for the cell of the 2x2 block it leaves out. */
const L_CELLS = {
  'L-tl': [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  'L-tr': [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  'L-bl': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  'L-br': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
} as const;
type LShape = keyof typeof L_CELLS;
const L_SHAPES = Object.keys(L_CELLS) as LShape[];
/** An L's door slots: every side of its cells facing out of the 2x2 block (inner sides face the missing cell). */
const lSlots = (shape: LShape): DoorSpec[] =>
  L_CELLS[shape].flatMap((at) =>
    SIDES.filter((side) => {
      const n = { x: at.x + STEP_OF[side].x, y: at.y + STEP_OF[side].y };
      return n.x < 0 || n.y < 0 || n.x > 1 || n.y > 1;
    }).map((side) => ({ side, at })),
  );
/** Interior tiles of the cell an L leaves out: a 13x7 quarter of its 26x14 box. */
const missingQuarter = (shape: LShape) => {
  const out = { x: shape.endsWith('l') ? 0 : 13, y: shape.includes('-t') ? 0 : 7 };
  return (c: { x: number; y: number }) => c.x >= out.x && c.x < out.x + 13 && c.y >= out.y && c.y < out.y + 7;
};

const EVERY_SHAPED_DOOR_SET = {
  '1x1': subsets(DOOR_SLOTS['1x1']),
  '2x1': subsets(DOOR_SLOTS['2x1']),
  '1x2': subsets(DOOR_SLOTS['1x2']),
  '2x2': subsets(DOOR_SLOTS['2x2']),
  ...(Object.fromEntries(L_SHAPES.map((s) => [s, subsets(lSlots(s))])) as Record<LShape, DoorSpec[][]>),
};
const SHAPE_SIZE = {
  '1x1': [13, 7], '2x1': [26, 7], '1x2': [13, 14], '2x2': [26, 14],
  'L-tl': [26, 14], 'L-tr': [26, 14], 'L-bl': [26, 14], 'L-br': [26, 14],
};

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
        const spitters = r.enemies.filter((e) => e.type === 'seedSpitter');
        expect(spitters.length, where).toBe(2);
        const seen = reachable(r, r.doors[0].cell);
        for (const e of spitters) expect(seen.has(`${e.cell.x},${e.cell.y}`), where).toBe(false);
        expect(count(r, 'hole'), where).toBeGreaterThan(0);
      }
    }
  });
});

describe('turret rooms', () => {
  it.each([
    ['sentryIsland', 0, 'goblin', 3, 4],
    ['gallery', 1, 'ghoul', 3, 3],
    ['vault', 1, 'ghoul', 2, 3],
    ['killbox', 2, 'ghost', 2, 3],
    ['crossfire', 2, 'knight', 2, 2],
    ['minefield', 2, 'zombie', 2, 3],
    ['crystalGallery', 1, 'ghoul', 2, 4],
    ['glowshroomCave', 1, 'ghoul', 2, 4],
  ] as const)('%s (floor index %i) backs its turrets with %s', (archetype, floorIndex, type, min, max) => {
    let built = 0;
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 20; seed++) {
        const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype }, floorIndex, createRng(seed));
        if (r.archetype !== archetype) continue; // it can't fit this door set
        built++;
        const where = `seed ${seed} doors ${doors}`;
        const cast = r.enemies.filter((e) => e.type === type).length;
        expect(cast, where).toBeGreaterThanOrEqual(min);
        expect(cast, where).toBeLessThanOrEqual(max);
      }
    }
    expect(built).toBeGreaterThan(50);
  });

  it('never leaves a normal room to turrets alone: something always comes after the player', () => {
    for (const floorIndex of [0, 1, 2]) {
      for (const a of ARCHETYPES.filter((x) => x.floor === floorIndex && x.kind === 'normal')) {
        for (const doors of EVERY_DOOR_SET) {
          for (let seed = 0; seed < 20; seed++) {
            const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: a.id }, floorIndex, createRng(seed));
            if (r.archetype !== a.id || !r.enemies.length) continue;
            const mobile = r.enemies.some((e) => ENEMY_CLASS[e.type] !== 'stationary');
            expect(mobile, `${a.id} seed ${seed} doors ${doors}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('Thorn Maze (floor 1)', () => {
  it('winds hedges through the room, every floor cell walkable, walkers loose among them', () => {
    const layouts = new Set<string>();
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'thornMaze' }, 0, createRng(seed));
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('thornMaze');
        // Mixed hedges: mostly plain bushes, a few thorny ones, never over the thorn cap.
        expect(count(r, 'thorn'), where).toBeGreaterThanOrEqual(1);
        expect(count(r, 'thorn'), where).toBeLessThanOrEqual(4);
        expect(count(r, 'rock'), where).toBeGreaterThan(count(r, 'thorn'));
        // A maze, not a prison: thorns shape the paths but never seal floor away.
        expect(reachable(r, r.doors[0].cell).size, where).toBe(count(r, 'floor'));
        expect(r.enemies.length, where).toBeGreaterThan(0);
        expect(r.enemies.every((e) => e.type === 'goblin'), where).toBe(true);
        layouts.add(JSON.stringify(r.tiles));
      }
    }
    expect(layouts.size).toBeGreaterThan(3);
  });

  it('puts the thorns on the ends of hedges', () => {
    const hedge = (t: string | undefined) => t === 'rock' || t === 'thorn';
    for (let seed = 0; seed < 60; seed++) {
      const r = generateRoom({ id: '0,0', kind: 'normal', doors: ['up', 'down', 'left', 'right'], archetype: 'thornMaze' }, 0, createRng(seed));
      r.tiles.forEach((row, y) =>
        row.forEach((t, x) => {
          if (t !== 'thorn') return;
          const touching = [r.tiles[y - 1]?.[x], r.tiles[y + 1]?.[x], row[x - 1], row[x + 1]].filter(hedge);
          expect(touching.length, `seed ${seed} thorn at ${x},${y}`).toBeLessThanOrEqual(1);
        }),
      );
    }
  });

  it('only grows thorns on floor 1', () => {
    for (const floorIndex of [1, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 10; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          expect(count(r, 'thorn'), `floor ${floorIndex + 1} seed ${seed} doors ${doors}`).toBe(0);
        }
      }
    }
  });
});

describe('Boar Run (floor 1)', () => {
  const run = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'boarRun' }, 0, createRng(seed));
  /** Floor tiles a boar on `c` could dash across along its best axis. */
  const longestRun = (r: ReturnType<typeof run>, c: { x: number; y: number }) =>
    Math.max(
      ...SIDES.map((s) => {
        let n = 0;
        while (r.tiles[c.y + STEP_OF[s].y * (n + 1)]?.[c.x + STEP_OF[s].x * (n + 1)] === 'floor') n++;
        return n;
      }),
    );

  it('lets boars loose on an open run, with rock posts to bait them into, for every door set', () => {
    const layouts = new Set<string>();
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = run(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('boarRun');
        const boars = r.enemies.filter((e) => e.type === 'boar');
        expect(boars.length, where).toBeGreaterThanOrEqual(2);
        for (const b of boars) expect(longestRun(r, b.cell), where).toBeGreaterThanOrEqual(4);
        expect(count(r, 'rock'), where).toBeGreaterThan(0);
        // Every floor tile can be reached: posts stand alone, walling nothing off.
        expect(reachable(r, r.doors[0].cell).size, where).toBe(count(r, 'floor'));
        layouts.add(JSON.stringify([r.tiles, r.enemies]));
      }
    }
    expect(layouts.size).toBeGreaterThan(3);
  });

  it('is the same room for the same seed', () => {
    expect(run(11, ALL_DOORS)).toEqual(run(11, ALL_DOORS));
  });

  it('keeps boars in the forest', () => {
    for (const floorIndex of [1, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 10; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          expect(r.enemies.map((e) => e.type), `floor ${floorIndex + 1} seed ${seed}`).not.toContain('boar');
        }
      }
    }
  });
});

describe('every archetype', () => {
  const ROSTER = [['goblin', 'seedSpitter', 'wasp', 'boar'], ['ghoul', 'crystalTurret', 'slime', 'bat'], ['zombie', 'gargoyle', 'knight', 'ghost']];

  it('builds its own idea for every shape and door set it fits: deterministic, varied, within its floor roster', () => {
    for (const a of ARCHETYPES) {
      const layouts = new Set<string>();
      for (const shape of a.shapes ?? ['1x1' as const]) {
        // Shaped rooms have many more door sets: a few fresh seeds each still covers every one.
        // Big and L rooms have dozens of door sets or more: one fresh seed each is plenty.
        const seeds = shape === '1x1' ? 25 : EVERY_SHAPED_DOOR_SET[shape].length > 60 ? 1 : 3;
        const doorSets = EVERY_SHAPED_DOOR_SET[shape].filter((d) => a.fits(d.map((door) => door.side)));
        for (const [i, doors] of doorSets.entries()) {
          const first = shape === '1x1' ? 0 : i * seeds;
          for (let seed = first; seed < first + seeds; seed++) {
            const spec = { id: '0,0', kind: a.kind, doors: [...doors], archetype: a.id, shape };
            const r = generateRoom(spec, a.floor, createRng(seed));
            const where = `${a.id} ${shape} seed ${seed} doors ${JSON.stringify(doors)}`;
            expect(r.archetype, where).toBe(a.id);
            expect([r.width, r.height], where).toEqual(SHAPE_SIZE[shape]);
            // Not the empty room left when even the fallback keeps failing validation.
            if (a.kind === 'normal') expect(r.enemies.length, where).toBeGreaterThan(0);
            expect(generateRoom(spec, a.floor, createRng(seed)), where).toEqual(r);
            for (const e of r.enemies) expect(ROSTER[a.floor], where).toContain(e.type);
            // Whatever the idea painted, an L's missing cell is wall and nothing stands in it.
            if (shape in L_CELLS) {
              const out = missingQuarter(shape as LShape);
              const misplaced = r.tiles.flatMap((row, y) => row.flatMap((t, x) => ((t === 'wall') !== out({ x, y }) ? [`${x},${y}`] : [])));
              expect(misplaced, where).toEqual([]);
            }
            const spawns = [...r.enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])]), ...r.pickups.map((p) => p.cell)];
            expect(spawns.filter((c) => r.tiles[c.y][c.x] !== 'floor'), where).toEqual([]);
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
      }
      expect(layouts.size, a.id).toBeGreaterThan(3);
    }
  }, 30_000);

  it.each([
    [1, ['jar', 'fourCorners', 'pillaredHall', 'sentryIsland', 'stash', 'thornMaze', 'waspNest', 'boarRun']],
    [2, ['courtyard', 'gallery', 'serpentGarden', 'track', 'twinJars', 'vault', 'crystalGallery', 'batRoost', 'glowshroomCave']],
    [3, ['crossfire', 'fortress', 'killbox', 'minefield', 'nest', 'ruins', 'crusherCorridor', 'knightGuard', 'hauntedHall']],
  ])('gives floor %i its own set of ideas, one of them a breather that fits every door set', (floor, ids) => {
    const own = ARCHETYPES.filter((a) => a.floor === floor - 1 && a.kind === 'normal' && supportsShape(a, '1x1'));
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

describe('composed big rooms', () => {
  it('builds every big normal room from a layout and an encounter, on every floor, shape and door set', () => {
    for (const [floorIndex, theme] of ['marsh', 'rift', 'crypt'].entries()) {
      for (const shape of ['2x1', '1x2', '2x2', ...L_SHAPES] as const) {
        for (const [i, doors] of EVERY_SHAPED_DOOR_SET[shape].filter((_, j) => j % 9 === 0).entries()) {
          const spec = { id: '0,0', kind: 'normal' as const, doors, shape, theme };
          const r = generateRoom(spec, floorIndex, createRng(i));
          const where = `floor ${floorIndex + 1} ${shape} doors ${JSON.stringify(doors)}`;
          expect(r.layout, where).toBeDefined();
          expect(r.encounter, where).toBeDefined();
          expect(r.archetype, where).toBeUndefined();
          expect([r.width, r.height], where).toEqual(SHAPE_SIZE[shape]);
          expect(r.enemies.length, where).toBeGreaterThan(0);
          expect(generateRoom(spec, floorIndex, createRng(i)), where).toEqual(r);
        }
      }
    }
  });
});

describe('edge filler', () => {
  const differences = (a: RoomLayout, b: RoomLayout) =>
    b.tiles.flatMap((row, y) => row.flatMap((t, x) => (t !== a.tiles[y][x] ? [{ was: a.tiles[y][x], now: t }] : [])));

  it('dresses a themed room on top of the very same layout, only ever on floor', () => {
    const rooms = [
      ...EVERY_SHAPED_DOOR_SET['2x1'].slice(0, 20).map((doors) => ({ doors, shape: '2x1' as const, archetype: undefined, theme: 'crypt', floor: 2 })),
      ...EVERY_DOOR_SET.map((doors) => ({ doors: [...doors], shape: '1x1' as const, archetype: 'pillaredHall', theme: 'grove', floor: 0 })),
    ];
    let dressed = 0;
    for (const [i, r] of rooms.entries()) {
      const spec = { id: '0,0', kind: 'normal' as const, doors: r.doors, shape: r.shape, archetype: r.archetype };
      const bare = generateRoom(spec, r.floor, createRng(i));
      const themed = generateRoom({ ...spec, theme: r.theme }, r.floor, createRng(i));
      const where = `${r.shape} ${JSON.stringify(r.doors)}`;
      expect(themed.enemies.map((e) => e.cell), where).toEqual(bare.enemies.map((e) => e.cell));
      const diff = differences(bare, themed);
      for (const d of diff) expect(d.was, where).toBe('floor');
      if (diff.length) dressed++;
    }
    expect(dressed / rooms.length).toBeGreaterThan(0.8);
  });
});

describe('Crusher Corridor (floor 3)', () => {
  const corridor = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'crusherCorridor' }, 2, createRng(seed));

  it('sets crushers along lanes they can slide down, valid wherever each one stops, for every door set', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = corridor(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('crusherCorridor');
        expect(r.crushers?.length, where).toBeGreaterThan(0);
        expect(count(r, 'crusher'), where).toBe(r.crushers!.length);
        for (const c of r.crushers!) {
          expect(r.tiles[c.cell.y][c.cell.x], where).toBe('crusher');
          const reach = AXIS_DIRECTIONS[c.axis].map((dir) => slideCrusher(r.tiles, c.cell, dir).swept.length);
          expect(Math.max(...reach), where).toBeGreaterThan(1);
        }
        expect(validateRoom(r, { axes: ['vertical', 'horizontal'] }), where).toEqual([]);
        expect(r.enemies.length, where).toBeGreaterThan(0);
      }
    }
  });

  it('is the same room for the same seed', () => {
    expect(corridor(7, ALL_DOORS)).toEqual(corridor(7, ALL_DOORS));
  });

  it('puts a walker in the path of a crusher, to be lured under it', () => {
    let lured = 0;
    for (let seed = 0; seed < 30; seed++) {
      const r = corridor(seed, ALL_DOORS);
      const lanes = r.crushers!.flatMap((c) => AXIS_DIRECTIONS[c.axis].flatMap((dir) => slideCrusher(r.tiles, c.cell, dir).swept));
      if (r.enemies.some((e) => e.type !== 'turret' && lanes.some((s) => s.x === e.cell.x && s.y === e.cell.y))) lured++;
    }
    expect(lured).toBeGreaterThan(15);
  });

  it('never appears off the dungeon floor', () => {
    for (const floorIndex of [0, 1]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 10; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          expect(count(r, 'crusher'), `floor ${floorIndex + 1} seed ${seed}`).toBe(0);
          expect(r.crushers ?? [], `floor ${floorIndex + 1} seed ${seed}`).toEqual([]);
        }
      }
    }
  });
});

describe('Haunted Hall (floor 3)', () => {
  const hall = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'hauntedHall' }, 2, createRng(seed));
  const ghostsIn = (r: ReturnType<typeof hall>) => r.enemies.filter((e) => e.type === 'ghost');

  it('builds its own valid idea around ghosts for every door set', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = hall(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('hauntedHall');
        expect(ghostsIn(r).length, where).toBeGreaterThanOrEqual(2);
        expect(validateRoom(r, { axes: ['vertical', 'horizontal'] }), where).toEqual([]);
      }
    }
  });

  it('shuts ghosts in behind stone, where nobody on foot could ever reach them', () => {
    let sealed = 0;
    for (let seed = 0; seed < 30; seed++) {
      const r = hall(seed, ALL_DOORS);
      const onFoot = reachable(r, r.doors[0].cell, true, true);
      if (ghostsIn(r).some((g) => !onFoot.has(`${g.cell.x},${g.cell.y}`))) sealed++;
    }
    expect(sealed).toBeGreaterThan(20);
  });

  it('is the same room for the same seed', () => {
    expect(hall(7, ALL_DOORS)).toEqual(hall(7, ALL_DOORS));
  });

  it('haunts floor 3 only: ghosts never appear on floors 1 and 2', () => {
    const types: Set<string>[] = [new Set(), new Set(), new Set()];
    for (const floorIndex of [0, 1, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 20; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          for (const e of r.enemies) types[floorIndex].add(e.type);
        }
      }
    }
    expect(types[0].has('ghost')).toBe(false);
    expect(types[1].has('ghost')).toBe(false);
    expect(types[2].has('ghost')).toBe(true);
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

  it('builds a wide 2x1 room 26x7, with each door at the middle of its map cell’s wall', () => {
    const wide = generateRoom(
      {
        id: '0,0',
        kind: 'normal',
        shape: '2x1',
        doors: [
          { side: 'up', at: { x: 1, y: 0 } },
          { side: 'down', at: { x: 0, y: 0 } },
          { side: 'right', at: { x: 1, y: 0 } },
        ],
      },
      0,
      createRng(1),
    );
    expect([wide.width, wide.height]).toEqual([26, 7]);
    expect(wide.tiles).toHaveLength(7);
    expect(wide.tiles.every((row) => row.length === 26)).toBe(true);
    // A 2x1 block is 30x9 tiles with the interior 2 tiles in from the sides and 1 from top and
    // bottom; doors sit on the centre column (7) or row (4) of their 15x9-tile cell.
    expect(wide.doors.find((d) => d.side === 'up')?.cell).toEqual({ x: 15 + 7 - 2, y: 0 });
    expect(wide.doors.find((d) => d.side === 'down')?.cell).toEqual({ x: 7 - 2, y: 6 });
    expect(wide.doors.find((d) => d.side === 'right')?.cell).toEqual({ x: 25, y: 4 - 1 });
  });

  it('builds a tall 1x2 room 13x14, with each door at the middle of its map cell’s wall', () => {
    const tall = generateRoom(
      {
        id: '0,0',
        kind: 'normal',
        shape: '1x2',
        doors: [
          { side: 'left', at: { x: 0, y: 1 } },
          { side: 'right', at: { x: 0, y: 0 } },
          { side: 'down', at: { x: 0, y: 1 } },
        ],
      },
      0,
      createRng(1),
    );
    expect([tall.width, tall.height]).toEqual([13, 14]);
    expect(tall.tiles).toHaveLength(14);
    expect(tall.tiles.every((row) => row.length === 13)).toBe(true);
    expect(tall.doors.find((d) => d.side === 'left')?.cell).toEqual({ x: 0, y: 9 + 4 - 2 });
    expect(tall.doors.find((d) => d.side === 'right')?.cell).toEqual({ x: 12, y: 4 - 2 });
    expect(tall.doors.find((d) => d.side === 'down')?.cell).toEqual({ x: 7 - 1, y: 13 });
  });

  it('builds a big 2x2 normal room 26x14 like the boss room, with a door in each of its cells', () => {
    const big = generateRoom(
      {
        id: '0,0',
        kind: 'normal',
        shape: '2x2',
        doors: [
          { side: 'up', at: { x: 1, y: 0 } },
          { side: 'down', at: { x: 0, y: 1 } },
          { side: 'left', at: { x: 0, y: 1 } },
          { side: 'right', at: { x: 1, y: 0 } },
        ],
      },
      0,
      createRng(1),
    );
    expect([big.width, big.height]).toEqual([26, 14]);
    expect(big.tiles).toHaveLength(14);
    expect(big.tiles.every((row) => row.length === 26)).toBe(true);
    // Same 30x18-tile block as the boss room: interior 2 tiles in on every side.
    expect(big.doors.find((d) => d.side === 'up')?.cell).toEqual({ x: 15 + 7 - 2, y: 0 });
    expect(big.doors.find((d) => d.side === 'down')?.cell).toEqual({ x: 7 - 2, y: 13 });
    expect(big.doors.find((d) => d.side === 'left')?.cell).toEqual({ x: 0, y: 9 + 4 - 2 });
    expect(big.doors.find((d) => d.side === 'right')?.cell).toEqual({ x: 25, y: 4 - 2 });
    expect(big.enemies.length).toBeGreaterThan(0);
  });

  it('builds an L room in its 26x14 box, with doors on its cells’ outer walls and its missing cell walled off', () => {
    const l = generateRoom(
      {
        id: '0,0',
        kind: 'normal',
        shape: 'L-br',
        doors: [
          { side: 'up', at: { x: 1, y: 0 } },
          { side: 'right', at: { x: 1, y: 0 } },
          { side: 'left', at: { x: 0, y: 1 } },
          { side: 'down', at: { x: 0, y: 1 } },
        ],
      },
      0,
      createRng(1),
    );
    expect([l.width, l.height]).toEqual([26, 14]);
    // Laid out like the big room: doors on the centre column / row of their 15x9-tile cell.
    expect(l.doors.find((d) => d.side === 'up')?.cell).toEqual({ x: 15 + 7 - 2, y: 0 });
    expect(l.doors.find((d) => d.side === 'right')?.cell).toEqual({ x: 25, y: 4 - 2 });
    expect(l.doors.find((d) => d.side === 'left')?.cell).toEqual({ x: 0, y: 9 + 4 - 2 });
    expect(l.doors.find((d) => d.side === 'down')?.cell).toEqual({ x: 7 - 2, y: 13 });
    // The arms meet with the corner between them filled: no wall ring between the cells.
    expect([l.tiles[6][12], l.tiles[6][13], l.tiles[7][12]].includes('wall')).toBe(false);
    expect(l.tiles[7][13]).toBe('wall');
    expect(l.tiles[13][25]).toBe('wall');
    expect(l.enemies.length).toBeGreaterThan(0);
  });

  it('keeps every L walled off in its missing cell, with its doors reachable around the corner', () => {
    for (const shape of L_SHAPES) {
      for (let floor = 0; floor < 3; floor++) {
        const doors = lSlots(shape);
        const r = generateRoom({ id: '0,0', kind: 'normal', shape, doors }, floor, createRng(floor));
        const where = `${shape} floor ${floor}`;
        const out = missingQuarter(shape);
        r.tiles.forEach((row, y) => row.forEach((t, x) => expect(t === 'wall', `${where} ${x},${y}`).toBe(out({ x, y }))));
        expect(r.doors, where).toHaveLength(6);
        for (const d of r.doors) expect(out(d.cell), `${where} door ${JSON.stringify(d)}`).toBe(false);
        const open = reachable(r, r.doors[0].cell);
        for (const d of r.doors) expect(open.has(`${d.cell.x},${d.cell.y}`), `${where} door ${JSON.stringify(d)}`).toBe(true);
      }
    }
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

describe('Wasp Nest (floor 1)', () => {
  const nest = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'waspNest' }, 0, createRng(seed));
  /** Wasps grouped by touching cells (8-way): each group is one swarm. */
  const swarms = (r: ReturnType<typeof room>) => {
    const left = r.enemies.filter((e) => e.type === 'wasp').map((e) => e.cell);
    const groups: { x: number; y: number }[][] = [];
    while (left.length) {
      const group = left.splice(0, 1);
      for (let i = 0; i < group.length; i++) {
        const touching = left.filter((c) => Math.abs(c.x - group[i].x) <= 1 && Math.abs(c.y - group[i].y) <= 1);
        for (const c of touching) left.splice(left.indexOf(c), 1);
        group.push(...touching);
      }
      groups.push(group);
    }
    return groups;
  };

  it('builds valid rooms around one swarm of 5-7 wasps, for every door set', () => {
    const layouts = new Set<string>();
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = nest(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('waspNest');
        const groups = swarms(r);
        expect(groups.length, where).toBe(1);
        for (const g of groups) {
          expect(g.length, where).toBeGreaterThanOrEqual(5);
          expect(g.length, where).toBeLessThanOrEqual(7);
        }
        expect(validateRoom(r, { axes: ['vertical', 'horizontal'] }), where).toEqual([]);
        layouts.add(JSON.stringify(r.tiles));
      }
    }
    expect(layouts.size).toBeGreaterThan(1);
  });

  it('nests the swarms beyond a pond, where only flying gets them out', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 10; seed++) {
        const r = nest(seed, doors);
        const walk = reachable(r, r.doors[0].cell);
        const fly = reachable(r, r.doors[0].cell, false, true);
        for (const w of r.enemies.filter((e) => e.type === 'wasp')) {
          const at = `${w.cell.x},${w.cell.y}`;
          expect(walk.has(at), `seed ${seed} doors ${doors} at ${at}`).toBe(false);
          expect(fly.has(at), `seed ${seed} doors ${doors} at ${at}`).toBe(true);
        }
      }
    }
  });

  it('is the same room for the same seed', () => {
    expect(nest(4, ALL_DOORS)).toEqual(nest(4, ALL_DOORS));
  });

  it('only lets wasps loose on floor 1', () => {
    for (const floorIndex of [1, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 10; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          expect(r.enemies.filter((e) => e.type === 'wasp'), `floor ${floorIndex + 1} seed ${seed}`).toEqual([]);
        }
      }
    }
  });
});

describe('Knight Guard (floor 3)', () => {
  const guard = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'knightGuard' }, 2, createRng(seed));

  it('posts shielded knights around a chest in plain sight, with room to walk round them, for every door set', () => {
    const layouts = new Set<string>();
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = guard(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('knightGuard');
        const knights = r.enemies.filter((e) => e.type === 'knight');
        expect(knights.length, where).toBeGreaterThanOrEqual(2);
        const chests = r.pickups.filter((p) => p.visible && p.type === 'chest');
        expect(chests, where).toHaveLength(1);
        const seen = reachable(r, r.doors[0].cell);
        const chest = chests[0].cell;
        expect(seen.has(`${chest.x},${chest.y}`), where).toBe(true);
        for (const k of knights) {
          expect(seen.has(`${k.cell.x},${k.cell.y}`), where).toBe(true);
          // Standing guard: close by the chest.
          expect(Math.abs(k.cell.x - chest.x) + Math.abs(k.cell.y - chest.y), where).toBeLessThanOrEqual(3);
          // Flankable: open floor on at least two sides of each knight, not just its front.
          const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => seen.has(`${k.cell.x + dx},${k.cell.y + dy}`));
          expect(open.length, where).toBeGreaterThanOrEqual(3);
        }
        layouts.add(JSON.stringify([r.tiles, r.enemies]));
      }
    }
    expect(layouts.size).toBeGreaterThan(3);
  });

  it('is the same room for the same seed', () => {
    expect(guard(11, ALL_DOORS)).toEqual(guard(11, ALL_DOORS));
  });
});

describe('Fortress (floor 3), recast', () => {
  it('keeps gargoyles in the keep and sends shielded knights, not zombies, out on patrol', () => {
    let knights = 0;
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 20; seed++) {
        const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'fortress' }, 2, createRng(seed));
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('fortress');
        expect(r.enemies.filter((e) => e.type === 'gargoyle').length, where).toBeGreaterThanOrEqual(2);
        const walkers = r.enemies.filter((e) => ENEMY_CLASS[e.type] === 'walker');
        expect(walkers.length, where).toBeGreaterThan(0);
        expect(walkers.every((e) => e.type === 'knight'), where).toBe(true);
        knights += walkers.length;
      }
    }
    expect(knights).toBeGreaterThan(0);
  });
});

describe('skeleton knights', () => {
  it('only guard the dungeon: none on floors 1 and 2', () => {
    for (const floorIndex of [0, 1]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 20; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          expect(r.enemies.some((e) => e.type === 'knight'), `floor ${floorIndex + 1} seed ${seed}`).toBe(false);
        }
      }
    }
  });

  it('turn up in the dungeon', () => {
    const rooms = EVERY_DOOR_SET.flatMap((doors) =>
      Array.from({ length: 20 }, (_, seed) => generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, 2, createRng(seed))),
    );
    expect(rooms.some((r) => r.enemies.some((e) => e.type === 'knight'))).toBe(true);
  });
});

describe('Crystal Gallery (floor 2)', () => {
  const gallery = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'crystalGallery' }, 1, createRng(seed));

  /** The first tile a shot flying straight from `from` along (dx, dy) runs into, past open floor and holes. */
  const firstSolid = (r: ReturnType<typeof gallery>, from: { x: number; y: number }, dx: number, dy: number) => {
    for (let x = from.x + dx, y = from.y + dy; r.tiles[y]?.[x] !== undefined; x += dx, y += dy) {
      if (r.tiles[y][x] !== 'floor' && r.tiles[y][x] !== 'hole') return r.tiles[y][x];
    }
    return undefined;
  };

  it('sets crystals and crystal turrets in a valid mirrored room, for every door set', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = gallery(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('crystalGallery');
        expect(count(r, 'crystal'), where).toBeGreaterThanOrEqual(4);
        expect(r.enemies.some((e) => e.type === 'crystalTurret'), where).toBe(true);
        expect(validateRoom(r, { axes: ['vertical', 'horizontal'] }), where).toEqual([]);
      }
    }
  });

  it('is built around bank shots: every turret has a crystal straight in line with it', () => {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let seed = 0; seed < 40; seed++) {
      const r = gallery(seed, ALL_DOORS);
      for (const t of r.enemies.filter((e) => e.type === 'crystalTurret')) {
        expect(dirs.map(([dx, dy]) => firstSolid(r, t.cell, dx, dy)), `seed ${seed} turret ${JSON.stringify(t.cell)}`).toContain('crystal');
      }
    }
  });

  it('is the same room for the same seed, and varies across seeds', () => {
    expect(gallery(7, ALL_DOORS)).toEqual(gallery(7, ALL_DOORS));
    const layouts = new Set(Array.from({ length: 30 }, (_, seed) => JSON.stringify(gallery(seed, ALL_DOORS).tiles)));
    expect(layouts.size).toBeGreaterThanOrEqual(3);
  });

  it('only grows crystals in the caves', () => {
    for (const floorIndex of [0, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 10; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          expect(count(r, 'crystal'), `floor ${floorIndex + 1} seed ${seed} doors ${doors}`).toBe(0);
        }
      }
    }
  });
});

describe('Glowshroom Cave (floor 2)', () => {
  const cave = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'glowshroomCave' }, 1, createRng(seed));
  const glowshrooms = (r: ReturnType<typeof cave>) =>
    r.tiles.flatMap((row, y) => row.flatMap((t, x) => (t === 'glowshroom' ? [{ x, y }] : [])));

  it('scatters glowshrooms through a valid mirrored cave, walling nothing off, for every door set', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = cave(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('glowshroomCave');
        expect(glowshrooms(r).length, where).toBeGreaterThanOrEqual(4);
        expect(validateRoom(r, { axes: ['vertical', 'horizontal'] }), where).toEqual([]);
        expect(reachable(r, r.doors[0].cell).size, where).toBe(count(r, 'floor'));
      }
    }
  });

  it('is built around stun openings: some enemy always starts within a burst of a glowshroom', () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = cave(seed, ALL_DOORS);
      const inReach = r.enemies.filter((e) =>
        glowshrooms(r).some((g) => Math.hypot(e.cell.x - g.x, e.cell.y - g.y) <= GLOWSHROOM_RADIUS),
      );
      expect(inReach.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('is the same room for the same seed, and varies across seeds', () => {
    expect(cave(5, ALL_DOORS)).toEqual(cave(5, ALL_DOORS));
    const layouts = new Set(Array.from({ length: 30 }, (_, seed) => JSON.stringify([cave(seed, ALL_DOORS).tiles, cave(seed, ALL_DOORS).enemies])));
    expect(layouts.size).toBeGreaterThan(3);
  });

  it('only grows glowshrooms in the caves', () => {
    for (const floorIndex of [0, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 10; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          expect(count(r, 'glowshroom'), `floor ${floorIndex + 1} seed ${seed} doors ${doors}`).toBe(0);
        }
      }
    }
  });
});

describe('Bat Roost (floor 2)', () => {
  const roost = (seed: number, doors: readonly (typeof SIDES)[number][]) =>
    generateRoom({ id: '0,0', kind: 'normal', doors: [...doors], archetype: 'batRoost' }, 1, createRng(seed));
  const batsIn = (r: ReturnType<typeof roost>) => r.enemies.filter((e) => e.type === 'bat');

  it('builds valid, symmetric rooms around a colony of 5-7 bats and chasms, for every door set', () => {
    const layouts = new Set<string>();
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 30; seed++) {
        const r = roost(seed, doors);
        const where = `seed ${seed} doors ${doors}`;
        expect(r.archetype, where).toBe('batRoost');
        expect(batsIn(r).length, where).toBeGreaterThanOrEqual(5);
        expect(batsIn(r).length, where).toBeLessThanOrEqual(7);
        expect(r.tiles.flat().filter((t) => t === 'hole').length, where).toBeGreaterThan(0);
        expect(validateRoom(r, { axes: ['vertical', 'horizontal'] }), where).toEqual([]);
        layouts.add(JSON.stringify([r.tiles, r.enemies]));
      }
    }
    expect(layouts.size).toBeGreaterThan(3);
  });

  it('roosts every bat at the edge of a chasm, so its flutter carries it out over the drop', () => {
    for (const doors of EVERY_DOOR_SET) {
      for (let seed = 0; seed < 10; seed++) {
        const r = roost(seed, doors);
        for (const b of batsIn(r)) {
          const nextToChasm = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => r.tiles[b.cell.y + dy]?.[b.cell.x + dx] === 'hole'));
          expect(nextToChasm, `seed ${seed} doors ${doors} at ${b.cell.x},${b.cell.y}`).toBe(true);
        }
      }
    }
  });

  it('is the same room for the same seed', () => {
    expect(roost(5, ALL_DOORS)).toEqual(roost(5, ALL_DOORS));
  });

  it('lets bats loose on floor 2 only', () => {
    const types: Set<string>[] = [new Set(), new Set(), new Set()];
    for (const floorIndex of [0, 1, 2]) {
      for (const doors of EVERY_DOOR_SET) {
        for (let seed = 0; seed < 20; seed++) {
          const r = generateRoom({ id: '0,0', kind: 'normal', doors: [...doors] }, floorIndex, createRng(seed));
          for (const e of r.enemies) types[floorIndex].add(e.type);
        }
      }
    }
    expect(types.map((t) => t.has('bat'))).toEqual([false, true, false]);
  });
});
