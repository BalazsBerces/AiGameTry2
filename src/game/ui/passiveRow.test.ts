import { describe, expect, it } from 'vitest';
import { PASSIVE_ROW, passiveRow } from './passiveRow';

const loaded = (...keys: string[]) => ({ exists: (key: string) => keys.includes(key) });

describe('passiveRow', () => {
  it('lays owned passives out in pool order, one pitch apart', () => {
    const row = passiveRow({ freeze: 2, poison: 1, homing: 1 }, loaded('freeze', 'poison'));
    expect(row.map((s) => s.passive)).toEqual(['homing', 'poison', 'freeze']);
    expect(row.map((s) => s.x)).toEqual([0, 1, 2].map((i) => PASSIVE_ROW.x + i * 24));
  });

  it('shows art where the passive has loaded art, and a dot otherwise', () => {
    const row = passiveRow({ freeze: 1, poison: 1, homing: 1 }, loaded('freeze'));
    expect(row.map((s) => s.art)).toEqual([undefined, undefined, 'freeze']);
  });

  it('rings level 2 only, wide enough for an icon and tight around a dot', () => {
    const row = passiveRow({ freeze: 2, poison: 1, homing: 2 }, loaded('freeze', 'poison'));
    const ring = Object.fromEntries(row.map((s) => [s.passive, s.ring]));
    expect(ring.poison).toBeUndefined();
    expect(ring.homing).toBe(PASSIVE_ROW.radius + 3);
    expect(ring.freeze).toBeGreaterThanOrEqual(PASSIVE_ROW.icon / 2);
  });

  it('fits every passive in one row, clear of the next slot', () => {
    const row = passiveRow(
      Object.fromEntries(
        ['homing', 'fireRate', 'sword', 'triple', 'pierce', 'ricochet', 'spectral', 'boomerang', 'poison', 'chain', 'freeze', 'orbital', 'dash'].map((p) => [p, 2]),
      ),
      loaded('freeze', 'poison'),
    );
    expect(row).toHaveLength(13);
    expect(new Set(row.map((s) => s.y))).toEqual(new Set([PASSIVE_ROW.y]));
    expect(PASSIVE_ROW.icon).toBeLessThanOrEqual(PASSIVE_ROW.pitch);
  });
});
