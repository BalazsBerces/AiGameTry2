import { describe, expect, it } from 'vitest';
import { PLAYER_LIGHT, createLights } from './lighting';

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
