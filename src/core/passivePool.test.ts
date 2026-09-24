import { describe, expect, it } from 'vitest';
import { offerPassive, pickUpgrade } from './passivePool';
import { PASSIVE_POOL } from './roomGenerator';
import { createRng } from './rng';

describe('passive pool', () => {
  it('never offers a passive the player already owns', () => {
    const allButFireRate = Object.fromEntries(PASSIVE_POOL.filter((p) => p !== 'fireRate').map((p, i) => [p, (i % 2) + 1]));
    for (let seed = 0; seed < 50; seed++) {
      expect(offerPassive(allButFireRate, createRng(seed))).toBe('fireRate');
    }
  });

  it('offers every passive the player lacks, now and then', () => {
    const offered = new Set(Array.from({ length: 60 }, (_, seed) => offerPassive({}, createRng(seed))));
    expect([...offered].sort()).toEqual([...PASSIVE_POOL].sort());
  });

  it('has nothing to offer once the player owns every passive', () => {
    const all = Object.fromEntries(PASSIVE_POOL.map((p) => [p, 1]));
    expect(offerPassive(all, createRng(1))).toBeUndefined();
  });

  it('upgrades only an owned passive still at level 1', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(pickUpgrade({ homing: 2, fireRate: 1 }, createRng(seed))).toBe('fireRate');
    }
    const picks = new Set(Array.from({ length: 60 }, (_, seed) => pickUpgrade({ homing: 1, sword: 1 }, createRng(seed))));
    expect([...picks].sort()).toEqual(['homing', 'sword']);
  });

  it('upgrades nothing when every owned passive is already at level 2, or none is owned', () => {
    expect(pickUpgrade({ homing: 2, sword: 2 }, createRng(1))).toBeUndefined();
    expect(pickUpgrade({}, createRng(1))).toBeUndefined();
  });
});
