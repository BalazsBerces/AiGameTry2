import { describe, expect, it } from 'vitest';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import { createTreant, updateTreant, type Treant, type TreantInput } from './treant';

const open = (w: number, h: number): Tile[][] => Array.from({ length: h }, () => Array<Tile>(w).fill('floor'));

/** A treant at (6.5, 6.5) in an open 26x14 room, the player straight to its right. */
const input = (time: number, over: Partial<TreantInput> = {}): TreantInput => ({
  time,
  at: { x: 6.5, y: 6.5 },
  player: { x: 16.5, y: 6.5 },
  tiles: open(26, 14),
  doors: [],
  hp: 70,
  maxHp: 70,
  rng: createRng(1),
  ...over,
});

/** Steps the treant through `times`, returning each step's result. */
function run(treant: Treant, times: number[], over: (time: number) => Partial<TreantInput> = () => ({})) {
  let t = treant;
  return times.map((time) => {
    const step = updateTreant(t, input(time, over(time)));
    t = step.treant;
    return step;
  });
}

describe('treant walking', () => {
  it('stands still through its opening root eruption, then walks at the player', () => {
    const [first] = run(createTreant(0), [0]);
    expect(first.treant.attack?.kind).toBe('roots');
    expect(first.walk).toBeUndefined();

    const rootsOver = first.treant.attack!.start + (first.treant.attack as { plan: { durationMs: number } }).plan.durationMs + 1;
    const steps = run(first.treant, [rootsOver, rootsOver + 20]);
    expect(steps[1].treant.attack).toBeUndefined();
    expect(steps[1].walk).toEqual({ x: 1, y: 0 });
  });

  it('keeps walking while its seed pods fly, which take turns with the roots and land once', () => {
    const frames = Array.from({ length: 400 }, (_, i) => i * 20);
    const steps = run(createTreant(0), frames);
    const kinds = steps.map((s) => s.treant.attack?.kind).filter((k, i, all) => k && k !== all[i - 1]);
    expect(kinds.slice(0, 4)).toEqual(['roots', 'seeds', 'roots', 'seeds']);

    const flying = steps.filter((s) => s.treant.attack?.kind === 'seeds');
    expect(flying.length).toBeGreaterThan(0);
    for (const s of flying) expect(s.walk).toEqual({ x: 1, y: 0 });

    const landings = steps.flatMap((s) => s.events).filter((e) => e.kind === 'podsLand');
    expect(landings).toHaveLength(2);
  });

  it('sweeps its branches from where it stands when the player comes close, standing still for it', () => {
    const at = { x: 9.5, y: 6.5 };
    const close = { x: 11.0, y: 6.5 };
    const frames = Array.from({ length: 300 }, (_, i) => i * 20);
    const steps = run(createTreant(0), frames, () => ({ at, player: close }));
    const sweeping = steps.filter((s) => s.treant.sweep);
    expect(sweeping.length).toBeGreaterThan(0);
    for (const s of sweeping) {
      expect(s.treant.sweep!.plan.from).toEqual(at);
      expect(s.walk).toBeUndefined();
    }
    // Between sweeps and roots, while pods fly, it still closes in.
    expect(steps.some((s) => !s.treant.sweep && s.treant.attack?.kind === 'seeds' && s.walk)).toBe(true);
  });

  it('never sweeps at a player out of reach', () => {
    const frames = Array.from({ length: 200 }, (_, i) => i * 20);
    expect(run(createTreant(0), frames).some((s) => s.treant.sweep)).toBe(false);
  });

  it('plans its attacks from where it stands now', () => {
    const at = { x: 12.5, y: 3.5 };
    const [step] = run(createTreant(0), [0], () => ({ at }));
    const firstRoots = (step.treant.attack as { plan: { lines: { x: number; y: number }[][] } }).plan.lines[0];
    // The straight line toward the player starts beside the treant's own tile.
    expect(Math.abs(firstRoots[0].x - 12) + Math.abs(firstRoots[0].y - 3)).toBe(1);
  });
});
