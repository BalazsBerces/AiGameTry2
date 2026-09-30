import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createSlime, SLIME, splitSlime, updateSlime, type Slime, type SlimeTier } from './slime';

const FRAME_MS = 16;
type Point = { x: number; y: number };

type Floor = (p: Point) => boolean;
const OPEN: Floor = () => true;

/**
 * Hops a slime from `start` (tiles) for `frames` frames, the player where `player(time)` says,
 * over a floor it may land wherever `canLandAt` says.
 */
function hop(seed: number, frames: number, tier: SlimeTier, start: Point, player: (time: number) => Point, canLandAt: Floor = OPEN) {
  const rng = createRng(seed);
  let slime: Slime = createSlime(tier, 0, rng);
  let at = { ...start };
  const log: { time: number; at: Point; slime: Slime; velocity: Point }[] = [];
  for (let i = 1; i <= frames; i++) {
    const time = i * FRAME_MS;
    const step = updateSlime(slime, { time, at, player: player(time), canLandAt }, rng);
    slime = step.slime;
    at = { x: at.x + step.velocity.x * (FRAME_MS / 1000), y: at.y + step.velocity.y * (FRAME_MS / 1000) };
    log.push({ time, at, slime, velocity: step.velocity });
  }
  return log;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const speed = (v: Point) => Math.hypot(v.x, v.y);
const START = { x: 2, y: 3 };
const PLAYER = () => ({ x: 30, y: 3 });

/** Each hop's first and last frame index. */
function hops(log: ReturnType<typeof hop>) {
  const out: { from: number; to: number }[] = [];
  log.forEach((f, i) => {
    if (f.slime.mode === 'hop' && log[i - 1]?.slime.mode !== 'hop') out.push({ from: i, to: i });
    if (f.slime.mode === 'hop') out[out.length - 1].to = i;
  });
  return out;
}

describe('slime hops', () => {
  it('is the same hopping for the same rng', () => {
    expect(hop(3, 400, 'big', START, PLAYER)).toEqual(hop(3, 400, 'big', START, PLAYER));
  });

  it('squashes down, holding still, before every hop', () => {
    for (let seed = 0; seed < 10; seed++) {
      const log = hop(seed, 600, 'big', START, PLAYER);
      const found = hops(log);
      expect(found.length, `seed ${seed}`).toBeGreaterThan(1);
      for (const { from } of found) {
        const squash = [];
        for (let i = from - 1; i >= 0 && log[i].slime.mode === 'squash'; i--) squash.push(log[i]);
        expect(squash.length * FRAME_MS, `seed ${seed}`).toBeGreaterThanOrEqual(SLIME.tiers.big.squashMs - FRAME_MS);
        for (const f of squash) expect(speed(f.velocity)).toBe(0);
      }
    }
  });

  it('hops a fixed distance straight at the player', () => {
    const log = hop(1, 600, 'big', START, PLAYER);
    // The last hop may still be in the air when the log ends.
    for (const { from, to } of hops(log).slice(0, -1)) {
      const before = from > 0 ? log[from - 1].at : START;
      const after = log[to].at;
      expect(dist(before, after)).toBeCloseTo(SLIME.tiers.big.hopDistance, 1);
      expect(after.x).toBeGreaterThan(before.x);
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.01);
    }
  });

  it('lands where the player stood when it squashed, so stepping aside dodges it', () => {
    const rng = createRng(5);
    let slime: Slime = createSlime('big', 0, rng);
    let at = { x: 5, y: 3 };
    let player = { x: 6, y: 3 };
    let dodged = false;
    let landed: Point | undefined;
    for (let i = 1; i <= 600 && !landed; i++) {
      const time = i * FRAME_MS;
      const step = updateSlime(slime, { time, at, player, canLandAt: OPEN }, rng);
      if (step.slime.mode === 'squash' && !dodged) {
        dodged = true;
        player = { x: 6, y: 6 };
      }
      if (slime.mode === 'hop' && step.slime.mode !== 'hop') landed = { ...at };
      slime = step.slime;
      at = { x: at.x + step.velocity.x * (FRAME_MS / 1000), y: at.y + step.velocity.y * (FRAME_MS / 1000) };
    }
    expect(landed).toBeDefined();
    expect(Math.abs(landed!.y - 3)).toBeLessThan(0.01);
  });

  it('holds still for a moment after it lands', () => {
    const log = hop(2, 600, 'big', START, PLAYER);
    for (const { to } of hops(log).slice(0, -1)) {
      const pause = [];
      for (let i = to + 1; i < log.length && log[i].slime.mode === 'land'; i++) pause.push(log[i]);
      expect(pause.length * FRAME_MS).toBeGreaterThanOrEqual(SLIME.tiers.big.landMs - FRAME_MS);
      for (const f of pause) expect(speed(f.velocity)).toBe(0);
    }
  });

  it('hops more often the smaller it is', () => {
    const count = (tier: SlimeTier) => hops(hop(4, 1000, tier, START, PLAYER)).length;
    expect(count('small')).toBeGreaterThan(count('medium'));
    expect(count('medium')).toBeGreaterThan(count('big'));
  });

  it('sends slimes of one pit on different rhythms', () => {
    const firstHop = (seed: number) => hops(hop(seed, 300, 'big', START, PLAYER))[0]?.from;
    expect(new Set([1, 2, 3, 4].map(firstHop)).size).toBeGreaterThan(1);
  });
});

