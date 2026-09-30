import { describe, expect, it } from 'vitest';
import type { Tile } from '../rooms/roomGenerator';
import { swordCells, type Swing } from './swordSwing';

/** A 9x9 floor room with the given tiles placed. */
function room(place: [number, number, Tile][]): Tile[][] {
  const tiles: Tile[][] = Array.from({ length: 9 }, () => Array<Tile>(9).fill('floor'));
  for (const [x, y, t] of place) tiles[y][x] = t;
  return tiles;
}

// The player stands in the middle of cell (4,4), swinging right with a reach of 1.5 tiles.
const right: Swing = { from: { x: 4.5, y: 4.5 }, facing: 0, arcDeg: 90, reach: 1.5 };

describe('a sword swing’s terrain hits', () => {
  it('hits a rock inside the arc and in reach', () => {
    expect(swordCells(right, room([[5, 4, 'rock']]))).toEqual([{ x: 5, y: 4 }]);
  });

  it('bursts a glowshroom inside the arc', () => {
    expect(swordCells(right, room([[5, 4, 'glowshroom']]))).toEqual([{ x: 5, y: 4 }]);
  });

  it('misses a rock behind the player', () => {
    expect(swordCells(right, room([[3, 4, 'rock']]))).toEqual([]);
  });

  it('misses a rock outside the arc', () => {
    expect(swordCells(right, room([[4, 5, 'rock'], [4, 3, 'rock']]))).toEqual([]);
  });

  it('misses a rock out of reach', () => {
    expect(swordCells(right, room([[7, 4, 'rock']]))).toEqual([]);
  });

  it('reaches cells with the wider level 2 arc that level 1 misses', () => {
    // (5,6) sits about 63° off the facing: outside a 90° arc, inside a 140° one.
    const tiles = room([[5, 6, 'rock']]);
    expect(swordCells({ ...right, reach: 2 }, tiles)).toEqual([]);
    expect(swordCells({ ...right, reach: 2, arcDeg: 140 }, tiles)).toEqual([{ x: 5, y: 6 }]);
  });

  it('hits every breakable cell in the arc, once each', () => {
    const tiles = room([[5, 4, 'rock'], [5, 5, 'rock'], [5, 3, 'glowshroom']]);
    const hit = swordCells({ ...right, arcDeg: 140 }, tiles);
    expect(hit).toHaveLength(3);
    expect(hit).toEqual(expect.arrayContaining([{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 3 }]));
  });

  it('never hits unbreakable tiles', () => {
    for (const t of ['obstacle', 'crystal', 'hole', 'thorn', 'wall', 'crusher', 'floor'] as const) {
      expect(swordCells(right, room([[5, 4, t]])), t).toEqual([]);
    }
  });

  it('swings in any direction', () => {
    const up: Swing = { ...right, facing: -Math.PI / 2 };
    expect(swordCells(up, room([[4, 3, 'rock'], [5, 4, 'rock']]))).toEqual([{ x: 4, y: 3 }]);
  });
});
