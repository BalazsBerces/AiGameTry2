import { describe, expect, it } from 'vitest';
import { bossForFloor } from './roomGenerator';
import { createRng } from './rng';
import { themeForFloor } from './themes';

describe('floor themes', () => {
  it('names the three floors forest, caves and dungeon', () => {
    expect([0, 1, 2].map((f) => themeForFloor(f).name)).toEqual(['Forest', 'Caves', 'Dungeon']);
  });

  it('shows a hole as a pond, a chasm and a pit', () => {
    expect([0, 1, 2].map((f) => themeForFloor(f).looks.hole.name)).toEqual(['pond', 'chasm', 'pit']);
  });

  it('shows stone as a tree, a stalagmite and a brick pillar', () => {
    expect([0, 1, 2].map((f) => themeForFloor(f).looks.obstacle.name)).toEqual(['tree', 'stalagmite', 'brick pillar']);
  });

  it('shows rock as a bush, loose rock and rubble', () => {
    expect([0, 1, 2].map((f) => themeForFloor(f).looks.rock.name)).toEqual(['bush', 'loose rock', 'rubble']);
  });

  it('gives every floor its own floor, wall and door colours', () => {
    for (const part of ['floor', 'wall', 'door'] as const) {
      expect(new Set([0, 1, 2].map((f) => themeForFloor(f).palette[part])).size).toBe(3);
    }
  });

  it('keeps the last theme for floors past the end', () => {
    expect(themeForFloor(5).name).toBe('Dungeon');
  });

  it('gives the forest the Treant, the caves the Worm boss and the dungeon a pool with the Iron Maiden', () => {
    expect(themeForFloor(0).bosses).toEqual(['treantBoss']);
    expect(themeForFloor(1).bosses).toEqual(['wormBoss']);
    expect(themeForFloor(2).bosses).toContain('ironMaiden');
  });

  it("picks each floor's boss from its theme's pool", () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const f of [0, 1, 2]) expect(themeForFloor(f).bosses).toContain(bossForFloor(f, createRng(seed)));
    }
  });

  it('picks the same boss for the same seed', () => {
    for (let seed = 0; seed < 20; seed++) expect(bossForFloor(2, createRng(seed))).toBe(bossForFloor(2, createRng(seed)));
  });

  it('has retired the Shadow', () => {
    for (const f of [0, 1, 2]) expect(themeForFloor(f).bosses as readonly string[]).not.toContain('shadowBoss');
  });

  it('debuts the ghost in the dungeon and nowhere else', () => {
    expect(themeForFloor(2).newEnemies).toContain('ghost');
    for (const f of [0, 1]) expect(themeForFloor(f).newEnemies ?? []).not.toContain('ghost');
  });

  it('debuts the bat in the caves and nowhere else', () => {
    expect(themeForFloor(1).newEnemies).toContain('bat');
    for (const f of [0, 2]) expect(themeForFloor(f).newEnemies ?? []).not.toContain('bat');
  });

  it('shows a thorn as a thorn bush in the forest', () => {
    expect(themeForFloor(0).looks.thorn.name).toBe('thorn bush');
  });

  it('gives crystal a look of its own on every floor, a crystal cluster in the caves', () => {
    expect(themeForFloor(1).looks.crystal.name).toBe('crystal cluster');
    expect(new Set([0, 1, 2].map((f) => themeForFloor(f).looks.crystal.name)).size).toBe(3);
  });

  it('colours the caves earthy brown: red over green over blue in the room and its stone', () => {
    const brown = (c: number) => {
      const [r, g, b] = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
      return r > g && g > b;
    };
    const caves = themeForFloor(1);
    for (const part of ['background', 'floor', 'itemFloor', 'bossFloor', 'wall'] as const) {
      expect(brown(caves.palette[part]), part).toBe(true);
    }
    for (const tile of ['obstacle', 'rock', 'crusher'] as const) expect(brown(caves.looks[tile].color), tile).toBe(true);
  });

  it('keeps the caves crystals cyan and glowshrooms green against the brown', () => {
    expect(themeForFloor(1).looks.crystal.color).toBe(0x7fd4e0);
    expect(themeForFloor(1).looks.glowshroom.color).toBe(0x6ae0a0);
  });

  it("keeps the caves' brown boss floor apart from the forest's", () => {
    expect(themeForFloor(1).palette.bossFloor).not.toBe(themeForFloor(0).palette.bossFloor);
  });

  it('gives glowshroom a look of its own on every floor, a glowshroom in the caves', () => {
    expect(themeForFloor(1).looks.glowshroom.name).toBe('glowshroom');
    expect(new Set([0, 1, 2].map((f) => themeForFloor(f).looks.glowshroom.name)).size).toBe(3);
  });
});
