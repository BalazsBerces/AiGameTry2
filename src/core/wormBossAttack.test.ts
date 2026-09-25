import { describe, expect, it } from 'vitest';
import { STEP, type Cell, type Direction } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import {
  absorbHit,
  bossCrawl,
  breakOut,
  canAttack,
  canBeHurt,
  chainAt,
  deathChain,
  isFrozen,
  momentTick,
  splitStop,
  halfPools,
  inLastStand,
  lungeCracks,
  lungeFrom,
  planLunge,
  planRockfall,
  isRoaring,
  lastStandPool,
  rockfallAt,
  spitWave,
  splitsAt,
  WORM_BOSS,
  type BossMoment,
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

describe('worm boss lunge warning', () => {
  const lunge = lungeFrom(grid(['......', '......']), [], { x: 0, y: 0 }, 'right', createRng(0));

  it('flows out of the head along the path at a steady pace, well ahead of the lunge', () => {
    const { crackStepMs, lungeStepMs } = WORM_BOSS;
    expect(crackStepMs).toBeLessThan(lungeStepMs);
    expect(lungeCracks(lunge, 0)).toEqual({ whole: [], tip: { cell: lunge.path[0], share: 0 } });
    const partWay = lungeCracks(lunge, 3.25 * crackStepMs);
    expect(partWay.whole).toEqual(lunge.path.slice(0, 3));
    expect(partWay.tip?.cell).toEqual(lunge.path[3]);
    expect(partWay.tip?.share).toBeCloseTo(0.25);
  });

  it('stops at the end of the path', () => {
    expect(lungeCracks(lunge, 1000 * WORM_BOSS.crackStepMs)).toEqual({ whole: lunge.path, tip: undefined });
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
  it('never splits until it has lost two fifths of its hit points', () => {
    expect(splitsAt(61, 100, 10, 20)).toBe(false);
    expect(splitsAt(60, 100, 10, 20)).toBe(true);
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

describe('worm boss last stand', () => {
  it('begins only once it has split and one half is left', () => {
    expect(inLastStand(false, 1)).toBe(false);
    expect(inLastStand(true, 2)).toBe(false);
    expect(inLastStand(true, 1)).toBe(true);
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
});

describe('worm boss last-stand heal', () => {
  it('has won back half the pool it had at the split by the end of the roar', () => {
    expect(lastStandPool(2, 30, 2000)).toBe(17);
  });

  it('never heals past the pool it had at the split', () => {
    expect(lastStandPool(25, 30, 2000)).toBe(30);
    expect(lastStandPool(30, 30, 2000)).toBe(30);
  });

  it('fills back up steadily over the roar, starting from what it had left', () => {
    const over = [0, 250, 500, 1000, 1500, 1999, 2000, 3000].map((ms) => lastStandPool(2, 30, ms));
    expect(over[0]).toBe(2);
    for (let i = 1; i < over.length; i++) expect(over[i]).toBeGreaterThanOrEqual(over[i - 1]);
    expect(over[3]).toBeGreaterThan(2);
    expect(over[3]).toBeLessThan(17);
    expect(over.every((pool) => pool <= 17)).toBe(true);
    expect(over[7]).toBe(17);
  });
});

describe('worm boss last-stand roar', () => {
  it('never roars before its last stand', () => {
    const roar = momentTick(undefined, 1000, { lastStand: false, aboveGround: true });
    expect(isRoaring(roar, 1000)).toBe(false);
    expect(isFrozen(roar, 1000)).toBe(false);
    expect(canBeHurt(roar, 1000)).toBe(true);
  });

  it('roars for 2 s as its last stand begins, out of the walls, frozen and unhurtable', () => {
    const roar = momentTick(undefined, 1000, { lastStand: true, aboveGround: true });
    for (const now of [1000, 2000, 2999]) {
      expect(isRoaring(roar, now), `${now}`).toBe(true);
      expect(isFrozen(roar, now), `${now}`).toBe(true);
      expect(canBeHurt(roar, now), `${now}`).toBe(false);
    }
    expect(isRoaring(roar, 3000)).toBe(false);
    expect(canBeHurt(roar, 3000)).toBe(true);
  });

  it('waits to roar until it is out of the walls, crawling and hurtable while it waits', () => {
    let roar = momentTick(undefined, 1000, { lastStand: true, aboveGround: false });
    roar = momentTick(roar, 1500, { lastStand: true, aboveGround: false });
    expect(isRoaring(roar, 1500)).toBe(false);
    expect(isFrozen(roar, 1500)).toBe(false);
    expect(canBeHurt(roar, 1500)).toBe(true);
    roar = momentTick(roar, 1600, { lastStand: true, aboveGround: true });
    expect(isRoaring(roar, 3599)).toBe(true);
    expect(isRoaring(roar, 3600)).toBe(false);
  });

  it('roars only once', () => {
    let roar = momentTick(undefined, 1000, { lastStand: true, aboveGround: true });
    roar = momentTick(roar, 3000, { lastStand: true, aboveGround: true });
    roar = momentTick(roar, 3016, { lastStand: true, aboveGround: true });
    expect(isRoaring(roar, 3016)).toBe(false);
    expect(canBeHurt(roar, 3016)).toBe(true);
  });
});

describe('worm boss death chain', () => {
  it('pops the half segment by segment from its tail to its head', () => {
    expect(deathChain(5).pops.map((p) => p.segment)).toEqual([4, 3, 2, 1, 0]);
  });

  it('pops each segment later than the one before, over 2 s from the first pop to the head', () => {
    const { pops, totalMs } = deathChain(11);
    for (let i = 1; i < pops.length; i++) expect(pops[i].atMs).toBeGreaterThan(pops[i - 1].atMs);
    expect(pops[0].atMs).toBe(0);
    expect(pops[pops.length - 1].atMs).toBe(2000);
    expect(totalMs).toBe(2000);
  });

  it('pops the head last, in the one big burst', () => {
    const { pops } = deathChain(5);
    expect(pops.filter((p) => p.big)).toEqual([pops[pops.length - 1]]);
    expect(pops[pops.length - 1].segment).toBe(0);
  });

  it('knows what has popped so far, and is over only once the head has', () => {
    expect(chainAt(5, 0)).toEqual({ popped: [4], over: false });
    expect(chainAt(5, 1000)).toEqual({ popped: [4, 3, 2], over: false });
    expect(chainAt(5, 1999)).toEqual({ popped: [4, 3, 2, 1], over: false });
    expect(chainAt(5, 2000)).toEqual({ popped: [4, 3, 2, 1, 0], over: true });
  });

  it('is only a head blast for a lone segment', () => {
    expect(deathChain(1).pops).toEqual([{ segment: 0, atMs: 0, big: true }]);
    expect(chainAt(1, 0).over).toBe(true);
  });
});

describe('worm boss death hold', () => {
  const survivor = (aboveGround: boolean) => ({ lastStand: true, aboveGround, deathHoldUntil: 3000 });

  it('holds the survivor frozen and unhurtable until its twin has blown apart', () => {
    let m: BossMoment | undefined;
    for (let now = 1000; now < 3000; now += 16) {
      m = momentTick(m, now, survivor(false));
      expect(isFrozen(m, now), `${now}`).toBe(true);
      expect(canBeHurt(m, now), `${now}`).toBe(false);
      expect(isRoaring(m, now), `${now}`).toBe(false);
    }
  });

  it('then waits until it is out of the walls, and roars 2 s', () => {
    let m = momentTick(undefined, 1000, survivor(true));
    m = momentTick(m, 3000, survivor(false));
    expect(isFrozen(m, 3000)).toBe(false);
    m = momentTick(m, 3400, survivor(true));
    expect(isRoaring(m, 3400)).toBe(true);
    expect(canBeHurt(m, 5399)).toBe(false);
    expect(isRoaring(m, 5400)).toBe(false);
  });

  it('roars straight after the hold if it is already out of the walls, and only once', () => {
    let m = momentTick(undefined, 1000, survivor(true));
    m = momentTick(m, 3000, survivor(true));
    expect(isRoaring(m, 3000)).toBe(true);
    m = momentTick(m, 5000, survivor(true));
    m = momentTick(m, 5016, survivor(true));
    expect(isRoaring(m, 5016)).toBe(false);
    expect(canBeHurt(m, 5016)).toBe(true);
  });
});

describe('worm boss split stop', () => {
  const half = { lastStand: false, aboveGround: false };

  it('holds both halves frozen and unhurtable for 1 s from the split', () => {
    let m: BossMoment | undefined = splitStop(5000);
    for (let now = 5000; now < 6000; now += 16) {
      m = momentTick(m, now, half);
      expect(isFrozen(m, now), `${now}`).toBe(true);
      expect(canBeHurt(m, now), `${now}`).toBe(false);
    }
    m = momentTick(m, 6000, half);
    expect(isFrozen(m, 6000)).toBe(false);
    expect(canBeHurt(m, 6000)).toBe(true);
  });

  it('holds still even out of the walls, then carries on as before', () => {
    let m = momentTick(splitStop(5000), 5500, { lastStand: false, aboveGround: true });
    expect(isFrozen(m, 5500)).toBe(true);
    m = momentTick(m, 6100, { lastStand: false, aboveGround: true });
    expect(isFrozen(m, 6100)).toBe(false);
    expect(isRoaring(m, 6100)).toBe(false);
  });
});
