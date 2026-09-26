import { describe, expect, it } from 'vitest';
import { createShake } from './shake';

describe('screen shake budget', () => {
  it('shakes by an event\'s amount, easing to nothing over its length', () => {
    const shake = createShake(10);
    shake.add(1000, 4, 200);
    expect(shake.amount(1000)).toBe(4);
    expect(shake.amount(1100)).toBeCloseTo(2);
    expect(shake.amount(1200)).toBe(0);
    expect(shake.amount(5000)).toBe(0);
  });

  it('adds up stacked events, but never past the cap', () => {
    const shake = createShake(6);
    shake.add(0, 2, 300);
    shake.add(0, 3, 300);
    expect(shake.amount(0)).toBe(5);
    for (let i = 0; i < 10; i++) shake.add(10, 5, 300);
    for (const t of [10, 50, 150, 299]) expect(shake.amount(t)).toBeLessThanOrEqual(6);
    expect(shake.amount(310)).toBe(0);
  });

  it('keeps even one huge event under the cap', () => {
    const shake = createShake(6);
    shake.add(0, 40, 100);
    expect(shake.amount(0)).toBe(6);
  });
});
