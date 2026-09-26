import { describe, expect, it } from 'vitest';
import { BAR_FEEL, barShake, layoutBossBar, snapGap } from './bossBar';

const GAP = 0.02;

describe('boss bar', () => {
  it('is one full-width piece before the split, filled by the hit points left', () => {
    expect(layoutBossBar({ maxHp: 50, hp: 40, rage: false }, GAP)).toEqual([{ left: 0, right: 1, fill: 0.8, state: 'whole', remaining: 1 }]);
  });

  it("rips at the front half's share of what was left at the split, the front half on the left", () => {
    const halves = [
      { pool: 24, startPool: 24, alive: true },
      { pool: 16, startPool: 16, alive: true },
    ];
    const [front, back] = layoutBossBar({ maxHp: 50, hp: 40, halves, rage: false }, GAP);
    expect(front).toMatchObject({ left: 0, fill: 1, state: 'torn' });
    expect(front.right).toBeCloseTo(0.59);
    expect(back).toMatchObject({ right: 1, fill: 1, state: 'torn' });
    expect(back.left).toBeCloseTo(0.61);
  });

  it('drains each piece with its own half, and crumbles a dead half', () => {
    const halves = [
      { pool: 12, startPool: 24, alive: true },
      { pool: 0, startPool: 16, alive: false },
    ];
    const [front, back] = layoutBossBar({ maxHp: 50, hp: 12, halves, rage: false }, GAP);
    expect(front).toMatchObject({ fill: 0.5, state: 'torn' });
    expect(back).toMatchObject({ fill: 0, state: 'crumbling' });
  });

  it('enrages only the surviving half', () => {
    const halves = [
      { pool: 0, startPool: 24, alive: false },
      { pool: 10, startPool: 16, alive: true },
    ];
    const [front, back] = layoutBossBar({ maxHp: 50, hp: 10, halves, rage: true }, GAP);
    expect(front.state).toBe('crumbling');
    expect(back.state).toBe('rage');
  });

  it('crumbles whole if the worm dies before it ever splits', () => {
    expect(layoutBossBar({ maxHp: 50, hp: 0, rage: false }, GAP)).toEqual([{ left: 0, right: 1, fill: 0, state: 'crumbling', remaining: 1 }]);
  });

  it("keeps a dead half's piece, dying, while it blows apart, and crumbles it at its head blast", () => {
    const dying = { pool: 0, startPool: 16, alive: false, death: { pops: 4, of: 11, blown: false } };
    const alive = { pool: 12, startPool: 24, alive: true };
    expect(layoutBossBar({ maxHp: 50, hp: 12, halves: [alive, dying], rage: false }, GAP)[1].state).toBe('dying');
    const blown = { ...dying, death: { pops: 11, of: 11, blown: true } };
    expect(layoutBossBar({ maxHp: 50, hp: 12, halves: [alive, blown], rage: false }, GAP)[1].state).toBe('crumbling');
  });
});

describe('boss bar dying piece', () => {
  const alive = { pool: 12, startPool: 24, alive: true };
  const dying = (pops: number) => layoutBossBar({ maxHp: 50, hp: 12, halves: [alive, { pool: 0, startPool: 16, alive: false, death: { pops, of: 4, blown: false } }], rage: false }, GAP)[1];

  it('is whole until its first pop', () => {
    expect(dying(0).remaining).toBe(1);
  });

  it('breaks off a chunk from its tail end, the right, with each segment that pops', () => {
    expect([1, 2, 3].map((pops) => dying(pops).remaining)).toEqual([0.75, 0.5, 0.25]);
  });

  it('is only a live piece when whole', () => {
    expect(layoutBossBar({ maxHp: 50, hp: 12, halves: [alive, alive], rage: false }, GAP)[0].remaining).toBe(1);
  });
});

describe('boss bar shake', () => {
  const alive = { pool: 20, startPool: 24, alive: true };
  const split = { maxHp: 50, hp: 40, rage: false, splitAt: 1000, halves: [alive, { ...alive }] };

  it('never shakes before the split, nor on ordinary hits', () => {
    expect(barShake({ maxHp: 50, hp: 31, rage: false }, 5000)).toEqual([0]);
  });

  it('jolts hard at the snap, then fades out fast', () => {
    const over = [1000, 1050, 1100, 1200, 1300].map((t) => barShake(split, t)[0]);
    expect(over[0]).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < over.length; i++) expect(over[i]).toBeLessThan(over[i - 1]);
    expect(barShake(split, 1000)).toEqual([over[0], over[0]]);
    expect(barShake(split, 1000 + BAR_FEEL.snapJoltMs)).toEqual([0, 0]);
  });

  it("trembles a dying piece harder with each pop, and only that piece", () => {
    const dying = (pops: number) => ({ ...split, halves: [alive, { pool: 0, startPool: 24, alive: false, death: { pops, of: 11, blown: false } }] });
    const later = [1, 4, 8, 11].map((pops) => barShake(dying(pops), 9000));
    for (const [live] of later) expect(live).toBe(0);
    for (let i = 1; i < later.length; i++) expect(later[i][1]).toBeGreaterThan(later[i - 1][1]);
    expect(later[0][1]).toBeGreaterThan(0);
  });

  it('stops trembling a piece once it has blown apart', () => {
    const blown = { ...split, halves: [alive, { pool: 0, startPool: 24, alive: false, death: { pops: 11, of: 11, blown: true } }] };
    expect(barShake(blown, 9000)).toEqual([0, 0]);
  });

  it('trembles through the roar, and stops after it', () => {
    const roaring = { ...split, rage: true, roar: { from: 9000, until: 11000 } };
    for (const t of [9000, 10000, 10999]) expect(barShake(roaring, t)[0], `${t}`).toBeGreaterThan(0);
    expect(barShake(roaring, 11000)[0]).toBe(0);
    expect(barShake(roaring, 8999)[0]).toBe(0);
  });
});

describe('boss bar snap', () => {
  it('flies the halves apart past their gap, then slams them back to it', () => {
    const over = Array.from({ length: 101 }, (_, i) => snapGap((i / 100) * BAR_FEEL.snapMs, GAP));
    expect(over[0]).toBe(0);
    expect(Math.max(...over)).toBeGreaterThan(GAP * 2);
    expect(over[100]).toBe(GAP);
    expect(snapGap(BAR_FEEL.snapMs * 3, GAP)).toBe(GAP);
  });
});
