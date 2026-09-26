import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createSlime, SLIME, splitSlime, updateSlime, type Slime, type SlimeTier } from './slime';

const FRAME_MS = 16;
type Point = { x: number; y: number };

/** Hops a slime from `start` (tiles) for `frames` frames, the player where `player(time)` says. */
function hop(seed: number, frames: number, tier: SlimeTier, start: Point, player: (time: number) => Point) {
  const rng = createRng(seed);
  let slime: Slime = createSlime(tier, 0, rng);
  let at = { ...start };
  const log: { time: number; at: Point; slime: Slime; velocity: Point }[] = [];
  for (let i = 1; i <= frames; i++) {
    const time = i * FRAME_MS;
    const step = updateSlime(slime, { time, at, player: player(time) }, rng);
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
      const step = updateSlime(slime, { time, at, player }, rng);
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
