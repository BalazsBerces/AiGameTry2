import { describe, expect, it } from 'vitest';
import { ghostAt, type GhostRules } from './ghost';

/** A small hand-built cycle: 1 s visible, then 1.5 s faded, easing over 200 ms at each change. */
const RULES: GhostRules = { visibleMs: 1000, fadedMs: 1500, fadeMs: 200 };
const CYCLE = RULES.visibleMs + RULES.fadedMs;

/** Fires a shot at the ghost every `stepMs` for `untilMs`; returns the times each shot landed or passed through. */
function shootAt(offsetMs: number, untilMs = 10_000, stepMs = 10) {
  const landed: number[] = [];
  const passed: number[] = [];
  for (let t = 0; t <= untilMs; t += stepMs) (ghostAt(t, offsetMs, RULES).hittable ? landed : passed).push(t);
  return { landed, passed };
}

/** Splits sorted times into runs of consecutive samples. */
const windows = (times: number[], stepMs = 10) =>
  times.reduce<number[][]>((out, t, i) => {
    if (i > 0 && t - times[i - 1] === stepMs) out[out.length - 1].push(t);
    else out.push([t]);
    return out;
  }, []);

describe('ghost cycle', () => {
  it('lets shots land only in visible windows, and pass through the rest of the time', () => {
    const { landed, passed } = shootAt(0);
    expect(landed.length).toBeGreaterThan(0);
    expect(passed.length).toBeGreaterThan(0);
    for (const t of landed) expect(ghostAt(t, 0, RULES).visible, `t ${t}`).toBe(true);
    for (const t of passed) expect(ghostAt(t, 0, RULES).visible, `t ${t}`).toBe(false);
  });

  it('opens a visible window every cycle, each as long as the visible time', () => {
    const open = windows(shootAt(0).landed);
    expect(open.length).toBeGreaterThanOrEqual(Math.floor(10_000 / CYCLE));
    for (const w of open.slice(1, -1)) expect(Math.abs(w[w.length - 1] - w[0] + 10 - RULES.visibleMs)).toBeLessThanOrEqual(10);
    // Windows start one full cycle apart.
    for (let i = 1; i < open.length; i++) expect(open[i][0] - open[i - 1][0]).toBe(CYCLE);
  });

  it('spends most of its cycle faded with these rules, never hittable while faded', () => {
    const { landed, passed } = shootAt(0, CYCLE * 4 - 10);
    expect(passed.length / (landed.length + passed.length)).toBeCloseTo(RULES.fadedMs / CYCLE, 1);
  });

  it('shifts its whole schedule by its offset, so ghosts in a room are out of step', () => {
    const a = shootAt(0).landed;
    const b = shootAt(700).landed;
    expect(a).not.toEqual(b);
    for (const t of b.filter((t) => t >= 700)) expect(ghostAt(t - 700, 0, RULES).hittable).toBe(true);
  });

  it('looks solid while visible and faint while faded, easing between the two', () => {
    const samples = Array.from({ length: CYCLE / 10 }, (_, i) => ghostAt(i * 10, 0, RULES));
    const visible = samples.filter((s) => s.visible).map((s) => s.opacity);
    const faded = samples.filter((s) => !s.visible).map((s) => s.opacity);
    expect(Math.min(...visible)).toBeGreaterThan(Math.max(...faded));
    expect(Math.max(...visible)).toBe(1);
    for (const s of samples) {
      expect(s.opacity).toBeGreaterThan(0);
      expect(s.opacity).toBeLessThanOrEqual(1);
    }
    // No jump from solid straight to faint: opacity changes in small steps.
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i].opacity - samples[i - 1].opacity)).toBeLessThan(0.5);
  });
});
