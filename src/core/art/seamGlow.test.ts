import { describe, expect, it } from 'vitest';
import { DEFAULT_SEAM_GLOW, findSeamGlow, glowFromQuery, wormBossKind } from './seamGlow';
import { parseArenaQuery } from '../rooms/testArena';

describe("the worm boss's seam glow", () => {
  it('is blood red until the choice is made', () => {
    expect(DEFAULT_SEAM_GLOW).toBe('blood');
  });

  it('is named blood red or molten ember, by any of their names, ignoring case', () => {
    for (const name of ['blood', 'blood red', 'Red']) expect(findSeamGlow(name), name).toBe('blood');
    for (const name of ['ember', 'molten ember', 'MOLTEN']) expect(findSeamGlow(name), name).toBe('ember');
    for (const name of ['', 'violet', 'green']) expect(findSeamGlow(name), name).toBeUndefined();
  });

  it('is picked on the URL with ?glow=, which is no enemy for the test arena', () => {
    expect(glowFromQuery('?glow=ember')).toBe('ember');
    expect(glowFromQuery('seed=4&glow=blood')).toBe('blood');
    expect(glowFromQuery('?seed=4')).toBeUndefined();
    expect(glowFromQuery('?glow=violet')).toBeUndefined();
    expect(parseArenaQuery('glow=ember')).toBeUndefined();
  });

  it("draws the boss's pieces from the art baked in the glow shown", () => {
    for (const index of [0, 1, 4]) {
      expect(wormBossKind('wormBossHead', 'blood', index)).toBe('wormBossHead');
      expect(wormBossKind('wormBossBody', 'blood', index)).toBe('wormBossBody');
      expect(wormBossKind('wormBossHead', 'ember', index)).toBe('wormBossHeadEmber');
      expect(wormBossKind('wormBossTail', 'ember', index)).toBe('wormBossTailEmber');
    }
  });

  it("gives the Molten Centipede's body three crack patterns in turn down its length, so it never repeats plate to plate", () => {
    const body = [1, 2, 3, 4, 5, 6, 7].map((i) => wormBossKind('wormBossBody', 'ember', i));
    expect(body).toEqual(['wormBossBodyEmber1', 'wormBossBodyEmber2', 'wormBossBodyEmber0', 'wormBossBodyEmber1', 'wormBossBodyEmber2', 'wormBossBodyEmber0', 'wormBossBodyEmber1']);
  });
});
