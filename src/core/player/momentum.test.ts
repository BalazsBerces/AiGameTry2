import { describe, expect, it } from 'vitest';
import { stepMomentum, type Momentum, type MomentumRules } from './momentum';

const RULES: MomentumRules = { startSpeed: 190, topSpeed: 260, rampMs: 800, releaseMemoryMs: 150 };
const RIGHT = { x: 1, y: 0 };
const LEFT = { x: -1, y: 0 };
const DOWN = { x: 0, y: 1 };
const DOWN_RIGHT = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
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

  it('remembers its speed through a quick release', () => {
    const tapped = hold(hold(undefined, RIGHT, 1000, 2000), STILL, 2016, 2100);
    expect(stepMomentum(tapped, { dir: RIGHT, time: 2116 }, RULES).speed).toBeCloseTo(260);
  });

  it('forgets its speed once the release outlasts the memory', () => {
    const paused = hold(hold(undefined, RIGHT, 1000, 2000), STILL, 2016, 2200);
    expect(stepMomentum(paused, { dir: RIGHT, time: 2216 }, RULES).speed).toBe(190);
  });

  it('loses its speed to a stun', () => {
    let m = hold(undefined, RIGHT, 1000, 2000);
    m = stepMomentum(m, { dir: RIGHT, time: 2016, stunned: true }, RULES);
    expect(m.speed).toBe(0);
    expect(stepMomentum(m, { dir: RIGHT, time: 2032 }, RULES).speed).toBe(190);
  });

  it('comes out of a dash at top speed', () => {
    let m = stepMomentum(undefined, { dir: RIGHT, time: 1000 }, RULES);
    m = stepMomentum(m, { dir: RIGHT, time: 1016, dashing: true }, RULES);
    expect(stepMomentum(m, { dir: RIGHT, time: 1032 }, RULES).speed).toBeCloseTo(260);
  });

  it('keeps its speed through a right-angle turn', () => {
    const running = hold(undefined, RIGHT, 1000, 2000);
    expect(stepMomentum(running, { dir: DOWN, time: 2016 }, RULES).speed).toBeCloseTo(260);
  });

  it('keeps its speed between diagonal and straight', () => {
    const running = hold(undefined, DOWN_RIGHT, 1000, 2000);
    expect(stepMomentum(running, { dir: RIGHT, time: 2016 }, RULES).speed).toBeCloseTo(260);
  });

  it('drops back to start speed on reversing', () => {
    const running = hold(undefined, RIGHT, 1000, 2000);
    expect(stepMomentum(running, { dir: LEFT, time: 2016 }, RULES).speed).toBe(190);
  });
});
