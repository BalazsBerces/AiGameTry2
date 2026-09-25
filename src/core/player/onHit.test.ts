import { describe, expect, it } from 'vitest';
import { applyPoison, chainTargets, poisonTick, rollsFreeze, type PoisonRules } from './onHit';
import type { Rng } from '../rng';

const RULES: PoisonRules = { damagePerTick: 0.5, tickMs: 500, durationMs: 2000, maxStacks: 3 };

describe('poison', () => {
  it('stacks with each hit, up to its limit', () => {
    let p = applyPoison(undefined, 0, RULES);
    expect(p.stacks).toBe(1);
    for (let i = 0; i < 5; i++) p = applyPoison(p, 100, RULES);
    expect(p.stacks).toBe(3);
  });

  it('hurts once a tick for every stack', () => {
    const p = applyPoison(applyPoison(undefined, 0, RULES), 0, RULES);
    expect(poisonTick(p, 499, RULES).damage).toBe(0);
    const tick = poisonTick(p, 500, RULES);
    expect(tick.damage).toBe(2 * RULES.damagePerTick);
    expect(poisonTick(tick.poison!, 999, RULES).damage).toBe(0);
    expect(poisonTick(tick.poison!, 1000, RULES).damage).toBe(2 * RULES.damagePerTick);
  });

  it('catches up on ticks missed in a long frame', () => {
    const p = applyPoison(undefined, 0, RULES);
    expect(poisonTick(p, 1600, RULES).damage).toBe(3 * RULES.damagePerTick);
  });

  it('wears off a while after the last hit, and each hit starts that wait again', () => {
    const p = applyPoison(undefined, 0, RULES);
    expect(poisonTick(p, RULES.durationMs + 1, RULES).poison).toBeUndefined();
    const refreshed = applyPoison(p, 1500, RULES);
    expect(poisonTick(refreshed, RULES.durationMs + 1, RULES).poison).toBeDefined();
  });
});

describe('chain lightning', () => {
  const at = (id: string, x: number, y: number) => ({ id, at: { x, y } });
  const enemies = [at('hit', 0, 0), at('near', 1, 0), at('mid', 2.5, 0), at('far', 9, 0), at('other', 1, 2)];

  it('jumps to the nearest other enemy within range', () => {
    expect(chainTargets('hit', enemies, 1, 3)).toEqual(['near']);
  });

  it('jumps on from each enemy it reaches, never to one twice', () => {
    const jumps = chainTargets('hit', enemies, 3, 3);
    expect(jumps).toEqual(['near', 'mid', 'other']);
    expect(new Set(jumps).size).toBe(3);
  });

  it('stops when nobody is left in range', () => {
    expect(chainTargets('hit', [at('hit', 0, 0), at('far', 9, 0)], 3, 3)).toEqual([]);
    expect(chainTargets('hit', enemies, 10, 3)).not.toContain('far');
  });
});

describe('freeze', () => {
  const rolling = (value: number): Rng => ({ next: () => value, int: () => 0, pick: (xs) => xs[0], fork: () => rolling(value) });

  it('stuns when the roll comes in under its chance', () => {
    expect(rollsFreeze(0.25, rolling(0.2))).toBe(true);
    expect(rollsFreeze(0.25, rolling(0.3))).toBe(false);
  });
});
