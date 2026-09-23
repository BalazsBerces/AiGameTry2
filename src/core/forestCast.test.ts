import { describe, expect, it } from 'vitest';
import { createGoblin, goblinStep, spreadShots, updateGoblin } from './forestCast';

/**
 * Distance field of a 5x1 corridor with the player at x=0: the goblin at x=2 steps to x=1 to
 * chase and to x=3 to get away.
 */
const CORRIDOR = [[0, 1, 2, 3, 4]];
const HERE = { x: 2, y: 0 };

describe('goblin', () => {
  it('chases the player while at half HP or more', () => {
    const g = updateGoblin(createGoblin(), 2, 4, 1000);
    expect(g.mode).toBe('chase');
    expect(goblinStep(g, CORRIDOR, HERE)).toEqual({ x: 1, y: 0 });
  });

  it('runs away from the player once below half HP', () => {
    const g = updateGoblin(createGoblin(), 1, 4, 1000);
    expect(g.mode).toBe('retreat');
    expect(goblinStep(g, CORRIDOR, HERE)).toEqual({ x: 3, y: 0 });
  });

  it('keeps retreating for a while, then comes back for good', () => {
    let g = updateGoblin(createGoblin(), 1, 4, 1000);
    g = updateGoblin(g, 1, 4, 2000);
    expect(g.mode).toBe('retreat');
    g = updateGoblin(g, 1, 4, 10_000);
    expect(g.mode).toBe('chase');
    expect(goblinStep(g, CORRIDOR, HERE)).toEqual({ x: 1, y: 0 });
    // Still hurt, but it has already regrouped: it doesn't flee again.
    g = updateGoblin(g, 1, 4, 20_000);
    expect(g.mode).toBe('chase');
  });

  it('holds its ground when cornered while retreating', () => {
    const g = updateGoblin(createGoblin(), 1, 4, 0);
    expect(goblinStep(g, CORRIDOR, { x: 4, y: 0 })).toBeUndefined();
  });

  it('never retreats onto a cell it cannot walk to', () => {
    const g = updateGoblin(createGoblin(), 1, 4, 0);
    expect(goblinStep(g, [[0, 1, 2, Infinity]], HERE)).toBeUndefined();
  });
});

describe('seed-spitter spread', () => {
  const close = (actual: { x: number; y: number }[], expected: { x: number; y: number }[]) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => {
      expect(v.x).toBeCloseTo(expected[i].x, 6);
      expect(v.y).toBeCloseTo(expected[i].y, 6);
    });
  };

  it('fires three shots at the given speed: one straight at the target and one either side', () => {
    // Aiming right at speed 10 with a 90 degree fan: straight right, straight up, straight down.
    close(spreadShots({ x: 5, y: 0 }, 10, Math.PI / 2), [
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      { x: 0, y: 10 },
    ]);
  });

  it('turns the fan with the aim', () => {
    // Aiming down-left at speed 2 with a 45 degree fan.
    const r = Math.SQRT1_2 * 2;
    close(spreadShots({ x: -3, y: 3 }, 2, Math.PI / 4), [
      { x: -r, y: r },
      { x: 0, y: 2 },
      { x: -2, y: 0 },
    ]);
  });

  it('fans its default spread evenly, well short of a right angle', () => {
    const [middle, a, b] = spreadShots({ x: 0, y: 1 }, 1);
    expect(middle.x).toBeCloseTo(0, 6);
    expect(middle.y).toBeCloseTo(1, 6);
    expect(a.x).toBeCloseTo(-b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.y).toBeGreaterThan(0.8);
    expect(a.y).toBeLessThan(1);
  });
});
