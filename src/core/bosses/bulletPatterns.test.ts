import { describe, expect, it } from 'vitest';
import { fan, ring, spiral } from './bulletPatterns';

const deg = (rad: number) => Math.round((((rad * 180) / Math.PI) % 360) + 360) % 360;

describe('bullet patterns', () => {
  it('spaces a ring evenly around the full circle', () => {
    expect(ring(4).map(deg)).toEqual([0, 90, 180, 270]);
  });

  it('turns a spiral by its spin rate as time passes', () => {
    expect(spiral(2, 0, 90).map(deg)).toEqual([0, 180]);
    expect(spiral(2, 500, 90).map(deg)).toEqual([45, 225]);
    expect(spiral(2, 2000, 90).map(deg)).toEqual([180, 0]);
  });

  it('centres a fan on its aim, spread evenly across its width', () => {
    expect(fan(Math.PI / 2, 3, Math.PI / 2).map(deg)).toEqual([45, 90, 135]);
  });

  it('fires a one-bullet fan straight along its aim', () => {
    expect(fan(Math.PI, 1, Math.PI / 2).map(deg)).toEqual([180]);
  });
});
