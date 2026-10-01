import { describe, expect, it } from 'vitest';
import { createGeode, updateGeode, type GeodeRules } from './geode';

/** A small hand-built rule set: wakes within 3 tiles, fires 2-shot bursts. */
const RULES: GeodeRules = {
  wakeRange: 3,
  restMs: 1000,
  openDelayMs: 300,
  burstSize: 2,
  shotGapMs: 200,
  tailMs: 250,
  staggerMs: { min: 300, max: 800 },
};

/** Where the player is at time t: how many tiles away, and whether the geode can see them. */
type Player = (t: number) => { distance: number; sees: boolean };
const near: Player = () => ({ distance: 1, sees: true });

/** Runs the geode frame by frame. Returns shot times and whether it was open at each frame. */
function run(player: Player, untilMs: number, { frameMs = 10, rules = RULES, firstOpenAt = 0 } = {}) {
  let g = createGeode(firstOpenAt);
  const shots: number[] = [];
  const open = new Map<number, boolean>();
  for (let t = 0; t <= untilMs; t += frameMs) {
    const { distance, sees } = player(t);
    const step = updateGeode(g, distance, sees, t, rules);
    g = step.geode;
    for (let i = 0; i < step.shots; i++) shots.push(t);
    open.set(t, g.open);
  }
  const openAt = (t: number) => open.get(t);
  const openBetween = (from: number, to: number) => [...open].filter(([t]) => t >= from && t < to).map(([, o]) => o);
  return { shots, openAt, openBetween };
}

describe('geode', () => {
  it('stays shut and silent while the player keeps outside its range', () => {
    const { shots, openBetween } = run(() => ({ distance: 3.5, sees: true }), 10_000);
    expect(shots).toEqual([]);
    expect(openBetween(0, 10_001).every((o) => !o)).toBe(true);
  });

  it('stays shut and silent while the player is in range but out of sight', () => {
    const { shots, openBetween } = run(() => ({ distance: 1, sees: false }), 10_000);
    expect(shots).toEqual([]);
    expect(openBetween(0, 10_001).every((o) => !o)).toBe(true);
  });

  it('opens when the player comes in range and in sight, and fires only once the opening delay is over', () => {
    const { shots, openAt, openBetween } = run((t) => (t < 1000 ? { distance: 8, sees: true } : near(t)), 1400);
    expect(openBetween(0, 1000).every((o) => !o)).toBe(true);
    expect(openAt(1000)).toBe(true);
    expect(shots[0]).toBe(1300);
  });

  it('fires a burst spaced by the shot gap, stays open through the tail, then shuts', () => {
    const { shots, openBetween, openAt } = run((t) => (t < 1000 ? { distance: 8, sees: true } : near(t)), 2000);
    expect(shots).toEqual([1300, 1500]);
    expect(openBetween(1000, 1750).every((o) => o)).toBe(true);
    expect(openAt(1750)).toBe(false);
  });

  it('finishes its cycle after the player leaves range', () => {
    const { shots, openBetween, openAt } = run((t) => (t < 10 ? near(t) : { distance: 20, sees: true }), 2000);
    expect(shots).toEqual([300, 500]);
    expect(openBetween(0, 750).every((o) => o)).toBe(true);
    expect(openAt(750)).toBe(false);
  });

  it('skips a shot due while it cannot see the player, rather than holding it', () => {
    const { shots, openAt } = run((t) => (t < 400 ? near(t) : { distance: 1, sees: false }), 2000);
    expect(shots).toEqual([300]);
    expect(openAt(740)).toBe(true);
    expect(openAt(750)).toBe(false);
  });

  it('rests shut after a cycle even with the player beside it, then opens again straight away', () => {
    const { shots, openBetween, openAt } = run(near, 2400);
    expect(openBetween(750, 1750).every((o) => !o)).toBe(true);
    expect(openAt(1750)).toBe(true);
    expect(shots).toEqual([300, 500, 2050, 2250]);
  });

  it('does not open before the first time it may', () => {
    const { shots, openBetween, openAt } = run(near, 1000, { firstOpenAt: 400 });
    expect(openBetween(0, 400).every((o) => !o)).toBe(true);
    expect(openAt(400)).toBe(true);
    expect(shots).toEqual([700, 900]);
  });

  it('fires bigger bursts on the same timing when its rules say so', () => {
    const { shots, openAt } = run(near, 1500, { rules: { ...RULES, burstSize: 3 } });
    expect(shots).toEqual([300, 500, 700]);
    expect(openAt(940)).toBe(true);
    expect(openAt(950)).toBe(false);
  });

  it('catches up on a long frame, firing every shot that fell due', () => {
    const opened = updateGeode(createGeode(0), 1, true, 0, RULES).geode;
    const late = updateGeode(opened, 1, true, 600, RULES);
    expect(late.shots).toBe(2);
    expect(late.geode.open).toBe(true);
    expect(updateGeode(late.geode, 1, true, 800, RULES).geode.open).toBe(false);
  });

  it('fires about as many shots with choppy frames as with smooth ones', () => {
    const smooth = run(near, 10_000, { frameMs: 10 }).shots.length;
    const choppy = run(near, 10_000, { frameMs: 250 }).shots.length;
    expect(Math.abs(smooth - choppy)).toBeLessThanOrEqual(RULES.burstSize);
  });
});
