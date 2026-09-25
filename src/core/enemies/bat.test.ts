import { describe, expect, it } from 'vitest';
import { BAT, createBat, createBatFlock, leaveFlock, mayDive, reportToFlock, updateBat, type Bat } from './bat';
import { createRng } from '../rng';

const FRAME_MS = 16;
type Point = { x: number; y: number };

/**
 * Flies a bat from `start` (tiles) for `frames` frames, the player where `player(time)` says.
 * Returns every frame's position, state and velocity.
 */
function fly(seed: number, frames: number, start: Point, player: (time: number) => Point) {
  const rng = createRng(seed);
  let bat: Bat = createBat(start, 0, rng);
  let at = { ...start };
  const log: { time: number; at: Point; bat: Bat; velocity: Point }[] = [];
  for (let i = 1; i <= frames; i++) {
    const time = i * FRAME_MS;
    const step = updateBat(bat, { time, dtMs: FRAME_MS, at, player: player(time) }, rng);
    bat = step.bat;
    at = { x: at.x + step.velocity.x * (FRAME_MS / 1000), y: at.y + step.velocity.y * (FRAME_MS / 1000) };
    log.push({ time, at, bat, velocity: step.velocity });
  }
  return log;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const speed = (v: Point) => Math.hypot(v.x, v.y);
const FAR = () => ({ x: 100, y: 100 });

describe('bat flutter', () => {
  it('is the same flight for the same rng', () => {
    const player = (t: number) => ({ x: 3 + Math.sin(t / 500), y: 2 });
    expect(fly(4, 400, { x: 0, y: 0 }, player)).toEqual(fly(4, 400, { x: 0, y: 0 }, player));
  });

  it('stays within its flutter radius of its roost while the player is out of range', () => {
    for (let seed = 0; seed < 20; seed++) {
      const start = { x: 5, y: 3 };
      const log = fly(seed, 1500, start, FAR);
      const step = (BAT.flutterSpeed * FRAME_MS) / 1000;
      for (const f of log) {
        const roost = f.bat.mode === 'flutter' ? f.bat.roost : start;
        expect(dist(f.at, roost), `seed ${seed} t ${f.time}`).toBeLessThanOrEqual(BAT.flutterRadius + step);
      }
      expect(log.every((f) => f.bat.mode === 'flutter'), `seed ${seed}`).toBe(true);
    }
  });

  it('flutters erratically: it keeps moving and changes direction often', () => {
    for (let seed = 0; seed < 10; seed++) {
      const log = fly(seed, 600, { x: 5, y: 3 }, FAR);
      const angles = log.map((f) => Math.atan2(f.velocity.y, f.velocity.x));
      let turns = 0;
      for (let i = 1; i < angles.length; i++) if (Math.abs(Math.sin(angles[i] - angles[i - 1])) > 0.3) turns++;
      expect(turns, `seed ${seed}`).toBeGreaterThan(8);
      expect(log.filter((f) => speed(f.velocity) > 0).length, `seed ${seed}`).toBeGreaterThan(log.length * 0.9);
    }
  });

  it('creeps its roost toward the player at about half a tile a second while it flutters', () => {
    for (let seed = 0; seed < 10; seed++) {
      const start = { x: 5, y: 3 };
      const log = fly(seed, 250, start, FAR); // 4 seconds
      const roost = log.map((f) => (f.bat.mode === 'flutter' ? f.bat.roost : undefined));
      const crept = dist(start, FAR()) - dist(roost[roost.length - 1]!, FAR());
      expect(crept, `seed ${seed}`).toBeGreaterThan(1.8);
      expect(crept, `seed ${seed}`).toBeLessThan(2.2);
    }
  });

  it('sends bats of one roost on different paths', () => {
    const paths = [1, 2, 3, 4].map((seed) => JSON.stringify(fly(seed, 100, { x: 5, y: 3 }, FAR).map((f) => f.at)));
    expect(new Set(paths).size).toBe(4);
  });
});

describe('bat swoop', () => {
  const START = { x: 5, y: 3 };
  /** Player within swoop range, just to the right of the roost. */
  const NEAR = () => ({ x: START.x + BAT.swoopRange - 1, y: START.y });

  it('never swoops at a player out of range', () => {
    // Far enough that its creeping roost never brings the player into range in these 32 seconds.
    const log = fly(2, 2000, START, () => ({ x: START.x + BAT.swoopRange + BAT.flutterRadius + 20, y: START.y }));
    expect(log.some((f) => f.bat.mode !== 'flutter')).toBe(false);
  });

  it('hangs still through a telegraph before every swoop, and only then swoops', () => {
    for (let seed = 0; seed < 10; seed++) {
      const log = fly(seed, 800, START, NEAR);
      const firstSwoop = log.findIndex((f) => f.bat.mode === 'swoop');
      expect(firstSwoop, `seed ${seed}`).toBeGreaterThan(0);
      const telegraph = log.slice(0, firstSwoop).filter((f) => f.bat.mode === 'telegraph');
      expect(telegraph.length * FRAME_MS, `seed ${seed}`).toBeGreaterThanOrEqual(BAT.telegraphMs - FRAME_MS);
      for (const f of telegraph) expect(speed(f.velocity), `seed ${seed}`).toBe(0);
      // Every swoop comes straight out of a telegraph.
      for (let i = 1; i < log.length; i++) {
        if (log[i].bat.mode === 'swoop' && log[i - 1].bat.mode !== 'swoop') expect(log[i - 1].bat.mode).toBe('telegraph');
      }
    }
  });

  it('swoops much faster than it flutters, and reaches the player', () => {
    const log = fly(1, 800, START, NEAR);
    const swoop = log.filter((f) => f.bat.mode === 'swoop');
    expect(swoop.length).toBeGreaterThan(0);
    for (const f of swoop) expect(speed(f.velocity)).toBeGreaterThan(BAT.flutterSpeed * 2);
    expect(Math.min(...swoop.map((f) => dist(f.at, NEAR())))).toBeLessThan(0.5);
  });

  it('dives at where the player was when it telegraphed, so stepping aside dodges it', () => {
    // The player stands in range until the telegraph starts, then steps two tiles down.
    let dodgedAt: number | undefined;
    const rng = createRng(7);
    let bat: Bat = createBat(START, 0, rng);
    let at = { ...START };
    const before = NEAR();
    const after = { x: before.x, y: before.y + 2 };
    let closest = Infinity;
    for (let i = 1; i <= 800; i++) {
      const time = i * FRAME_MS;
      const player = dodgedAt === undefined ? before : after;
      const step = updateBat(bat, { time, dtMs: FRAME_MS, at, player }, rng);
      bat = step.bat;
      if (bat.mode === 'telegraph' && dodgedAt === undefined) dodgedAt = time;
      at = { x: at.x + step.velocity.x * (FRAME_MS / 1000), y: at.y + step.velocity.y * (FRAME_MS / 1000) };
      if (bat.mode === 'swoop') closest = Math.min(closest, dist(at, after));
      if (dodgedAt !== undefined && bat.mode === 'flutter') break;
    }
    expect(dodgedAt).toBeDefined();
    expect(closest).toBeGreaterThan(1);
  });

  it('picks on a player up to 7 tiles away and dives again within a second of landing', () => {
    const far = () => ({ x: START.x + 6.5, y: START.y });
    const log = fly(3, 1500, START, far);
    expect(log.some((f) => f.bat.mode === 'telegraph')).toBe(true);
    const ends = log.flatMap((f, i) => (i > 0 && log[i - 1].bat.mode === 'swoop' && f.bat.mode === 'flutter' ? [f.time] : []));
    const starts = log.flatMap((f, i) => (i > 0 && log[i - 1].bat.mode === 'flutter' && f.bat.mode === 'telegraph' ? [f.time] : []));
    const gaps = ends.flatMap((end) => starts.filter((s) => s > end).slice(0, 1).map((s) => s - end));
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) expect(gap).toBeLessThan(1000);
  });

  it('rests after a swoop before telegraphing again', () => {
    const log = fly(3, 1500, START, NEAR);
    const ends = log.flatMap((f, i) => (i > 0 && log[i - 1].bat.mode === 'swoop' && f.bat.mode === 'flutter' ? [f.time] : []));
    const starts = log.flatMap((f, i) => (i > 0 && log[i - 1].bat.mode === 'flutter' && f.bat.mode === 'telegraph' ? [f.time] : []));
    expect(ends.length).toBeGreaterThan(0);
    for (const end of ends) {
      const next = starts.find((s) => s > end);
      if (next !== undefined) expect(next - end).toBeGreaterThanOrEqual(BAT.restMs);
    }
  });
});

