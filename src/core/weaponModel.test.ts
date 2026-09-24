import { describe, expect, it } from 'vitest';
import { launchVelocity, resolveWeapon, SHOT_SKEW } from './weaponModel';

describe('resolveWeapon', () => {
  it('fires plain shots with no passives', () => {
    expect(resolveWeapon({})).toMatchObject({ mode: 'shots', fireDelayMs: 330, damage: 1, homing: false });
  });

  it('homing makes shots home without changing rate or damage', () => {
    expect(resolveWeapon({ homing: 1 })).toMatchObject({ mode: 'shots', fireDelayMs: 330, damage: 1, homing: true, homingTurnRate: 5 });
  });

  it('fire rate drastically speeds up shots but lowers their damage', () => {
    expect(resolveWeapon({ fireRate: 1 })).toMatchObject({ mode: 'shots', fireDelayMs: 132, damage: 0.5, homing: false });
  });

  it('homing and fire rate stack, whatever order they were picked up in', () => {
    expect(resolveWeapon({ homing: 1, fireRate: 1 })).toMatchObject({ mode: 'shots', fireDelayMs: 132, damage: 0.5, homing: true });
    expect(resolveWeapon({ fireRate: 1, homing: 1 })).toEqual(resolveWeapon({ homing: 1, fireRate: 1 }));
  });

  it('the sword replaces shots with slower, harder swings', () => {
    expect(resolveWeapon({ sword: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 450, damage: 3, homing: false, swordArcDeg: 90 });
  });

  it('homing has no effect on the sword', () => {
    expect(resolveWeapon({ sword: 1, homing: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 450, damage: 3, homing: false });
  });

  it('fire rate speeds up and weakens sword swings', () => {
    expect(resolveWeapon({ sword: 1, fireRate: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 180, damage: 1.5, homing: false });
  });

  it('all three passives together: fast, weakened sword without homing', () => {
    expect(resolveWeapon({ homing: 1, sword: 1, fireRate: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 180, damage: 1.5, homing: false });
  });
});

describe('resolveWeapon at level 2', () => {
  it('upgraded homing turns faster', () => {
    expect(resolveWeapon({ homing: 2 }).homingTurnRate).toBeGreaterThan(resolveWeapon({ homing: 1 }).homingTurnRate);
  });

  it('upgraded fire rate keeps its speed but loses less damage', () => {
    const one = resolveWeapon({ fireRate: 1 });
    const two = resolveWeapon({ fireRate: 2 });
    expect(two.fireDelayMs).toBe(one.fireDelayMs);
    expect(two.damage).toBeGreaterThan(one.damage);
    expect(two.damage).toBeLessThan(1);
  });

  it('an upgraded sword swings a wider arc, as hard and as often', () => {
    const one = resolveWeapon({ sword: 1 });
    const two = resolveWeapon({ sword: 2 });
    expect(two.swordArcDeg).toBeGreaterThan(one.swordArcDeg);
    expect(two).toMatchObject({ damage: one.damage, fireDelayMs: one.fireDelayMs });
  });
});

const SHOT_SPEED = 400;

describe('launchVelocity', () => {
  it('fires a pure cardinal shot at base speed when the player stands still', () => {
    expect(launchVelocity('up', { x: 0, y: 0 }, SHOT_SPEED)).toEqual({ x: 0, y: -400 });
    expect(launchVelocity('right', { x: 0, y: 0 }, SHOT_SPEED)).toEqual({ x: 400, y: 0 });
  });

  it('moving sideways bends the shot toward the movement', () => {
    const v = launchVelocity('up', { x: 200, y: 0 }, SHOT_SPEED);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
  });

  it('moving along the aim speeds the shot up, moving against it slows it down', () => {
    expect(-launchVelocity('up', { x: 0, y: -200 }, SHOT_SPEED).y).toBeGreaterThan(SHOT_SPEED);
    expect(-launchVelocity('up', { x: 0, y: 200 }, SHOT_SPEED).y).toBeLessThan(SHOT_SPEED);
  });

  it('stays within the skew bounds of the aim direction for any player velocity', () => {
    for (const aim of ['up', 'down', 'left', 'right'] as const) {
      for (let px = -2000; px <= 2000; px += 250) {
        for (let py = -2000; py <= 2000; py += 250) {
          const v = launchVelocity(aim, { x: px, y: py }, SHOT_SPEED);
          const speed = Math.hypot(v.x, v.y);
          const along = aim === 'up' ? -v.y : aim === 'down' ? v.y : aim === 'left' ? -v.x : v.x;
          const angleDeg = (Math.acos(along / speed) * 180) / Math.PI;
          expect(speed).toBeGreaterThanOrEqual(SHOT_SPEED * SHOT_SKEW.minSpeedFactor - 1e-9);
          expect(speed).toBeLessThanOrEqual(SHOT_SPEED * SHOT_SKEW.maxSpeedFactor + 1e-9);
          expect(angleDeg).toBeLessThanOrEqual(SHOT_SKEW.maxAngleDeg + 1e-9);
        }
      }
    }
  });
});
