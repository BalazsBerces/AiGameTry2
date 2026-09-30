import { describe, expect, it } from 'vitest';
import { parseArenaQuery } from './testArena';

describe('test arena URL', () => {
  it('spawns one of a bare enemy name', () => {
    expect(parseArenaQuery('?zombie')).toEqual({ spawns: [{ type: 'zombie', count: 1 }], champion: false, unknown: [] });
  });

  it('spawns as many as the count says', () => {
    expect(parseArenaQuery('?zombie=3')?.spawns).toEqual([{ type: 'zombie', count: 3 }]);
  });

  it('mixes several enemies', () => {
    expect(parseArenaQuery('?zombie=2&bat')?.spawns).toEqual([
      { type: 'zombie', count: 2 },
      { type: 'bat', count: 1 },
    ]);
  });

  it('leaves seed, boss and room to their own shortcuts', () => {
    expect(parseArenaQuery('?seed=12&zombie')?.spawns).toEqual([{ type: 'zombie', count: 1 }]);
    expect(parseArenaQuery('?seed=12&zombie')?.unknown).toEqual([]);
    expect(parseArenaQuery('?boss')).toBeUndefined();
    expect(parseArenaQuery('?boss=2&seed=4')).toBeUndefined();
    expect(parseArenaQuery('?room=slimePit')).toBeUndefined();
  });

  it('gives nothing back when no enemy is named', () => {
    expect(parseArenaQuery('')).toBeUndefined();
    expect(parseArenaQuery('?seed=5')).toBeUndefined();
    expect(parseArenaQuery('?champion')).toBeUndefined();
  });

  it('makes every spawn a champion with the champion flag', () => {
    expect(parseArenaQuery('?zombie&champion')?.champion).toBe(true);
    expect(parseArenaQuery('?zombie=2&bat&champion')).toEqual({
      spawns: [
        { type: 'zombie', count: 2 },
        { type: 'bat', count: 1 },
      ],
      champion: true,
      unknown: [],
    });
  });

  it('picks the slime size, big by default', () => {
    expect(parseArenaQuery('?slime')?.spawns).toEqual([{ type: 'slime', count: 1, tier: 'big' }]);
    expect(parseArenaQuery('?slime=small')?.spawns).toEqual([{ type: 'slime', count: 1, tier: 'small' }]);
    expect(parseArenaQuery('?slime=medium')?.spawns).toEqual([{ type: 'slime', count: 1, tier: 'medium' }]);
  });

  it('takes a slime size with a count, or a count alone', () => {
    expect(parseArenaQuery('?slime=small:3')?.spawns).toEqual([{ type: 'slime', count: 3, tier: 'small' }]);
    expect(parseArenaQuery('?slime=2')?.spawns).toEqual([{ type: 'slime', count: 2, tier: 'big' }]);
  });

  it('spawns bosses by their ids', () => {
    for (const boss of ['wormBoss', 'ironMaiden', 'candleWitch', 'treantBoss']) {
      expect(parseArenaQuery(`?${boss}`)?.spawns, boss).toEqual([{ type: boss, count: 1 }]);
    }
  });

  it('skips names that are no enemy and reports them', () => {
    expect(parseArenaQuery('?zombei&bat')).toEqual({ spawns: [{ type: 'bat', count: 1 }], champion: false, unknown: ['zombei'] });
    // Reported even when nothing else is named, so a lone typo is still warned about.
    expect(parseArenaQuery('?zombei')).toEqual({ spawns: [], champion: false, unknown: ['zombei'] });
  });
});