describe('bat flock', () => {
  /** Flies `count` bats of one flock round a player standing among them; returns each frame's modes. */
  function flyFlock(seed: number, count: number, frames: number) {
    const rng = createRng(seed);
    const flock = createBatFlock();
    const player = { x: 6, y: 3 };
    const bats = Array.from({ length: count }, (_, i) => {
      const at = { x: 2 + i, y: 1 + (i % 3) };
      return { id: i, at, bat: createBat(at, 0, rng) };
    });
    const modes: Bat['mode'][][] = [];
    for (let f = 1; f <= frames; f++) {
      const time = f * FRAME_MS;
      for (const b of bats) {
        const step = updateBat(b.bat, { time, dtMs: FRAME_MS, at: b.at, player, mayDive: mayDive(flock, b.id) }, rng);
        b.bat = step.bat;
        reportToFlock(flock, b.id, b.bat);
        b.at = { x: b.at.x + step.velocity.x * (FRAME_MS / 1000), y: b.at.y + step.velocity.y * (FRAME_MS / 1000) };
      }
      modes.push(bats.map((b) => b.bat.mode));
    }
    return { modes, flock };
  }

  it('never has more than two bats winding up or swooping at once', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { modes } = flyFlock(seed, 7, 800);
      for (const [i, frame] of modes.entries()) {
        expect(frame.filter((m) => m !== 'flutter').length, `seed ${seed} frame ${i}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('gives every bat a turn', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { modes } = flyFlock(seed, 7, 800);
      for (let bat = 0; bat < 7; bat++) {
        expect(modes.some((frame) => frame[bat] === 'swoop'), `seed ${seed} bat ${bat}`).toBe(true);
      }
    }
  });

  it('frees a dead diver\'s turn', () => {
    const flock = createBatFlock();
    const diving: Bat = { mode: 'swoop', target: { x: 0, y: 0 }, giveUpAt: 1000 };
    reportToFlock(flock, 'a', diving);
    reportToFlock(flock, 'b', diving);
    expect(mayDive(flock, 'c')).toBe(false);
    leaveFlock(flock, 'a');
    expect(mayDive(flock, 'c')).toBe(true);
  });
});
