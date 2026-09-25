import { describe, expect, it } from 'vitest';
import type { Tile } from '../rooms/roomGenerator';
import { boomerangLeg, createHitLog, homingBlocks, meetEnemy, meetTerrain, type ShotMods } from './shotFlight';

const plain: ShotMods = { piercesEnemies: false, piercesTerrain: false, spectral: false, passesShields: false, bouncesLeft: 0 };
const mods = (m: Partial<ShotMods>): ShotMods => ({ ...plain, ...m });

describe('shots meeting terrain', () => {
  it('stop plain shots at walls, stone and rock, but bounce them off crystal for free', () => {
    for (const what of ['wall', 'obstacle', 'rock', 'glowshroom', 'crusher'] as const) expect(meetTerrain(plain, what), what).toBe('stop');
    expect(meetTerrain(plain, 'crystal')).toBe('reflect');
  });

  it('bounce shots with bounces left off walls, stone and rock', () => {
    for (const what of ['wall', 'obstacle', 'rock'] as const) expect(meetTerrain(mods({ bouncesLeft: 1 }), what), what).toBe('bounce');
  });

  it('let spectral shots through everything but the room’s walls', () => {
    for (const what of ['obstacle', 'rock', 'crystal', 'glowshroom', 'crusher'] as const) expect(meetTerrain(mods({ spectral: true }), what), what).toBe('pass');
    expect(meetTerrain(mods({ spectral: true }), 'wall')).toBe('stop');
  });

  it('pass spectral shots through rock but bounce them off the walls when they also ricochet', () => {
    const both = mods({ spectral: true, bouncesLeft: 2 });
    expect(meetTerrain(both, 'rock')).toBe('pass');
    expect(meetTerrain(both, 'obstacle')).toBe('pass');
    expect(meetTerrain(both, 'wall')).toBe('bounce');
  });

  it('let upgraded piercing shots through stone and rock, not the walls', () => {
    expect(meetTerrain(mods({ piercesTerrain: true }), 'rock')).toBe('pass');
    expect(meetTerrain(mods({ piercesTerrain: true }), 'obstacle')).toBe('pass');
    expect(meetTerrain(mods({ piercesTerrain: true }), 'wall')).toBe('stop');
  });
});

describe('shots meeting enemies', () => {
  it('spend a plain shot on the enemy it hurts', () => {
    expect(meetEnemy(plain, false)).toEqual({ damages: true, continues: false });
  });

  it('carry a piercing shot on after hurting the enemy', () => {
    expect(meetEnemy(mods({ piercesEnemies: true }), false)).toEqual({ damages: true, continues: true });
  });

  it('spend a shot on a shield without hurting, unless it passes shields', () => {
    expect(meetEnemy(plain, true)).toEqual({ damages: false, continues: false });
    expect(meetEnemy(mods({ piercesEnemies: true }), true)).toEqual({ damages: false, continues: false });
    expect(meetEnemy(mods({ passesShields: true }), true)).toEqual({ damages: true, continues: false });
  });
});

describe('a piercing shot’s hits', () => {
  it('hurts each enemy once per leg of its flight', () => {
    const log = createHitLog();
    expect(log.first('out', 'a')).toBe(true);
    expect(log.first('out', 'a')).toBe(false);
    expect(log.first('out', 'b')).toBe(true);
    expect(log.first('back', 'a')).toBe(true);
    expect(log.first('back', 'a')).toBe(false);
  });
});

describe('boomerang legs', () => {
  it('flies out for its time, then comes back', () => {
    expect(boomerangLeg(0, 400)).toBe('out');
    expect(boomerangLeg(399, 400)).toBe('out');
    expect(boomerangLeg(400, 400)).toBe('back');
  });
});

describe('what homing sees past', () => {
  const tiles: Tile[] = ['obstacle', 'rock', 'crystal', 'glowshroom', 'hole', 'thorn', 'floor', 'wall'];
  const blocked = (m: ShotMods) => tiles.filter(homingBlocks(m));

  it('is blocked by whatever blocks a plain shot', () => {
    expect(blocked(plain)).toEqual(['obstacle', 'rock', 'crystal', 'glowshroom', 'wall']);
  });

  it('sees through stone and rock for a spectral or terrain-piercing shot, never through the walls', () => {
    expect(blocked(mods({ spectral: true }))).toEqual(['wall']);
    expect(blocked(mods({ piercesTerrain: true }))).toEqual(['wall']);
  });
});
