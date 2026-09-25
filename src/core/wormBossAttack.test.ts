import { describe, expect, it } from 'vitest';
import { STEP, type Cell, type Direction } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import {
  absorbHit,
  bossCrawl,
  breakOut,
  canAttack,
  halfPools,
  inPhaseTwo,
  lungeFrom,
  planLunge,
  planRockfall,
  rockfallAt,
  spitWave,
  splitsAt,
  WORM_BOSS,
} from './wormBossAttack';
import { createWorm } from './wormChain';

/** ASCII fixture: `.` floor, `#` stone, `r` rock. */
const grid = (rows: string[]): Tile[][] =>
  rows.map((row) => [...row].map((ch): Tile => (ch === '#' ? 'obstacle' : ch === 'r' ? 'rock' : 'floor')));
const key = (c: Cell) => `${c.x},${c.y}`;

const worm = (cells: [number, number][], heading: Direction) => createWorm(cells.map(([x, y]) => ({ x, y })), heading);

describe('worm boss spit wave', () => {
  const deg = (rad: number) => Math.round((((rad * 180) / Math.PI) % 360) + 360) % 360;

  it('fires out of both flanks of each segment, head first, one segment after another', () => {
    const wave = spitWave([{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }], 'right');
    expect(wave.map((s) => s.segment)).toEqual([0, 1, 2]);
    expect(wave.map((s) => s.atMs)).toEqual([0, WORM_BOSS.spitGapMs, 2 * WORM_BOSS.spitGapMs]);
    for (const s of wave) expect(s.angles.map(deg).sort((a, b) => a - b)).toEqual([90, 270]);
  });

  it('fires sideways from where the body runs up and down', () => {
    const wave = spitWave([{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }], 'up');
    expect(wave[0].angles.map(deg).sort((a, b) => a - b)).toEqual([0, 180]);
    // The tail segment turned the corner: it lies left-right of its neighbour.
    expect(wave[2].angles.map(deg).sort((a, b) => a - b)).toEqual([90, 270]);
  });

  it('uses the heading for segments still bunched up in the exit hole', () => {
    const wave = spitWave([{ x: 4, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 4 }], 'down');
    for (const s of wave) expect(s.angles.map(deg).sort((a, b) => a - b)).toEqual([0, 180]);
  });
});

describe('worm boss falling rocks', () => {
  const tiles = grid(['..........', '..#.......', '....r.....', '..........', '..........', '..........']);
  const player = { x: 4, y: 3 };
  const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  it('drops a few rocks on open floor around the player, one right on them', () => {
    for (let seed = 0; seed < 40; seed++) {
      const cells = planRockfall(tiles, player, [], [], createRng(seed));
      expect(cells.length, `seed ${seed}`).toBe(WORM_BOSS.rockfallCount);
      expect(new Set(cells.map(key)).size, `seed ${seed}`).toBe(cells.length);
      expect(cells.map(key), `seed ${seed}`).toContain(key(player));
      for (const c of cells) {
        expect(tiles[c.y][c.x], `seed ${seed}`).toBe('floor');
        expect(chebyshev(c, player), `seed ${seed}`).toBeLessThanOrEqual(WORM_BOSS.rockfallRadius);
      }
    }
  });

  it('never drops a rock on the worm, or in front of a door', () => {
    const worm = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 2 }];
    const door = { side: 'down' as const, cell: { x: 5, y: 5 } };
    for (let seed = 0; seed < 40; seed++) {
      const cells = planRockfall(tiles, { x: 4, y: 4 }, worm, [door], createRng(seed)).map(key);
      for (const c of [...worm, door.cell]) expect(cells, `seed ${seed}`).not.toContain(key(c));
    }
  });

  it('grows its shadow while it falls, then lands', () => {
    const { rockShadowMs } = WORM_BOSS;
    const early = rockfallAt(rockShadowMs * 0.25);
    const late = rockfallAt(rockShadowMs * 0.75);
    expect(early.landed).toBe(false);
    expect(late.landed).toBe(false);
    expect(late.shadow).toBeGreaterThan(early.shadow);
    expect(rockfallAt(rockShadowMs).landed).toBe(true);
  });
});

