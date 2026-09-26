import { describe, expect, it } from 'vitest';
import type { Tile } from '../rooms/roomGenerator';
import { DOWN, LEFT, RIGHT, UP, joinsBetween, neighbourMask } from './autotile';

/** `~` pond, `T` tree, `x` thorn, `.` floor. */
const grid = (rows: string[]): Tile[][] =>
  rows.map((row) => [...row].map((c) => ({ '~': 'hole', T: 'obstacle', x: 'thorn', '.': 'floor' })[c] as Tile));

describe('autotile', () => {
  const pond = grid([
    '.....',
    '.~~~.',
    '.~~~.',
    '.~~~.',
    '..~..',
  ]);

  it('gives a lone piece no neighbours', () => {
    expect(neighbourMask(grid(['...', '.~.', '...']), 1, 1)).toBe(0);
  });

  it('marks each side that carries on as the same tile', () => {
    expect(neighbourMask(pond, 2, 2)).toBe(UP | RIGHT | DOWN | LEFT); // inner
    expect(neighbourMask(pond, 2, 1)).toBe(RIGHT | DOWN | LEFT); // top edge
    expect(neighbourMask(pond, 1, 1)).toBe(RIGHT | DOWN); // top-left corner
    expect(neighbourMask(pond, 3, 3)).toBe(UP | LEFT); // bottom-right corner
    expect(neighbourMask(pond, 2, 4)).toBe(UP); // the tip of a spur
  });

  it('treats the room edge as not the same tile', () => {
    expect(neighbourMask(grid(['~~', '~~']), 0, 0)).toBe(RIGHT | DOWN);
  });

  it('only counts the same kind of tile', () => {
    expect(neighbourMask(grid(['T~T']), 1, 0)).toBe(0);
  });

  it('lists each pair of touching joinable tiles once, across or down', () => {
    const tiles = grid([
      'TT.',
      'T.x',
      '..x',
    ]);
    expect(joinsBetween(tiles, ['obstacle', 'thorn'])).toEqual([
      { x: 0, y: 0, dir: 'across', tile: 'obstacle' },
      { x: 0, y: 0, dir: 'down', tile: 'obstacle' },
      { x: 2, y: 1, dir: 'down', tile: 'thorn' },
    ]);
  });

  it('never joins tiles of different kinds, or kinds that are not joinable', () => {
    expect(joinsBetween(grid(['Tx', '~~']), ['obstacle', 'thorn'])).toEqual([]);
  });
});
