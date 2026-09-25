import { describe, expect, it } from 'vitest';
import { stunBurst } from './glowshroom';
import { isStunned, type Stunnable } from '../enemies/stun';

/** A target standing at the centre of tile (x, y), in tile units. */
const standing = (target: Stunnable, x: number, y: number) => ({ target, at: { x: x + 0.5, y: y + 0.5 } });

describe('glowshroom stun burst', () => {
  const shroom = { x: 6, y: 3 };

  it('stuns enemies and the player close to the burst, and nobody further off', () => {
    const player: Stunnable = {};
    const beside: Stunnable = {};
    const diagonal: Stunnable = {};
    const across: Stunnable = {};
    const stunned = stunBurst(shroom, [standing(player, 5, 3), standing(beside, 7, 3), standing(diagonal, 7, 4), standing(across, 11, 3)], 1000);
    expect(stunned).toEqual([player, beside, diagonal]);
    for (const t of [player, beside, diagonal]) expect(isStunned(t, 1000)).toBe(true);
    expect(isStunned(across, 1000)).toBe(false);
  });

  it('keeps a small radius: three tiles away is already safe', () => {
    const near: Stunnable = {};
    const far: Stunnable = {};
    stunBurst(shroom, [standing(near, 6, 1), standing(far, 6, 0)], 0);
    expect(isStunned(near, 0)).toBe(true);
    expect(isStunned(far, 0)).toBe(false);
  });

  it('wears off after about a second and a half', () => {
    const player: Stunnable = {};
    stunBurst(shroom, [standing(player, 6, 4)], 2000);
    expect(isStunned(player, 3200)).toBe(true);
    expect(isStunned(player, 3800)).toBe(false);
  });

  it('never shortens a longer stun a target is already under', () => {
    const boar: Stunnable = { stunnedUntil: 10_000 };
    stunBurst(shroom, [standing(boar, 6, 3)], 0);
    expect(isStunned(boar, 9_000)).toBe(true);
  });
});