describe('worm boss rampage lunges', () => {
  const room = grid(['.........#', '.........#', '.........#', '....r....#', '##########']);
  // Stone all round: no lunge can tunnel through the walls, so only the choice of line counts.
  const pen = grid(['#######', '#.....#', '#.....#', '#.....#', '#######']);
  const cells = (xs: number[], y: number) => xs.map((x) => ({ x, y }));
  const rng = createRng(0);

  it('races along a line until it runs into something', () => {
    const lunge = lungeFrom(room, [], { x: 1, y: 2 }, 'right', rng);
    expect(lunge.path).toEqual(cells([2, 3, 4, 5, 6, 7, 8], 2));
    expect(lunge.stop).toEqual({ x: 9, y: 2 });
  });

  it('bursts through the first rock it runs into and lunges on', () => {
    const lunge = lungeFrom(room, [], { x: 4, y: 0 }, 'down', rng);
    expect(lunge.path).toEqual([1, 2, 3].map((y) => ({ x: 4, y })));
    expect(lunge.bursts).toEqual([{ x: 4, y: 3 }]);
    expect(lunge.stop).toEqual({ x: 4, y: 4 });
  });

  it('stops short of a second rock, or of stone, and says what it ran into', () => {
    const rocks = grid(['......', '.r.r..', '......', '.#....']);
    const intoRock = lungeFrom(rocks, [], { x: 0, y: 1 }, 'right', rng);
    expect(intoRock.path).toEqual([1, 2].map((x) => ({ x, y: 1 })));
    expect(intoRock.stop).toEqual({ x: 3, y: 1 });
    const intoStone = lungeFrom(rocks, [], { x: 1, y: 0 }, 'down', rng);
    expect(intoStone.path).toEqual([1, 2].map((y) => ({ x: 1, y })));
    expect(intoStone.bursts).toEqual([{ x: 1, y: 1 }]);
    expect(intoStone.stop).toEqual({ x: 1, y: 3 });
  });

  it('lunges along the line that brings it closest to the player', () => {
    const lunge = planLunge(pen, [], worm([[1, 2], [1, 3], [2, 3]], 'up'), { x: 4, y: 2 }, rng);
    expect(lunge?.heading).toBe('right');
    expect(lunge?.path).toEqual(cells([2, 3, 4, 5], 2));
  });

  it('takes the longer run when two lines come equally close', () => {
    // The player is diagonal to the head: right and down both reach a cell one step from them.
    const lunge = planLunge(pen, [], worm([[2, 2], [2, 1], [1, 1]], 'down'), { x: 3, y: 3 }, rng);
    expect(lunge?.heading).toBe('right');
    expect(lunge?.path).toHaveLength(3);
  });

  it('never lunges back into its own neck', () => {
    for (const player of [{ x: 0, y: 2 }, { x: 0, y: 0 }]) {
      expect(planLunge(room, [], worm([[3, 2], [2, 2], [1, 2]], 'right'), player, rng)?.heading).not.toBe('left');
    }
  });

  it('has nowhere to lunge when boxed in by stone', () => {
    const box = grid(['###', '#..', '###']);
    expect(planLunge(box, [], worm([[1, 1], [2, 1]], 'left'), { x: 0, y: 0 }, rng)).toBeUndefined();
  });
});

describe('worm boss rampage lunges through the walls', () => {
  const open = grid(['......', '......', '......', '......']);
  const outside = (c: Cell) => c.x < 0 || c.y < 0 || c.x >= 6 || c.y >= 4;
  const seeds = Array.from({ length: 60 }, (_, i) => i);

  it('tunnels into the outer wall and out of a random spot on another wall, racing on into the room from there', () => {
    const exitWalls = new Set<string>();
    for (const seed of seeds) {
      const lunge = lungeFrom(open, [], { x: 4, y: 1 }, 'right', createRng(seed));
      const wrap = lunge.wrap!;
      expect(wrap.entry, `seed ${seed}`).toEqual({ x: 6, y: 1 });
      expect(outside(wrap.exit) && wrap.exit.x !== 6, `seed ${seed}`).toBe(true);
      exitWalls.add(wrap.heading);
      // Straight on into the room from the exit.
      const out = lunge.path.slice(lunge.path.indexOf(lunge.path.find((c) => key(c) === key(wrap.exit))!) + 1);
      expect(out[0], `seed ${seed}`).toEqual({ x: wrap.exit.x + STEP[wrap.heading].x, y: wrap.exit.y + STEP[wrap.heading].y });
      for (let i = 1; i < out.length; i++) {
        expect(out[i], `seed ${seed}`).toEqual({ x: out[i - 1].x + STEP[wrap.heading].x, y: out[i - 1].y + STEP[wrap.heading].y });
      }
    }
    expect([...exitWalls].sort()).toEqual(['down', 'right', 'up']);
  });

  it('tunnels only once: the next wall it runs into ends the lunge', () => {
    for (const seed of seeds) {
      const lunge = lungeFrom(open, [], { x: 4, y: 1 }, 'right', createRng(seed));
      expect(lunge.path.filter(outside), `seed ${seed}`).toHaveLength(2);
      expect(lunge.stop, `seed ${seed}`).toBeUndefined();
    }
  });

  it('bursts through the first rock on each side of the walls', () => {
    // Rock all along the edges: whichever wall it comes out of, rock is the first thing in its way.
    const rocky = grid(['rrrrrr', 'r....r', 'r....r', 'rrrrrr']);
    for (const seed of seeds) {
      const lunge = lungeFrom(rocky, [], { x: 3, y: 1 }, 'right', createRng(seed));
      const first = lunge.path[lunge.path.findIndex((c) => key(c) === key(lunge.wrap!.exit)) + 1];
      expect(lunge.bursts, `seed ${seed}`).toEqual([{ x: 5, y: 1 }, first]);
    }
  });

  it('never tunnels out of a doorway, or out into stone', () => {
    const walled = grid(['#.....', '#.....', '#.....', '#.....']);
    const door = { side: 'up' as const, cell: { x: 2, y: 0 } };
    for (const seed of seeds) {
      const { wrap } = lungeFrom(walled, [door], { x: 4, y: 1 }, 'right', createRng(seed));
      expect(wrap?.exit.x, `seed ${seed}`).not.toBe(-1);
      expect(key(wrap!.exit), `seed ${seed}`).not.toBe('2,-1');
    }
  });

  it('never tunnels through a doorway on the way in', () => {
    expect(lungeFrom(open, [{ side: 'right', cell: { x: 5, y: 1 } }], { x: 4, y: 1 }, 'right', createRng(1)).wrap).toBeUndefined();
  });
});

