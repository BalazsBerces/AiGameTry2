import { describe, expect, it } from 'vitest';
import type { Cell } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import { burrowAt, canAttack, inPhaseTwo, planBurrow, spitWave, WORM_BOSS } from './wormBossAttack';

/** ASCII fixture: `.` floor, `#` stone, `r` rock. */
const grid = (rows: string[]): Tile[][] =>
  rows.map((row) => [...row].map((ch): Tile => (ch === '#' ? 'obstacle' : ch === 'r' ? 'rock' : 'floor')));
const key = (c: Cell) => `${c.x},${c.y}`;
const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

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

describe('worm boss burrow', () => {
  it('surfaces two to four tiles from the player, on floor or rock, never on the room edge', () => {
    for (let seed = 0; seed < 40; seed++) {
      const player = { x: 3 + (seed % 8), y: 2 + (seed % 5) };
      const { surface } = planBurrow(maze, { x: 0, y: 0 }, player, createRng(seed));
      expect(manhattan(surface, player), `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(manhattan(surface, player), `seed ${seed}`).toBeLessThanOrEqual(4);
      expect(['floor', 'rock']).toContain(maze[surface.y][surface.x]);
      expect(surface.x > 0 && surface.y > 0 && surface.x < 13 && surface.y < 8, `seed ${seed}`).toBe(true);
    }
  });

  it('digs an unbroken tunnel from where it dives to where it surfaces', () => {
    const head = { x: 1, y: 7 };
    const { tunnel, surface } = planBurrow(maze, head, { x: 10, y: 2 }, createRng(3));
    expect(key(tunnel[0])).toBe(key(head));
    expect(key(tunnel[tunnel.length - 1])).toBe(key(surface));
    for (let i = 1; i < tunnel.length; i++) expect(manhattan(tunnel[i], tunnel[i - 1])).toBe(1);
  });

  it('breaks exactly the rocks along the tunnel and around the exit', () => {
    const plan = planBurrow(maze, { x: 1, y: 7 }, { x: 10, y: 2 }, createRng(3));
    const onTunnel = plan.tunnel.filter((c) => maze[c.y][c.x] === 'rock');
    const aroundExit = maze.flatMap((row, y) =>
      row.flatMap((t, x) => (t === 'rock' && chebyshev({ x, y }, plan.surface) <= 1 ? [{ x, y }] : [])),
    );
    const expected = new Set([...onTunnel, ...aroundExit].map(key));
    expect(new Set(plan.breaks.map(key))).toEqual(expected);
  });

  it('drops rocks around the exit, never on the exit itself or on stone', () => {
    const tiles = grid(['..........', '..........', '....#.....', '..........', '..........', '..........']);
    for (let seed = 0; seed < 20; seed++) {
      const plan = planBurrow(tiles, { x: 0, y: 5 }, { x: 5, y: 1 }, createRng(seed));
      expect(plan.rockfall.length).toBeGreaterThan(0);
      for (const c of plan.rockfall) {
        expect(chebyshev(c, plan.surface)).toBeGreaterThanOrEqual(1);
        expect(chebyshev(c, plan.surface)).toBeLessThanOrEqual(2);
        expect(tiles[c.y]?.[c.x]).toBe('floor');
      }
    }
  });
});

describe('worm boss burrow timeline', () => {
  const plan = planBurrow(maze, { x: 1, y: 7 }, { x: 10, y: 2 }, createRng(3));
  const { surfaceTelegraphMs, eruptMs, rockTelegraphMs, rockHurtMs } = WORM_BOSS;
  const keys = (cells: Cell[]) => cells.map(key).sort();

  it('stays underground while the exit is marked, hurting no one', () => {
    const now = burrowAt(plan, surfaceTelegraphMs - 1);
    expect(now.underground).toBe(true);
    expect(keys(now.warning)).toEqual([key(plan.surface)]);
    expect(now.hurting).toEqual([]);
  });

  it('bursts out at the marked exit, which hurts, while the falling rocks are marked', () => {
    const now = burrowAt(plan, surfaceTelegraphMs + 1);
    expect(now.underground).toBe(false);
    expect(keys(now.hurting)).toEqual([key(plan.surface)]);
    expect(keys(now.warning)).toEqual(keys(plan.rockfall));
  });

  it('then brings the rocks down on their marked cells, and is over once they land', () => {
    const landing = burrowAt(plan, surfaceTelegraphMs + rockTelegraphMs + 1);
    expect(keys(landing.hurting)).toEqual(keys(plan.rockfall));
    expect(landing.over).toBe(false);
    expect(eruptMs).toBeLessThanOrEqual(rockTelegraphMs);
    expect(burrowAt(plan, surfaceTelegraphMs + rockTelegraphMs + rockHurtMs + 1).over).toBe(true);
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
