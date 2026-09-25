import { describe, expect, it } from 'vitest';
import { stepMomentum, type Momentum, type MomentumRules } from './momentum';

const RULES: MomentumRules = { startSpeed: 190, topSpeed: 260, rampMs: 800 };
const RIGHT = { x: 1, y: 0 };
const STILL = { x: 0, y: 0 };

/** Hold `dir` from `from` to `to` in 16ms frames; returns the momentum at `to`. */
function hold(m: Momentum | undefined, dir: { x: number; y: number }, from: number, to: number) {
  for (let t = from; t < to; t += 16) m = stepMomentum(m, { dir, time: t }, RULES);
  return stepMomentum(m, { dir, time: to }, RULES);
}

describe('momentum', () => {
  it('moves at start speed on the first press', () => {
    expect(stepMomentum(undefined, { dir: RIGHT, time: 1000 }, RULES).speed).toBe(190);
  });

  it('builds speed steadily while moving', () => {
    expect(hold(undefined, RIGHT, 1000, 1400).speed).toBeCloseTo(225);
  });

  it('tops out after the ramp', () => {
    expect(hold(undefined, RIGHT, 1000, 1800).speed).toBeCloseTo(260);
    expect(hold(undefined, RIGHT, 1000, 5000).speed).toBeCloseTo(260);
  });

  it('stops dead when the keys are released', () => {
    const running = hold(undefined, RIGHT, 1000, 2000);
    expect(stepMomentum(running, { dir: STILL, time: 2016 }, RULES).speed).toBe(0);
  });

  it('starts over after standing still', () => {
    const stopped = hold(hold(undefined, RIGHT, 1000, 2000), STILL, 2016, 3000);
    expect(stepMomentum(stopped, { dir: RIGHT, time: 3016 }, RULES).speed).toBe(190);
  });
});
