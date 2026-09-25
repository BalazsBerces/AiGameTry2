import { describe, expect, it } from 'vitest';
import { isStunned, stun, type Stunnable } from './stun';

describe('shared enemy stun', () => {
  it('leaves an enemy that was never stunned free to act', () => {
    const enemy: Stunnable = {};
    expect(isStunned(enemy, 0)).toBe(false);
  });

  it('pauses an enemy for the given duration, then lets it act again', () => {
    const enemy: Stunnable = {};
    stun(enemy, 1000, 1500);
    expect(isStunned(enemy, 1000)).toBe(true);
    expect(isStunned(enemy, 2499)).toBe(true);
    expect(isStunned(enemy, 2500)).toBe(false);
  });

  it('works on any enemy object, keeping its other fields', () => {
    const enemy = { hp: 3, update: () => undefined } as Stunnable & { hp: number };
    stun(enemy, 0, 100);
    expect(enemy.hp).toBe(3);
    expect(isStunned(enemy, 50)).toBe(true);
  });

  it('never cuts short a longer stun already running', () => {
    const enemy: Stunnable = {};
    stun(enemy, 0, 2000);
    stun(enemy, 500, 100);
    expect(isStunned(enemy, 1500)).toBe(true);
    stun(enemy, 1500, 1000);
    expect(isStunned(enemy, 2400)).toBe(true);
    expect(isStunned(enemy, 2500)).toBe(false);
  });
});
