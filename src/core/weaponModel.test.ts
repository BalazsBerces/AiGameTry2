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

  it('homing leaves the swing itself alone, but its blade wave homes', () => {
    expect(resolveWeapon({ sword: 1, homing: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 450, damage: 3, homing: true, bladeWave: true });
  });

  it('fire rate speeds up and weakens sword swings', () => {
    expect(resolveWeapon({ sword: 1, fireRate: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 180, damage: 1.5, homing: false });
  });

  it('all three passives together: fast, weakened sword throwing homing blade waves', () => {
    expect(resolveWeapon({ homing: 1, sword: 1, fireRate: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 180, damage: 1.5, homing: true, bladeWave: true });
  });
});

describe('resolveWeapon stat-ups', () => {
  it('each damage up adds half a point to plain shots', () => {
    expect(resolveWeapon({}, { damage: 1 })).toMatchObject({ fireDelayMs: 330, damage: 1.5 });
    expect(resolveWeapon({}, { damage: 3 })).toMatchObject({ fireDelayMs: 330, damage: 2.5 });
  });

  it('damage ups raise the sword too', () => {
    expect(resolveWeapon({ sword: 1 }, { damage: 1 })).toMatchObject({ mode: 'sword', fireDelayMs: 450, damage: 3.5 });
  });

  it('damage ups add to the base before fire rate and triple shot scale it', () => {
    expect(resolveWeapon({ fireRate: 1 }, { damage: 1 }).damage).toBe(0.75);
    expect(resolveWeapon({ triple: 1 }, { damage: 2 }).damage).toBe(1.5);
  });

  it('blade waves and chain lightning grow with it; orbitals and the dash do not', () => {
    const plain = resolveWeapon({ sword: 1, homing: 1, chain: 1, orbital: 1, dash: 2 });
    const boosted = resolveWeapon({ sword: 1, homing: 1, chain: 1, orbital: 1, dash: 2 }, { damage: 2 });
    expect(boosted.damage).toBe(4);
    expect(boosted.bladeWave).toBe(true);
    expect(boosted.chain).toEqual(plain.chain);
    expect(boosted.dash).toEqual(plain.dash);
    expect(boosted.orbitals).toBe(plain.orbitals);
    expect(boosted.poison).toEqual(plain.poison);
  });
});

describe('resolveWeapon utility passives', () => {
  it('has no orbitals and no dash without them', () => {
    expect(resolveWeapon({})).toMatchObject({ orbitals: 0, dash: undefined });
  });

  it('orbital circles one orb round the player, two once upgraded', () => {
    expect(resolveWeapon({ orbital: 1 }).orbitals).toBe(1);
    expect(resolveWeapon({ orbital: 2 }).orbitals).toBe(2);
  });

  it('dash cools down quicker and hurts what it passes through once upgraded', () => {
    const one = resolveWeapon({ dash: 1 }).dash!;
    const two = resolveWeapon({ dash: 2 }).dash!;
    expect(one.damage).toBe(0);
    expect(two.damage).toBeGreaterThan(0);
    expect(two.cooldownMs).toBeLessThan(one.cooldownMs);
    expect(two.distanceTiles).toBe(one.distanceTiles);
  });

  it('works alongside the sword too', () => {
    expect(resolveWeapon({ sword: 1, orbital: 1, dash: 1 })).toMatchObject({ mode: 'sword', orbitals: 1, dash: expect.any(Object), bladeWave: false });
  });
});

describe('resolveWeapon on-hit passives', () => {
  it('has no on-hit effects without them', () => {
    expect(resolveWeapon({})).toMatchObject({ poison: undefined, chain: undefined, freeze: undefined });
  });

  it('poison lasts longer and stacks higher once upgraded', () => {
    const one = resolveWeapon({ poison: 1 }).poison!;
    const two = resolveWeapon({ poison: 2 }).poison!;
    expect(one.damagePerTick).toBeGreaterThan(0);
    expect(two.durationMs).toBeGreaterThan(one.durationMs);
    expect(two.maxStacks).toBeGreaterThan(one.maxStacks);
  });

  it('chain lightning jumps once at half damage, two more times once upgraded', () => {
    expect(resolveWeapon({ chain: 1 }).chain).toMatchObject({ jumps: 1, damageFactor: 0.5 });
    expect(resolveWeapon({ chain: 2 }).chain).toMatchObject({ jumps: 3, damageFactor: 0.5 });
  });

  it('freeze is likelier once upgraded', () => {
    expect(resolveWeapon({ freeze: 2 }).freeze!.chance).toBeGreaterThan(resolveWeapon({ freeze: 1 }).freeze!.chance);
  });

  it('works on sword swings as well as shots', () => {
    expect(resolveWeapon({ sword: 1, poison: 1, chain: 1, freeze: 1 })).toMatchObject({
      mode: 'sword',
      poison: expect.any(Object),
      chain: expect.any(Object),
      freeze: expect.any(Object),
    });
  });

  it('does not make the sword throw blade waves on its own', () => {
    expect(resolveWeapon({ sword: 1, poison: 1, chain: 1, freeze: 1 }).bladeWave).toBe(false);
  });
});

describe('resolveWeapon shot passives', () => {
  it('plain shots fly alone, stop at what they hit, and never come back', () => {
    expect(resolveWeapon({})).toMatchObject({
      shots: 1,
      piercesEnemies: false,
      piercesTerrain: false,
      bounces: 0,
      spectral: false,
      passesShields: false,
      boomerang: undefined,
      bladeWave: false,
    });
  });

  it('triple shot fires three in a spread, five once upgraded, each a little weaker', () => {
    const one = resolveWeapon({ triple: 1 });
    expect(one.shots).toBe(3);
    expect(one.spreadDeg).toBeGreaterThan(0);
    expect(one.damage).toBeLessThan(1);
    expect(one.damage).toBeGreaterThan(0.5);
    expect(resolveWeapon({ triple: 2 })).toMatchObject({ shots: 5, damage: one.damage });
  });

  it('piercing passes through enemies, and through rock too once upgraded', () => {
    expect(resolveWeapon({ pierce: 1 })).toMatchObject({ piercesEnemies: true, piercesTerrain: false });
    expect(resolveWeapon({ pierce: 2 })).toMatchObject({ piercesEnemies: true, piercesTerrain: true });
  });

  it('ricochet bounces twice, four times once upgraded', () => {
    expect(resolveWeapon({ ricochet: 1 }).bounces).toBe(2);
    expect(resolveWeapon({ ricochet: 2 }).bounces).toBe(4);
  });

  it('spectral flies through stone, and past shields too once upgraded', () => {
    expect(resolveWeapon({ spectral: 1 })).toMatchObject({ spectral: true, passesShields: false });
    expect(resolveWeapon({ spectral: 2 })).toMatchObject({ spectral: true, passesShields: true });
  });

  it('boomerang comes back, faster and twice as hard on the way back once upgraded', () => {
    const one = resolveWeapon({ boomerang: 1 }).boomerang!;
    const two = resolveWeapon({ boomerang: 2 }).boomerang!;
    expect(one.outMs).toBeGreaterThan(0);
    expect(one.returnDamageFactor).toBe(1);
    expect(two.returnDamageFactor).toBe(2);
    expect(two.returnSpeedFactor).toBeGreaterThan(one.returnSpeedFactor);
  });

  it('the sword throws a blade wave with any shot passive, and never without one', () => {
    for (const p of ['homing', 'triple', 'pierce', 'ricochet', 'spectral', 'boomerang'] as const) {
      expect(resolveWeapon({ sword: 1, [p]: 1 }).bladeWave, p).toBe(true);
    }
    expect(resolveWeapon({ sword: 1 }).bladeWave).toBe(false);
    expect(resolveWeapon({ sword: 1, fireRate: 1 }).bladeWave).toBe(false);
    expect(resolveWeapon({ triple: 1 }).bladeWave).toBe(false);
  });

  it('stacks everything at once, whatever the order', () => {
    const all = { triple: 2, pierce: 1, ricochet: 1, spectral: 1, boomerang: 1, homing: 1, fireRate: 1 } as const;
    const reversed = Object.fromEntries(Object.entries(all).reverse());
    expect(resolveWeapon(reversed)).toEqual(resolveWeapon(all));
    expect(resolveWeapon(all)).toMatchObject({ shots: 5, piercesEnemies: true, bounces: 2, spectral: true, homing: true });
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