describe('worm boss boxed in', () => {
  it('smashes the rock straight ahead rather than turning back', () => {
    const tiles = grid(['.r.', 'r.r', '...']);
    // Head in the middle heading up, its body running down behind it.
    expect(breakOut(worm([[1, 1], [1, 2], [0, 2]], 'up'), tiles)).toEqual({ x: 1, y: 0 });
  });

  it('smashes a rock to the side when stone is ahead', () => {
    const tiles = grid(['.#.', '#.r', '...']);
    expect(breakOut(worm([[1, 1], [1, 2], [0, 2]], 'up'), tiles)).toEqual({ x: 2, y: 1 });
  });

  it('smashes nothing while it has a way to go', () => {
    const tiles = grid(['.r.', '..r', '...']);
    expect(breakOut(worm([[1, 1], [1, 2], [0, 2]], 'up'), tiles)).toBeUndefined();
  });
});

describe('worm boss crawling out of a hole', () => {
  // Curled round in a pocket: stone left of and below the head, its own body above and right.
  const tiles = grid(['....', '#..#', '#..#', '####']);
  const curl: [number, number][] = [[1, 2], [2, 2], [2, 1], [1, 1], [1, 0]];

  it('never turns back while its tail is still in a wall hole: it crawls over its own body instead', () => {
    const w = worm([...curl, [1, -1], [1, -1]], 'left');
    for (let seed = 0; seed < 10; seed++) {
      const next = bossCrawl(w, tiles, createRng(seed));
      expect(next.segments[0], `seed ${seed}`).toEqual({ x: 1, y: 1 });
      expect(next.segments.slice(1), `seed ${seed}`).toEqual(w.segments.slice(0, -1));
    }
  });

  it('turns back like any worm when boxed in out in the open', () => {
    const w = worm([...curl, [0, 0]], 'left');
    expect(bossCrawl(w, tiles, createRng(1)).segments[0]).toEqual({ x: 0, y: 0 });
  });
});

describe('worm boss splitting', () => {
  it('never splits until it has lost a fifth of its hit points', () => {
    expect(splitsAt(41, 50, 10, 20)).toBe(false);
    expect(splitsAt(40, 50, 10, 20)).toBe(true);
  });

  it('splits only from a blow to its middle, never its head or tail', () => {
    expect(splitsAt(30, 50, 0, 20)).toBe(false);
    expect(splitsAt(30, 50, 19, 20)).toBe(false);
    expect(splitsAt(30, 50, 1, 20)).toBe(true);
    expect(splitsAt(30, 50, 18, 20)).toBe(true);
  });

  it('shares the hit points it has left between the halves by their length', () => {
    expect(halfPools(38, [10, 9])).toEqual([20, 18]);
  });
});

describe('worm boss half hit points', () => {
  it('soaks up hits anywhere on the half', () => {
    expect(absorbHit(10, 3)).toEqual({ pool: 7, breaks: false });
  });

  it('is done for once the pool is empty', () => {
    expect(absorbHit(2, 3)).toEqual({ pool: 0, breaks: true });
    expect(absorbHit(3, 3)).toEqual({ pool: 0, breaks: true });
  });
});

describe('worm boss pieces', () => {
  it('lets only pieces of four or more segments attack', () => {
    expect([1, 2, 3, 4, 5, 20].map(canAttack)).toEqual([false, false, false, true, true, true]);
  });

  it('enters phase two once the whole worm is down to half its hit points', () => {
    expect(inPhaseTwo(51, 100)).toBe(false);
    expect(inPhaseTwo(50, 100)).toBe(true);
    expect(inPhaseTwo(10, 100)).toBe(true);
  });
});
