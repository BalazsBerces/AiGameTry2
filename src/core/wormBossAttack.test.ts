import { describe, expect, it } from 'vitest';
import type { Cell, Direction } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import {
  absorbHit,
  bossCrawl,
  breakOut,
  canAttack,
  diveCell,
  inPhaseTwo,
  planLunge,
  planRockfall,
  planTunnel,
  rockfallAt,
  sharedPool,
  spitWave,
  WORM_BOSS,
} from './wormBossAttack';
import { createWorm } from './wormChain';

/** ASCII fixture: `.` floor, `#` stone, `r` rock. */
const grid = (rows: string[]): Tile[][] =>
  rows.map((row) => [...row].map((ch): Tile => (ch === '#' ? 'obstacle' : ch === 'r' ? 'rock' : 'floor')));
const key = (c: Cell) => `${c.x},${c.y}`;

const worm = (cells: [number, number][], heading: Direction) => createWorm(cells.map(([x, y]) => ({ x, y })), heading);
/** A four-segment worm lying along row `y`, head at `x`, heading right. */
const rightward = (x: number, y: number) => worm([[x, y], [x - 1, y], [x - 2, y], [x - 3, y]], 'right');

describe('worm boss dive', () => {
  const open = grid(['........', '........', '....#...', '...r....', '........']);
  const ready = { now: 5000, readyAt: 4000 };

  it('dives into the outer wall its head runs straight at, once the cooldown is up', () => {
    const at = diveCell(rightward(7, 1), open, [], ready.now, ready.readyAt);
    expect(at).toEqual({ x: 8, y: 1 });
  });

  it('dives into each of the four outer walls', () => {
    expect(diveCell(worm([[0, 1], [1, 1], [2, 1], [3, 1]], 'left'), open, [], 5000, 0)).toEqual({ x: -1, y: 1 });
    expect(diveCell(worm([[2, 0], [2, 1], [2, 2], [2, 3]], 'up'), open, [], 5000, 0)).toEqual({ x: 2, y: -1 });
    expect(diveCell(worm([[1, 4], [1, 3], [1, 2], [1, 1]], 'down'), open, [], 5000, 0)).toEqual({ x: 1, y: 5 });
  });

  it('keeps crawling while the cooldown is running', () => {
    expect(diveCell(rightward(7, 1), open, [], 3999, 4000)).toBeUndefined();
  });

  it('never dives when it only brushes along a wall', () => {
    // Running along the top edge: the wall is beside it, not ahead.
    expect(diveCell(rightward(5, 0), open, [], 5000, 0)).toBeUndefined();
  });

  it('never dives into rock or stone inside the room', () => {
    expect(diveCell(rightward(3, 2), open, [], 5000, 0)).toBeUndefined();
    expect(diveCell(rightward(2, 3), open, [], 5000, 0)).toBeUndefined();
  });

  it('never dives with fewer than four segments', () => {
    expect(diveCell(worm([[7, 1], [6, 1], [5, 1]], 'right'), open, [], 5000, 0)).toBeUndefined();
  });

  it('never dives into a doorway', () => {
    expect(diveCell(rightward(7, 1), open, [{ side: 'right', cell: { x: 7, y: 1 } }], 5000, 0)).toBeUndefined();
  });
});

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

describe('worm boss tunnel', () => {
  const open = grid(['......', '......', '..r...', '......']);
  const atRightWall = worm([[5, 1], [4, 1], [3, 1], [2, 1]], 'right');

  it('races through the outer wall it runs into and out of the one across the room, on the same line', () => {
    const tunnel = planTunnel(open, [], atRightWall);
    expect(tunnel?.heading).toBe('right');
    expect(tunnel?.wrap).toEqual({ entry: { x: 6, y: 1 }, exit: { x: -1, y: 1 } });
    // Out the other side it races on until it runs into something: here the right wall again.
    expect(tunnel?.path).toEqual([{ x: 6, y: 1 }, { x: -1, y: 1 }, ...[0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 1 }))]);
    expect(tunnel?.stop).toBeUndefined();
  });

  it('bursts through the first rock after it comes out, and stops at the next thing in its way', () => {
    const rocky = planTunnel(grid(['.r.', '.r.', '...']), [], worm([[1, 2], [0, 2], [0, 1]], 'down'));
    expect(rocky?.path).toEqual([{ x: 1, y: 3 }, { x: 1, y: -1 }, { x: 1, y: 0 }]);
    expect(rocky?.bursts).toEqual([{ x: 1, y: 0 }]);
    expect(rocky?.stop).toEqual({ x: 1, y: 1 });
  });

  it('never tunnels unless its head runs straight at an outer wall', () => {
    expect(planTunnel(open, [], worm([[4, 1], [3, 1], [2, 1], [1, 1]], 'right'))).toBeUndefined();
    expect(planTunnel(open, [], worm([[5, 0], [4, 0], [3, 0], [2, 0]], 'right'))).toBeDefined();
    expect(planTunnel(open, [], worm([[3, 0], [2, 0], [1, 0], [0, 0]], 'right'))).toBeUndefined();
  });

  it('never tunnels through a doorway, or out into stone', () => {
    expect(planTunnel(open, [{ side: 'right', cell: { x: 5, y: 1 } }], atRightWall)).toBeUndefined();
    expect(planTunnel(open, [{ side: 'left', cell: { x: 0, y: 1 } }], atRightWall)).toBeUndefined();
    expect(planTunnel(grid(['......', '#.....']), [], atRightWall)).toBeUndefined();
  });
});

