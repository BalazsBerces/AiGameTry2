import { describe, expect, it } from 'vitest';
import { createGargoyle, updateGargoyle, type GargoyleRules } from './gargoyle';

/** A small hand-built rule set: wakes within 3 tiles, fires 3-shot bursts. */
const RULES: GargoyleRules = { wakeRange: 3, wakeDelayMs: 200, burstSize: 3, shotGapMs: 100, burstGapMs: 1000 };

/** Runs the gargoyle frame by frame; `distance(t)` is how far the player is at time t. Returns shot times. */
function run(distance: (t: number) => number, untilMs: number, frameMs = 16) {
  let g = createGargoyle();
  const shots: number[] = [];
  const awake: boolean[] = [];
  for (let t = 0; t <= untilMs; t += frameMs) {
    const step = updateGargoyle(g, distance(t), t, RULES);
    g = step.gargoyle;
    for (let i = 0; i < step.shots; i++) shots.push(t);
    awake.push(g.awake);
  }
  return { shots, awake, gargoyle: g };
}

/** Splits shot times into bursts: shots closer together than the pause between bursts. */
const bursts = (shots: number[]) =>
  shots.reduce<number[][]>((out, t, i) => {
    if (i > 0 && t - shots[i - 1] < RULES.burstGapMs / 2) out[out.length - 1].push(t);
    else out.push([t]);
    return out;
  }, []);

describe('gargoyle', () => {
  it('stays dormant and silent while the player keeps outside its range', () => {
    const { shots, awake } = run(() => 3.5, 10_000);
    expect(shots).toEqual([]);
    expect(awake.every((a) => !a)).toBe(true);
  });

  it('wakes when the player comes within range', () => {
    const { awake } = run((t) => (t < 2000 ? 8 : 2), 2100);
    expect(awake.slice(0, 2000 / 16).every((a) => !a)).toBe(true);
    expect(awake[awake.length - 1]).toBe(true);
  });

  it('once awake fires bursts of shots on a schedule, with pauses between bursts', () => {
    const { shots } = run(() => 1, 6000);
    const groups = bursts(shots);
    expect(groups.length).toBeGreaterThanOrEqual(4);
    // The first shot comes after the wake-up delay, not the instant it wakes.
    expect(shots[0]).toBeGreaterThanOrEqual(RULES.wakeDelayMs);
    for (const g of groups.slice(0, -1)) expect(g).toHaveLength(RULES.burstSize);
    // Starts of successive bursts are evenly spaced.
    const starts = groups.map((g) => g[0]);
    for (let i = 2; i < starts.length; i++) {
      expect(Math.abs(starts[i] - starts[i - 1] - (starts[1] - starts[0]))).toBeLessThanOrEqual(16);
    }
  });

  it('keeps firing after the player retreats out of range', () => {
    const { shots } = run((t) => (t < 500 ? 1 : 20), 8000);
    expect(shots.filter((t) => t > 4000).length).toBeGreaterThan(0);
  });

  it('never fires more shots than its schedule allows, even with long frames', () => {
    const smooth = run(() => 1, 5000, 10).shots.length;
    const choppy = run(() => 1, 5000, 250).shots.length;
    expect(Math.abs(smooth - choppy)).toBeLessThanOrEqual(RULES.burstSize);
  });
});
