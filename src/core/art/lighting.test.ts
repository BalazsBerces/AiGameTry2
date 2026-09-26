import { describe, expect, it } from 'vitest';
import { FLICKER, PLAYER_LIGHT, createLights, flicker } from './lighting';

describe('flicker', () => {
  const times = Array.from({ length: 2000 }, (_, i) => i * 37);

  it('is the same for the same light at the same moment', () => {
    for (const t of [0, 1234, 99_999]) expect(flicker(7, t)).toEqual(flicker(7, t));
  });

  it('never strays past its bounds: the room stays readable', () => {
    for (const t of times) {
      const f = flicker(3, t);
      expect(f.radius).toBeGreaterThanOrEqual(1 - FLICKER.radius);
      expect(f.radius).toBeLessThanOrEqual(1 + FLICKER.radius);
      expect(f.intensity).toBeGreaterThanOrEqual(1 - FLICKER.intensity);
      expect(f.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('moves over time, and differently for different lights', () => {
    const radii = new Set(times.map((t) => flicker(3, t).radius.toFixed(3)));
    expect(radii.size).toBeGreaterThan(20);
    expect(times.some((t) => flicker(3, t).radius !== flicker(4, t).radius)).toBe(true);
  });
});

describe('light registry', () => {
  it('always lights the player, even with nothing else registered', () => {
    const lights = createLights();
    expect(lights.frame({ x: 100, y: 50 })).toEqual([{ x: 100, y: 50, ...PLAYER_LIGHT }]);
  });

  it('lights each source added, where it was last put, until it is removed', () => {
    const lights = createLights();
    const shot = {};
    lights.set(shot, { x: 10, y: 20, radius: 40, intensity: 0.8 });
    lights.set(shot, { x: 30, y: 20, radius: 40, intensity: 0.8 });
    expect(lights.frame({ x: 0, y: 0 })).toContainEqual({ x: 30, y: 20, radius: 40, intensity: 0.8 });
    expect(lights.frame({ x: 0, y: 0 })).toHaveLength(2);
    lights.remove(shot);
    expect(lights.frame({ x: 0, y: 0 })).toHaveLength(1);
  });

  it('keeps the player light when everything else is cleared (a new room)', () => {
    const lights = createLights();
    lights.set('shroom', { x: 1, y: 1, radius: 80, intensity: 1 });
    lights.clear();
    expect(lights.frame({ x: 5, y: 5 })).toEqual([{ x: 5, y: 5, ...PLAYER_LIGHT }]);
  });
});