describe('worm boss rampage lunges', () => {
  // Stone down the right and along the bottom, so lunges that way end without wrapping.
  const room = grid(['.........#', '.........#', '.........#', '....r....#', '##########']);
  const cells = (xs: number[], y: number) => xs.map((x) => ({ x, y }));

  it('lunges along the line to the player, past them, until it runs into something', () => {
    const lunge = planLunge(room, [], worm([[1, 2], [1, 3], [1, 4]], 'up'), { x: 6, y: 2 });
    expect(lunge?.heading).toBe('right');
    expect(lunge?.path).toEqual(cells([2, 3, 4, 5, 6, 7, 8], 2));
    expect(lunge?.stop).toEqual({ x: 9, y: 2 });
  });

  it('bursts through the first rock it runs into and lunges on', () => {
    const lunge = planLunge(room, [], worm([[4, 0], [3, 0], [2, 0]], 'right'), { x: 4, y: 4 });
    expect(lunge?.heading).toBe('down');
    expect(lunge?.path).toEqual([1, 2, 3].map((y) => ({ x: 4, y })));
    expect(lunge?.bursts).toEqual([{ x: 4, y: 3 }]);
    expect(lunge?.stop).toEqual({ x: 4, y: 4 });
  });

  it('stops short of a second rock, or of stone, and says what it ran into', () => {
    const rocks = grid(['......', '.r.r..', '......', '.#....']);
    // Just out of the left wall, so it can't lunge back that way.
    const intoRock = planLunge(rocks, [], worm([[0, 1], [-1, 1]], 'right'), { x: 5, y: 1 });
    expect(intoRock?.path).toEqual([1, 2].map((x) => ({ x, y: 1 })));
    expect(intoRock?.stop).toEqual({ x: 3, y: 1 });
    const intoStone = planLunge(rocks, [], worm([[1, 0], [0, 0]], 'right'), { x: 1, y: 5 });
    expect(intoStone?.heading).toBe('down');
    expect(intoStone?.path).toEqual([1, 2].map((y) => ({ x: 1, y })));
    expect(intoStone?.bursts).toEqual([{ x: 1, y: 1 }]);
    expect(intoStone?.stop).toEqual({ x: 1, y: 3 });
  });

  it('picks the line that brings it closest to the player, the longer run on a tie', () => {
    // The player is diagonal to the head: right and down both reach a cell one step from them.
    const lunge = planLunge(room, [], worm([[2, 1], [2, 0], [1, 0]], 'down'), { x: 3, y: 2 });
    expect(lunge?.heading).toBe('right');
    expect(lunge?.path).toHaveLength(6);
  });

  it('never lunges back into its own neck', () => {
    for (const player of [{ x: 0, y: 2 }, { x: 0, y: 0 }]) {
      expect(planLunge(room, [], worm([[3, 2], [2, 2], [1, 2]], 'right'), player)?.heading).not.toBe('left');
    }
  });

  it('has nowhere to lunge when boxed in by stone', () => {
    const box = grid(['###', '#..', '###']);
    expect(planLunge(box, [], worm([[1, 1], [2, 1]], 'left'), { x: 0, y: 0 })).toBeUndefined();
  });
});

describe('worm boss rampage lunges through the walls', () => {
  const open = grid(['......', '......', '......']);
  const lunger = worm([[4, 1], [3, 1], [2, 1]], 'right');

  it('tunnels into the outer wall and straight out of the opposite one, lunging on along the same line, once', () => {
    const lunge = planLunge(open, [], lunger, { x: 1, y: 1 });
    expect(lunge?.heading).toBe('right');
    expect(lunge?.path).toEqual([{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: -1, y: 1 }, ...[0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 1 }))]);
    expect(lunge?.wrap).toEqual({ entry: { x: 6, y: 1 }, exit: { x: -1, y: 1 } });
    expect(lunge?.stop).toBeUndefined();
  });

  it('bursts through the first rock on each side of the wrap', () => {
    const lunge = planLunge(grid(['......', '.r...r', '......']), [], worm([[3, 1], [2, 1], [1, 0]], 'right'), { x: 0, y: 1 });
    expect(lunge?.bursts).toEqual([{ x: 5, y: 1 }, { x: 1, y: 1 }]);
  });

  // In both cases it would otherwise tunnel out on the left, straight at the player.
  it('never tunnels through a doorway', () => {
    for (const door of [{ side: 'left' as const, cell: { x: 0, y: 1 } }, { side: 'right' as const, cell: { x: 5, y: 1 } }]) {
      const lunge = planLunge(open, [door], lunger, { x: 1, y: 1 });
      expect(lunge?.wrap?.exit, door.side).not.toEqual({ x: -1, y: 1 });
    }
  });

  it('never tunnels out into stone', () => {
    const lunge = planLunge(grid(['......', '#.....', '......']), [], lunger, { x: 1, y: 1 });
    expect(lunge?.wrap?.exit).not.toEqual({ x: -1, y: 1 });
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

describe('worm boss shared hit points', () => {
  it('holds a fifth of all the worm hit points before any segment can break', () => {
    expect(sharedPool(50)).toBe(10);
  });

  it('soaks up hits, anywhere, without breaking a segment', () => {
    expect(absorbHit(10, 3)).toEqual({ pool: 7, breaks: false });
  });

  it('breaks the segment that takes the hit that empties it', () => {
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
