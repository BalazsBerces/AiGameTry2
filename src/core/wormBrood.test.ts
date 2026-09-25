import { describe, expect, it } from 'vitest';
import { broodTick, eggStage, WORM_BROOD, type BroodPiece } from './wormBrood';

/** A long piece, above ground, in phase two, with no brood about. */
const layer = (over: Partial<BroodPiece> = {}): BroodPiece => ({ length: 10, aboveGround: true, phaseTwo: true, brood: 0, ...over });

/** Ticks a piece every 100ms from 0 to `untilMs`; returns when it laid. */
function layTimes(untilMs: number, piece: (now: number) => BroodPiece) {
  const laid: number[] = [];
  let nextLayAt: number | undefined;
  for (let now = 0; now <= untilMs; now += 100) {
    const tick = broodTick(nextLayAt, now, piece(now));
    nextLayAt = tick.nextLayAt;
    if (tick.lay) laid.push(now);
  }
  return laid;
}

describe('worm boss eggs', () => {
  it('lays an egg every four seconds or so in phase two, the first a full interval in', () => {
    expect(layTimes(12500, () => layer())).toEqual([4000, 8000, 12000]);
  });

  it('lays nothing before phase two, and starts its interval once phase two begins', () => {
    const laid = layTimes(12500, (now) => layer({ phaseTwo: now >= 5000 }));
    expect(laid).toEqual([9000]);
  });

  it('lays nothing from a piece under four segments', () => {
    expect(layTimes(12500, () => layer({ length: 3 }))).toEqual([]);
    expect(layTimes(4500, () => layer({ length: 4 }))).toEqual([4000]);
  });

  it('holds an egg that falls due under the ground until it is back out', () => {
    expect(layTimes(12500, (now) => layer({ aboveGround: now < 3000 || now >= 7000 }))).toEqual([7000, 11000]);
  });

  it('lays nothing while the cap of eggs and hatchlings are about, and lays as soon as one is gone', () => {
    const { cap } = WORM_BROOD;
    expect(layTimes(12500, () => layer({ brood: cap }))).toEqual([]);
    expect(layTimes(12500, (now) => layer({ brood: now < 6000 ? cap : cap - 1 }))).toEqual([6000, 10000]);
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
