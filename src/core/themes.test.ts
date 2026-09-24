import { describe, expect, it } from 'vitest';
import { bossForFloor } from './roomGenerator';
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

  it("gives each floor its theme's boss", () => {
    expect([0, 1, 2].map((f) => themeForFloor(f).boss)).toEqual(['treantBoss', 'wormBoss', 'shadowBoss']);
    expect([0, 1, 2].map((f) => bossForFloor(f))).toEqual(['treantBoss', 'wormBoss', 'shadowBoss']);
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

  it('gives glowshroom a look of its own on every floor, a glowshroom in the caves', () => {
    expect(themeForFloor(1).looks.glowshroom.name).toBe('glowshroom');
    expect(new Set([0, 1, 2].map((f) => themeForFloor(f).looks.glowshroom.name)).size).toBe(3);
  });
});
