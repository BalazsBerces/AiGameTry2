import { describe, expect, it } from 'vitest';
import type { Tile } from '../rooms/roomGenerator';
import {
  boomerangLeg,
  createHitLog,
  createTileLog,
  homingBlocks,
  meetEnemy,
  meetTerrain,
  type Meets,
  type ShotMods,
  type TerrainMeeting,
} from './shotFlight';

const plain: ShotMods = { piercesEnemies: false, piercesTerrain: false, spectral: false, passesShields: false, bouncesLeft: 0 };
const mods = (m: Partial<ShotMods>): ShotMods => ({ ...plain, ...m });

describe('shots meeting terrain', () => {
  const outcome = (shot: ShotMods, what: Meets) => meetTerrain(shot, what).outcome;

  it('stop plain shots at walls, stone and rock, but bounce them off crystal for free', () => {
    for (const what of ['wall', 'obstacle', 'rock', 'glowshroom', 'crusher'] as const) expect(outcome(plain, what), what).toBe('stop');
    expect(outcome(plain, 'crystal')).toBe('reflect');
  });

  it('bounce shots with bounces left off walls, stone and rock', () => {
    for (const what of ['wall', 'obstacle', 'rock'] as const) expect(outcome(mods({ bouncesLeft: 1 }), what), what).toBe('bounce');
  });

  it('let spectral shots through everything but the room’s walls', () => {
    for (const what of ['obstacle', 'rock', 'crystal', 'glowshroom', 'crusher'] as const) expect(outcome(mods({ spectral: true }), what), what).toBe('pass');
    expect(outcome(mods({ spectral: true }), 'wall')).toBe('stop');
  });

  it('pass spectral shots through rock but bounce them off the walls when they also ricochet', () => {
    const both = mods({ spectral: true, bouncesLeft: 2 });
    expect(outcome(both, 'rock')).toBe('pass');
    expect(outcome(both, 'obstacle')).toBe('pass');
    expect(outcome(both, 'wall')).toBe('bounce');
  });

  it('let upgraded piercing shots through stone and rock, not the walls', () => {
    expect(outcome(mods({ piercesTerrain: true }), 'rock')).toBe('pass');
    expect(outcome(mods({ piercesTerrain: true }), 'obstacle')).toBe('pass');
    expect(outcome(mods({ piercesTerrain: true }), 'wall')).toBe('stop');
  });
});

describe('which terrain a shot damages', () => {
  const shots: Record<string, ShotMods> = {
    plain,
    'spectral 1': mods({ spectral: true }),
    'spectral 2': mods({ spectral: true, piercesEnemies: true }),
    'pierce 1': mods({ piercesEnemies: true }),
    'pierce 2': mods({ piercesEnemies: true, piercesTerrain: true }),
    'ricochet, bounces left': mods({ bouncesLeft: 2 }),
    'ricochet, spent': mods({ bouncesLeft: 0 }),
    'spectral ricochet': mods({ spectral: true, bouncesLeft: 2 }),
  };
  const table: [string, Meets, TerrainMeeting][] = [
    ['plain', 'rock', { outcome: 'stop', hitsTile: true }],
    ['plain', 'glowshroom', { outcome: 'stop', hitsTile: true }],
    ['pierce 1', 'rock', { outcome: 'stop', hitsTile: true }],
    ['spectral 1', 'rock', { outcome: 'pass', hitsTile: true }],
    ['spectral 1', 'glowshroom', { outcome: 'pass', hitsTile: true }],
    ['spectral 2', 'rock', { outcome: 'pass', hitsTile: true }],
    ['spectral 2', 'glowshroom', { outcome: 'pass', hitsTile: true }],
    ['pierce 2', 'rock', { outcome: 'pass', hitsTile: true }],
    ['pierce 2', 'glowshroom', { outcome: 'pass', hitsTile: true }],
    ['spectral ricochet', 'rock', { outcome: 'pass', hitsTile: true }],
    ['ricochet, bounces left', 'rock', { outcome: 'bounce', hitsTile: true }],
    ['ricochet, bounces left', 'glowshroom', { outcome: 'bounce', hitsTile: true }],
    ['ricochet, spent', 'rock', { outcome: 'stop', hitsTile: true }],
    ['ricochet, spent', 'glowshroom', { outcome: 'stop', hitsTile: true }],
    // Nothing unbreakable ever takes a hit.
    ['ricochet, bounces left', 'obstacle', { outcome: 'bounce', hitsTile: false }],
    ['ricochet, bounces left', 'wall', { outcome: 'bounce', hitsTile: false }],
    ['ricochet, bounces left', 'crystal', { outcome: 'reflect', hitsTile: false }],
    ['ricochet, spent', 'obstacle', { outcome: 'stop', hitsTile: false }],
    ['ricochet, spent', 'wall', { outcome: 'stop', hitsTile: false }],
    ['ricochet, spent', 'crystal', { outcome: 'reflect', hitsTile: false }],
    ['spectral 1', 'obstacle', { outcome: 'pass', hitsTile: false }],
    ['spectral 1', 'crystal', { outcome: 'pass', hitsTile: false }],
    ['spectral 1', 'wall', { outcome: 'stop', hitsTile: false }],
    ['pierce 2', 'obstacle', { outcome: 'pass', hitsTile: false }],
    ['pierce 2', 'wall', { outcome: 'stop', hitsTile: false }],
    ['plain', 'obstacle', { outcome: 'stop', hitsTile: false }],
    ['plain', 'crusher', { outcome: 'stop', hitsTile: false }],
    ['plain', 'crystal', { outcome: 'reflect', hitsTile: false }],
    ['plain', 'hole', { outcome: 'pass', hitsTile: false }],
    ['plain', 'thorn', { outcome: 'pass', hitsTile: false }],
    ['spectral 1', 'hole', { outcome: 'pass', hitsTile: false }],
    ['pierce 2', 'thorn', { outcome: 'pass', hitsTile: false }],
  ];

  it.each(table)('%s meeting %s', (shot, what, expected) => {
    expect(meetTerrain(shots[shot], what)).toEqual(expected);
  });
});

describe('a pass-through shot’s tile hits', () => {
  it('hits each tile only on first contact', () => {
    const log = createTileLog();
    expect(log.first('r|1,1')).toBe(true);
    expect(log.first('r|1,1')).toBe(false);
    expect(log.first('r|2,1')).toBe(true);
    expect(log.first('r|2,1')).toBe(false);
  });

  it('is kept per shot', () => {
    const a = createTileLog();
    const b = createTileLog();
    expect(a.first('r|1,1')).toBe(true);
    expect(b.first('r|1,1')).toBe(true);
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
