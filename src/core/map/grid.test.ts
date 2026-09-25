import { describe, expect, it } from 'vitest';
import { distanceField } from './grid';

const open = (tile: string) => tile === '.';

describe('distanceField', () => {
  it('routes around a blocked cell on open floor, and never through it', () => {
    // 3x3 open floor, target on the left middle, the centre held by something rooted.
    const grid = ['...', '...', '...'].map((r) => [...r]);
    const centre = (c: { x: number; y: number }) => c.x === 1 && c.y === 1;
    expect(distanceField(grid, { x: 0, y: 1 }, open, centre)).toEqual([
      [1, 2, 3],
      [0, Infinity, 4],
      [1, 2, 3],
    ]);
  });
});
