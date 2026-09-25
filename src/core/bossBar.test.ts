import { describe, expect, it } from 'vitest';
import { layoutBossBar } from './bossBar';

const GAP = 0.02;

describe('boss bar', () => {
  it('is one full-width piece before the split, filled by the hit points left', () => {
    expect(layoutBossBar({ maxHp: 50, hp: 40, rage: false }, GAP)).toEqual([{ left: 0, right: 1, fill: 0.8, state: 'whole' }]);
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
    expect(layoutBossBar({ maxHp: 50, hp: 0, rage: false }, GAP)).toEqual([{ left: 0, right: 1, fill: 0, state: 'crumbling' }]);
  });
});