/** Where each finished hop took off from and came down. */
function landings(log: ReturnType<typeof hop>, start: Point) {
  return hops(log)
    .filter(({ to }) => to < log.length - 1)
    .map(({ from, to }) => ({ from: from > 0 ? log[from - 1].at : start, to: log[to].at }));
}

describe('slime jumps', () => {
  const ROW = { x: 2.5, y: 3.5 };
  const FAR = () => ({ x: 40, y: 3.5 });
  /** Free floor except the cells in `blocked` (by column, on every row). */
  const floorWithout = (...blocked: number[]): Floor => (p) => !blocked.includes(Math.floor(p.x));

  it('jumps over a blocked cell and lands beyond it on free floor', () => {
    const floor = floorWithout(3, 4);
    const [first] = landings(hop(1, 300, 'big', ROW, FAR, floor), ROW);
    expect(first).toBeDefined();
    expect(first.to.x).toBeGreaterThan(5);
    expect(floor(first.to)).toBe(true);
  });

  it('lands on the nearest free cell along its line when the spot it aimed for is blocked', () => {
    // A full hop would come down in column 5 (2.5 + 3.3); 4 is the nearest free cell short of it.
    const floor = floorWithout(5, 6, 7, 8);
    const [first] = landings(hop(1, 300, 'big', ROW, FAR, floor), ROW);
    expect(first).toBeDefined();
    expect(Math.floor(first.to.x)).toBe(4);
    expect(Math.abs(first.to.y - ROW.y)).toBeLessThan(0.01);
  });

  it('never jumps across a room wall, only up to it', () => {
    // Column 4 is room wall (an L room's missing corner): the free floor beyond it is out of reach.
    const wall = floorWithout(4);
    const rng = createRng(1);
    let slime: Slime = createSlime('big', 0, rng);
    let to: Point | undefined;
    for (let i = 1; i <= 300 && !to; i++) {
      slime = updateSlime(slime, { time: i * FRAME_MS, at: ROW, player: FAR(), canLandAt: wall, canCross: wall }, rng).slime;
      if (slime.mode === 'hop') to = slime.to;
    }
    expect(to).toBeDefined();
    expect(to!.x).toBeLessThan(4);
  });

  it("doesn't jump when nothing along its line is free, and aims again", () => {
    const player = { x: 40, y: 3.5 };
    const rng = createRng(1);
    let slime: Slime = createSlime('big', 0, rng);
    const modes: Slime['mode'][] = [];
    for (let i = 1; i <= 300; i++) {
      const step = updateSlime(slime, { time: i * FRAME_MS, at: ROW, player, canLandAt: floorWithout(3, 4, 5, 6) }, rng);
      expect(speed(step.velocity)).toBe(0);
      slime = step.slime;
      modes.push(slime.mode);
    }
    expect(modes).not.toContain('hop');
    // Squashes, gives up, and squashes again: more than one try.
    const squashes = modes.filter((m, i) => m === 'squash' && modes[i - 1] !== 'squash').length;
    expect(squashes).toBeGreaterThan(1);
  });

  it('hops about 1.5x farther and 1.6x slower than it used to (big: 2.2 tiles in 400 ms)', () => {
    const log = hop(1, 600, 'big', ROW, FAR);
    const [first] = hops(log);
    const [landing] = landings(log, ROW);
    expect(dist(landing.from, landing.to)).toBeCloseTo(2.2 * 1.5, 1);
    expect((first.to - first.from + 1) * FRAME_MS).toBeGreaterThanOrEqual(400 * 1.6 - FRAME_MS);
    expect((first.to - first.from + 1) * FRAME_MS).toBeLessThanOrEqual(400 * 1.6 + 2 * FRAME_MS);
  });

  it('hops farther by its reach (a champion), in the same time', () => {
    const rng = createRng(1);
    let slime: Slime = createSlime('big', 0, rng);
    let to: { x: number; y: number } | undefined;
    for (let i = 1; i <= 300 && !to; i++) {
      slime = updateSlime(slime, { time: i * FRAME_MS, at: ROW, player: FAR(), canLandAt: OPEN, reach: 1.2 }, rng).slime;
      if (slime.mode === 'hop') to = slime.to;
    }
    expect(dist(ROW, to!)).toBeCloseTo(3.3 * 1.2, 1);
  });

  it('reports how far through the jump it is, rising from 0 to 1, and nothing on the ground', () => {
    const rng = createRng(1);
    let slime: Slime = createSlime('big', 0, rng);
    let at = { ...ROW };
    const air: number[] = [];
    for (let i = 1; i <= 300 && !(air.length && slime.mode !== 'hop'); i++) {
      const step = updateSlime(slime, { time: i * FRAME_MS, at, player: FAR(), canLandAt: OPEN }, rng);
      if (step.slime.mode === 'hop') air.push(step.airborne!);
      else expect(step.airborne).toBeUndefined();
      slime = step.slime;
      at = { x: at.x + step.velocity.x * (FRAME_MS / 1000), y: at.y + step.velocity.y * (FRAME_MS / 1000) };
    }
    expect(air.length).toBeGreaterThan(10);
    expect(air[0]).toBeCloseTo(0, 1);
    expect(air[air.length - 1]).toBeGreaterThan(0.95);
    expect(air.every((a, i) => i === 0 || a > air[i - 1])).toBe(true);
    expect(air.every((a) => a >= 0 && a <= 1)).toBe(true);
  });
});

