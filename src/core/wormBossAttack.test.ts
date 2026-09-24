import { describe, expect, it } from 'vitest';
import { STEP, type Cell, type Direction } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import { burrowAt, canAttack, diveCell, inPhaseTwo, planExit, spitWave, WORM_BOSS } from './wormBossAttack';
import { createWorm } from './wormChain';

/** ASCII fixture: `.` floor, `#` stone, `r` rock. */
const grid = (rows: string[]): Tile[][] =>
  rows.map((row) => [...row].map((ch): Tile => (ch === '#' ? 'obstacle' : ch === 'r' ? 'rock' : 'floor')));
const key = (c: Cell) => `${c.x},${c.y}`;

/** A worm-arena-like fixture: rock walls every third row and column, some broken through. */
const maze = grid([
  '..............',
  '..r..r..r..r..',
  '..r..r.....r..',
  'rrr.rrr.rrrrr.',
  '..r..r..r..r..',
  '.....r..r.....',
  'r.rrrr.rrr.rrr',
  '..r.....r..r..',
  '..r..r..r..r..',
]);

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

describe('worm boss exit', () => {
  const width = maze[0].length;
  const height = maze.length;
  const inRoom = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height;

  it('comes out of a spot in one of the outer walls, never a corner', () => {
    const sides = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const { exit, heading } = planExit(maze, [], createRng(seed));
      expect(inRoom(exit), `seed ${seed}`).toBe(false);
      const front = { x: exit.x + STEP[heading].x, y: exit.y + STEP[heading].y };
      expect(inRoom(front), `seed ${seed}`).toBe(true);
      sides.add(heading);
    }
    expect([...sides].sort()).toEqual(['down', 'left', 'right', 'up']);
  });

  it('marks a lane of three cells running straight into the room from the exit', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { exit, heading, lane } = planExit(maze, [], createRng(seed));
      expect(lane.map(key)).toEqual(
        [1, 2, 3].map((i) => key({ x: exit.x + STEP[heading].x * i, y: exit.y + STEP[heading].y * i })),
      );
    }
  });

  it('breaks exactly the rocks in its lane', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { lane, breaks } = planExit(maze, [], createRng(seed));
      expect(breaks.map(key).sort()).toEqual(lane.filter((c) => maze[c.y][c.x] === 'rock').map(key).sort());
    }
  });

  it('never comes out into stone or through a doorway', () => {
    const tiles = grid(['#.....', '#.....', '#.....', '......']);
    const door = { side: 'right' as const, cell: { x: 5, y: 1 } };
    for (let seed = 0; seed < 60; seed++) {
      const { lane, exit } = planExit(tiles, [door], createRng(seed));
      for (const c of lane) expect(tiles[c.y][c.x], `seed ${seed}`).not.toBe('obstacle');
      expect(key(exit), `seed ${seed}`).not.toBe('6,1');
    }
  });
});

describe('worm boss burrow timeline', () => {
  const plan = planExit(maze, [], createRng(3));
  const { undergroundMs, exitWarningMs, burstMs } = WORM_BOSS;
  const keys = (cells: Cell[]) => cells.map(key).sort();

  it('rumbles first, marking nothing and hurting no one', () => {
    const now = burrowAt(plan, undergroundMs - exitWarningMs - 1);
    expect(now.phase).toBe('rumbling');
    expect(now.marked).toEqual([]);
    expect(now.hurting).toEqual([]);
  });

  it('then marks the lane in front of the exit, still hurting no one', () => {
    for (const t of [undergroundMs - exitWarningMs, undergroundMs - 1]) {
      const now = burrowAt(plan, t);
      expect(now.phase).toBe('warning');
      expect(keys(now.marked)).toEqual(keys(plan.lane));
      expect(now.hurting).toEqual([]);
    }
  });

  it('bursts out through the lane, which hurts for a moment', () => {
    for (const t of [undergroundMs, undergroundMs + burstMs - 1]) {
      const now = burrowAt(plan, t);
      expect(now.phase).toBe('bursting');
      expect(keys(now.hurting)).toEqual(keys(plan.lane));
      expect(now.marked).toEqual([]);
    }
  });

  it('is over once the burst has passed', () => {
    const now = burrowAt(plan, undergroundMs + burstMs);
    expect(now.phase).toBe('over');
    expect(now.marked).toEqual([]);
    expect(now.hurting).toEqual([]);
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
