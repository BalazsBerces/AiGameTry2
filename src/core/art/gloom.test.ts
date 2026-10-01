import { describe, expect, it } from 'vitest';
import { PULSE, isGloomy, pulse } from './gloom';

const CAVES = 1;

describe('which rooms are gloomy', () => {
  it('puts every caves room under the gloom: start, item, normal and cleared alike', () => {
    expect(isGloomy({ floorIndex: CAVES, enemies: [] })).toBe(true);
    expect(isGloomy({ floorIndex: CAVES, enemies: [{ type: 'ghoul' }, { type: 'geode' }] })).toBe(true);
  });

  it("leaves the worm boss's arena fully lit", () => {
    expect(isGloomy({ floorIndex: CAVES, enemies: [{ type: 'wormBoss' }] })).toBe(false);
  });

  it('leaves the forest and the dungeon as they are', () => {
    expect(isGloomy({ floorIndex: 0, enemies: [] })).toBe(false);
    expect(isGloomy({ floorIndex: 2, enemies: [] })).toBe(false);
    expect(isGloomy({ floorIndex: 2, enemies: [{ type: 'candleWitch' }] })).toBe(false);
  });
});

describe('the pulse', () => {
  const times = Array.from({ length: 3000 }, (_, i) => i * 23);

  it('never leaves its bounds, so a light pool never vanishes', () => {
    for (const seed of [0, 1, 7, 12345]) {
      for (const t of times) {
        const p = pulse(seed, t);
        expect(p).toBeGreaterThanOrEqual(PULSE.min);
        expect(p).toBeLessThanOrEqual(PULSE.max);
      }
    }
    expect(PULSE.min).toBeGreaterThan(0);
  });

  it('is the same for the same seed at the same moment', () => {
    for (const t of [0, 1234, 99_999]) expect(pulse(7, t)).toBe(pulse(7, t));
  });

  it('breathes slowly: a few seconds from one swell to the next', () => {
    // Count the swells (local peaks) over a minute: a 3-5 s breath gives 12-20.
    const samples = Array.from({ length: 600 }, (_, i) => pulse(5, i * 100));
    const peaks = samples.filter((v, i) => i > 0 && i < samples.length - 1 && v > samples[i - 1] && v >= samples[i + 1]).length;
    expect(peaks).toBeGreaterThanOrEqual(11);
    expect(peaks).toBeLessThanOrEqual(21);
  });

  it('keeps neighbours out of step with each other', () => {
    for (const seed of [1, 2, 3, 40]) {
      const apart = times.filter((t) => Math.abs(pulse(seed, t) - pulse(seed + 1, t)) > 0.02).length;
      expect(apart / times.length, `seeds ${seed} and ${seed + 1}`).toBeGreaterThan(0.5);
    }
  });
});
