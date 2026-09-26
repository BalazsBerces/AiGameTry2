import { describe, expect, it } from 'vitest';
import { createKnockback } from './knockback';

const TUNING = { speed: 200, ms: 100 };

describe('knockback', () => {
  it('pushes a hit enemy at full speed along the hit, however long the direction given', () => {
    const knock = createKnockback(TUNING);
    const enemy = {};
    knock.hit(enemy, 1000, { x: 3, y: 4 });
    const v = knock.velocity(enemy, 1000);
    expect(v.x).toBeCloseTo(120);
    expect(v.y).toBeCloseTo(160);
  });

  it('eases out: half speed halfway through, then nothing once it is over', () => {
    const knock = createKnockback(TUNING);
    const enemy = {};
    knock.hit(enemy, 1000, { x: 1, y: 0 });
    expect(knock.velocity(enemy, 1050).x).toBeCloseTo(100);
    expect(knock.velocity(enemy, 1100)).toEqual({ x: 0, y: 0 });
    expect(knock.velocity(enemy, 5000)).toEqual({ x: 0, y: 0 });
  });

  it('a new hit replaces the push already running instead of adding to it, so rapid fire cannot fling an enemy', () => {
    const knock = createKnockback(TUNING);
    const enemy = {};
    knock.hit(enemy, 1000, { x: 1, y: 0 });
    knock.hit(enemy, 1050, { x: 0, y: 1 });
    const v = knock.velocity(enemy, 1050);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(200);
    expect(knock.velocity(enemy, 1150)).toEqual({ x: 0, y: 0 });
  });

  it('a hit with no direction (struck from its very centre) pushes nowhere', () => {
    const knock = createKnockback(TUNING);
    const enemy = {};
    knock.hit(enemy, 1000, { x: 0, y: 0 });
    expect(knock.velocity(enemy, 1000)).toEqual({ x: 0, y: 0 });
  });

  it('never pushes an enemy that was not hit', () => {
    expect(createKnockback(TUNING).velocity({}, 1000)).toEqual({ x: 0, y: 0 });
  });
});
