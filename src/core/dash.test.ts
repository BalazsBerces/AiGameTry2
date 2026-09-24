import { describe, expect, it } from 'vitest';
import { isDashing, tryDash, type DashRules } from './dash';

const RULES: DashRules = { distanceTiles: 2.5, durationMs: 150, cooldownMs: 900 };
const RIGHT = { x: 1, y: 0 };

describe('dash', () => {
  it('goes the way the player is moving, for its duration', () => {
    const d = tryDash(undefined, 1000, RIGHT, RULES)!;
    expect(d.dir).toEqual(RIGHT);
    expect(isDashing(d, 1000)).toBe(true);
    expect(isDashing(d, 1000 + RULES.durationMs - 1)).toBe(true);
    expect(isDashing(d, 1000 + RULES.durationMs)).toBe(false);
  });

  it('needs the player to be moving', () => {
    expect(tryDash(undefined, 1000, { x: 0, y: 0 }, RULES)).toBeUndefined();
  });

  it('waits out its cooldown before the next dash', () => {
    const d = tryDash(undefined, 1000, RIGHT, RULES)!;
    expect(tryDash(d, 1000 + RULES.cooldownMs - 1, RIGHT, RULES)).toBe(d);
    const again = tryDash(d, 1000 + RULES.cooldownMs, RIGHT, RULES)!;
    expect(again).not.toBe(d);
    expect(isDashing(again, 1000 + RULES.cooldownMs)).toBe(true);
  });

  it('covers its distance at a steady speed', () => {
    const d = tryDash(undefined, 0, { x: 0, y: -1 }, RULES)!;
    expect(d.speedTilesPerSec * (RULES.durationMs / 1000)).toBeCloseTo(RULES.distanceTiles);
  });
});
