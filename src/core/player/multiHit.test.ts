import { describe, expect, it } from 'vitest';
import { createFalloff, createHitGate } from './multiHit';

describe('multi-hit falloff', () => {
  const worm = {};

  it('deals full damage on the first touch of a group', () => {
    expect(createFalloff().damage(worm, 4)).toBe(4);
  });

  it('halves each later touch of the same group in the same attack', () => {
    const shot = createFalloff();
    expect([1, 2, 3, 4].map(() => shot.damage(worm, 4))).toEqual([4, 2, 1, 0.5]);
  });

  it('never deals more than twice a single hit, however many parts it touches', () => {
    const swing = createFalloff();
    let total = 0;
    for (let i = 0; i < 40; i++) total += swing.damage(worm, 3);
    expect(total).toBeLessThanOrEqual(6);
    expect(total).toBeGreaterThan(5.9);
  });

  it('keeps each group’s falloff to itself', () => {
    const other = {};
    const blast = createFalloff();
    expect(blast.damage(worm, 6)).toBe(6);
    expect(blast.damage(other, 6)).toBe(6);
    expect(blast.damage(worm, 6)).toBe(3);
    expect(blast.damage(other, 6)).toBe(3);
  });

  it('always deals full damage to enemies without a group', () => {
    const shot = createFalloff();
    expect([1, 2, 3].map(() => shot.damage(undefined, 2))).toEqual([2, 2, 2]);
  });

  it('starts over with a new attack', () => {
    const first = createFalloff();
    first.damage(worm, 4);
    first.damage(worm, 4);
    expect(createFalloff().damage(worm, 4)).toBe(4);
  });
});

describe('hit gate', () => {
  const worm = {};

  it('lets a group through once per interval and blocks it in between', () => {
    const gate = createHitGate();
    expect(gate.pass(worm, 0, 350)).toBe(true);
    expect(gate.pass(worm, 100, 350)).toBe(false);
    expect(gate.pass(worm, 349, 350)).toBe(false);
    expect(gate.pass(worm, 350, 350)).toBe(true);
    expect(gate.pass(worm, 400, 350)).toBe(false);
  });

  it('gates each group on its own', () => {
    const gate = createHitGate();
    const segment = {};
    expect(gate.pass(worm, 0, 350)).toBe(true);
    expect(gate.pass(segment, 10, 350)).toBe(true);
    expect(gate.pass(segment, 20, 350)).toBe(false);
  });
});
