import { describe, expect, it } from 'vitest';
import { broodTick, eggStage, WORM_BROOD, type BroodPiece } from './wormBrood';

/** The whole worm, before its split, out of the walls, with no brood about. */
const thrower = (over: Partial<BroodPiece> = {}): BroodPiece => ({ split: false, aboveGround: true, brood: 0, ...over });

/** Ticks the worm every 100ms from 0 to `untilMs`; returns each lob as [when, how many eggs]. */
function lobs(untilMs: number, piece: (now: number) => BroodPiece) {
  const thrown: [number, number][] = [];
  let nextLobAt: number | undefined;
  for (let now = 0; now <= untilMs; now += 100) {
    const tick = broodTick(nextLobAt, now, piece(now));
    nextLobAt = tick.nextLobAt;
    if (tick.eggs) thrown.push([now, tick.eggs]);
  }
  return thrown;
}

describe('worm boss eggs', () => {
  it('lobs two eggs every five seconds before it splits, the first a full interval in', () => {
    expect(lobs(15500, () => thrower())).toEqual([
      [5000, 2],
      [10000, 2],
      [15000, 2],
    ]);
  });

  it('lobs no more once it has split', () => {
    expect(lobs(15500, () => thrower({ split: true }))).toEqual([]);
    expect(lobs(15500, (now) => thrower({ split: now >= 7000 }))).toEqual([[5000, 2]]);
  });

  it('holds a lob that falls due while it rampages or is in the walls until it is back out', () => {
    expect(lobs(12500, (now) => thrower({ aboveGround: now < 4000 || now >= 7000 }))).toEqual([
      [7000, 2],
      [12000, 2],
    ]);
  });

  it('lobs only as many as there is room for under the cap of eggs and hatchlings', () => {
    const { cap } = WORM_BROOD;
    expect(cap).toBe(4);
    expect(lobs(10500, () => thrower({ brood: 3 }))).toEqual([
      [5000, 1],
      [10000, 1],
    ]);
  });

  it('holds its lob while the cap is full, and lobs as soon as one is gone', () => {
    expect(lobs(12500, () => thrower({ brood: 4 }))).toEqual([]);
    expect(lobs(12500, (now) => thrower({ brood: now < 6000 ? 4 : 2 }))).toEqual([
      [6000, 2],
      [11000, 2],
    ]);
  });
});

describe('worm boss egg hatching', () => {
  const { hatchMs, wobbleMs } = WORM_BROOD;

  it('rests, wobbles for its last stretch, then hatches', () => {
    expect(eggStage(1000, 1000)).toBe('resting');
    expect(eggStage(1000, 1000 + hatchMs - wobbleMs - 1)).toBe('resting');
    expect(eggStage(1000, 1000 + hatchMs - wobbleMs)).toBe('wobbling');
    expect(eggStage(1000, 1000 + hatchMs - 1)).toBe('wobbling');
    expect(eggStage(1000, 1000 + hatchMs)).toBe('hatched');
  });
});
