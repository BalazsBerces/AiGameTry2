import { describe, expect, it } from 'vitest';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import { RING } from './treantAttack';
import { canHurtTreant, createTreant, TREANT, updateTreant, type Treant, type TreantEvent, type TreantInput } from './treant';

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
});

describe('treant sprouts', () => {
  /** Runs until its first volley lands, then returns the treant, the landed pods and the tiles with them sprouted. */
  function afterFirstVolley() {
    const tiles = open(26, 14);
    let t = createTreant(0);
    for (let time = 0; time < 5000; time += 20) {
      const step = updateTreant(t, input(time, { tiles }));
      t = step.treant;
      const landed = step.events.find((e) => e.kind === 'podsLand');
      if (landed?.kind === 'podsLand') {
        for (const pod of landed.pods) tiles[pod.cell.y][pod.cell.x] = pod.sprout;
        return { treant: t, pods: landed.pods, tiles, time };
      }
    }
    throw new Error('no volley landed');
  }

  it('crushes a sprout of its own when it walks up against it', () => {
    const { treant, pods, tiles, time } = afterFirstVolley();
    const pod = pods[0];
    const beside = { x: pod.cell.x - 1, y: pod.cell.y + 0.5 };
    const step = updateTreant(treant, input(time + 20, { tiles, at: beside }));
    expect(step.events).toContainEqual({ kind: 'crush', cell: pod.cell });
    // Once crushed it is forgotten: it never asks again, even back in the same spot.
    tiles[pod.cell.y][pod.cell.x] = 'floor';
    const again = updateTreant(step.treant, input(time + 40, { tiles, at: beside }));
    expect(again.events.filter((e) => e.kind === 'crush')).toEqual([]);
  });

  it('leaves the room’s own rock and thorn alone', () => {
    const { treant, tiles, time } = afterFirstVolley();
    const natural = { x: 20, y: 11 };
    tiles[natural.y][natural.x] = 'rock';
    tiles[natural.y][natural.x + 1] = 'thorn';
    const step = updateTreant(treant, input(time + 20, { tiles, at: { x: natural.x + 1, y: natural.y - 0.5 } }));
    expect(step.events.filter((e) => e.kind === 'crush')).toEqual([]);
  });

  it('forgets a pod that never sprouted (it burst on the player)', () => {
    const { treant, pods, tiles, time } = afterFirstVolley();
    const pod = pods[0];
    tiles[pod.cell.y][pod.cell.x] = 'floor';
    const step = updateTreant(treant, input(time + 20, { tiles, at: { x: pod.cell.x - 1, y: pod.cell.y + 0.5 } }));
    expect(step.events.filter((e) => e.kind === 'crush')).toEqual([]);
  });
});