describe('slime split', () => {
  const AT = { x: 5, y: 3 };

  it('splits a big slime (3 HP) into two mediums (2 HP), each medium into two smalls (1 HP), and a small into nothing', () => {
    expect(SLIME.tiers.big.hp).toBe(3);
    const mediums = splitSlime({ tier: 'big', champion: false }, AT);
    expect(mediums.map((c) => [c.tier, c.hp])).toEqual([['medium', 2], ['medium', 2]]);
    const smalls = splitSlime({ tier: 'medium', champion: false }, AT);
    expect(smalls.map((c) => [c.tier, c.hp])).toEqual([['small', 1], ['small', 1]]);
    expect(splitSlime({ tier: 'small', champion: false }, AT)).toEqual([]);
  });

  it('pops the children out sideways, apart from each other and clear of where the parent died', () => {
    const [a, b] = splitSlime({ tier: 'big', champion: false }, AT);
    expect(dist(a.at, AT)).toBeGreaterThanOrEqual(0.3);
    expect(dist(b.at, AT)).toBeGreaterThanOrEqual(0.3);
    expect(dist(a.at, b.at)).toBeGreaterThanOrEqual(0.6);
  });

  it("passes a champion's crown to its own children only", () => {
    const mediums = splitSlime({ tier: 'big', champion: true }, AT);
    expect(mediums.map((c) => c.champion)).toEqual([true, true]);
    // The crowned mediums split into plain smalls.
    expect(splitSlime(mediums[0], AT).map((c) => c.champion)).toEqual([false, false]);
    // A plain slime's children are plain.
    expect(splitSlime({ tier: 'big', champion: false }, AT).map((c) => c.champion)).toEqual([false, false]);
  });
});