describe('treant last stand', () => {
  const low = 17; // Under 25% of 70.

  it('drops everything and sinks once it falls to a quarter of its hit points, crumbling its sprouts', () => {
    const tiles = open(26, 14);
    let t = createTreant(0);
    let landed: { x: number; y: number }[] = [];
    let time = 0;
    for (; time < 5000 && !landed.length; time += 20) {
      const step = updateTreant(t, input(time, { tiles }));
      t = step.treant;
      for (const e of step.events) if (e.kind === 'podsLand') for (const pod of e.pods) (tiles[pod.cell.y][pod.cell.x] = pod.sprout), landed.push(pod.cell);
    }
    // Make sure something is under way when it is struck down.
    t = updateTreant(t, input(time, { tiles, player: { x: 7.5, y: 6.5 } })).treant;
    expect(t.attack || t.sweep).toBeTruthy();

    const step = updateTreant(t, input(time + 20, { tiles, hp: low }));
    expect(step.treant.phase).toBe('sinking');
    expect(step.treant.attack).toBeUndefined();
    expect(step.treant.sweep).toBeUndefined();
    expect(step.walk).toBeUndefined();
    const crumble = step.events.find((e) => e.kind === 'crumble');
    expect(crumble && crumble.kind === 'crumble' && [...crumble.cells].sort((a, b) => a.x - b.x || a.y - b.y)).toEqual(
      [...landed].sort((a, b) => a.x - b.x || a.y - b.y),
    );
  });

  it('sinks, marks the middle of the room, then bursts up there, untouchable until it does', () => {
    const { sinkMs, markMs } = TREANT;
    const frames = Array.from({ length: Math.ceil((sinkMs + markMs + 1000) / 20) }, (_, i) => 1000 + i * 20);
    let t = createTreant(0);
    const seen: { time: number; phase: string; hurtable: boolean; burstAt?: unknown; walk?: unknown; events: TreantEvent[] }[] = [];
    for (const time of frames) {
      const step = updateTreant(t, input(time, { hp: low }));
      t = step.treant;
      seen.push({ time, phase: t.phase, hurtable: canHurtTreant(t), burstAt: t.burstAt, walk: step.walk, events: step.events });
    }
    const at = (ms: number) => seen.find((s) => s.time >= 1000 + ms)!;
    expect(at(0)).toMatchObject({ phase: 'sinking', hurtable: false });
    expect(at(sinkMs - 40)).toMatchObject({ phase: 'sinking', hurtable: false });
    expect(at(sinkMs + 40)).toMatchObject({ phase: 'marked', hurtable: false, burstAt: { x: 12, y: 6 } });
    expect(at(sinkMs + markMs + 40)).toMatchObject({ phase: 'lastStand', hurtable: true });
    expect(seen.every((s) => s.walk === undefined)).toBe(true);

    const bursts = seen.flatMap((s) => s.events).filter((e) => e.kind === 'burst');
    expect(bursts).toEqual([{ kind: 'burst', cell: { x: 12, y: 6 } }]);
    expect(seen.filter((s) => s.phase === 'lastStand').every((s) => !s.events.some((e) => e.kind === 'crumble'))).toBe(true);
  });

  it('stands its ground in the last stand: no walking, no roots, pods or sweeps', () => {
    let t = createTreant(0);
    const steps = [];
    for (let time = 0; time < 12000; time += 20) {
      const step = updateTreant(t, input(time, { hp: low, player: { x: 13.5, y: 7.5 } }));
      t = step.treant;
      if (t.phase === 'lastStand') steps.push(step);
    }
    expect(steps.length).toBeGreaterThan(100);
    for (const s of steps) {
      expect(s.walk).toBeUndefined();
      expect(s.treant.attack).toBeUndefined();
      expect(s.treant.sweep).toBeUndefined();
    }
  });

  it('bursts up with its branch ring round it, a gap on the player, spinning faster the nearer it is to death', () => {
    const spin = (hp: number) => {
      let t = createTreant(0);
      let ringFrom: number | undefined;
      for (let time = 0; time < 1000 + TREANT.sinkMs + TREANT.markMs + RING.warnMs + 1000; time += 20) {
        t = updateTreant(t, input(time, { hp: time < 1000 ? 17 : hp, player: { x: 12.5, y: 10.5 } })).treant;
        if (t.ring && ringFrom === undefined) ringFrom = time;
      }
      return { t, ringFrom };
    };
    const { t, ringFrom } = spin(17);
    expect(ringFrom).toBeDefined();
    expect(t.ring!.centre).toEqual({ x: 12.5, y: 6.5 });
    // The player stood straight below it: the first gap opened at 90°.
    expect(t.ring!.offset).toBeCloseTo(Math.PI / 2);
    expect(t.ring!.turned).toBeGreaterThan(0);
    expect(spin(1).t.ring!.turned).toBeGreaterThan(t.ring!.turned);
  });

  it('can be hurt as normal before its last stand', () => {
    expect(canHurtTreant(createTreant(0))).toBe(true);
  });
});

describe('treant attacks', () => {
  it('plans its attacks from where it stands now', () => {
    const at = { x: 12.5, y: 3.5 };
    const [step] = run(createTreant(0), [0], () => ({ at }));
    const firstRoots = (step.treant.attack as { plan: { lines: { x: number; y: number }[][] } }).plan.lines[0];
    // The straight line toward the player starts beside the treant's own tile.
    expect(Math.abs(firstRoots[0].x - 12) + Math.abs(firstRoots[0].y - 3)).toBe(1);
  });
});
