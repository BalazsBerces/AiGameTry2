import type { BossType, EnemyType, Tile } from './roomGenerator';

export interface Palette {
  background: number;
  floor: number;
  itemFloor: number;
  bossFloor: number;
  wall: number;
  door: number;
  /** Highlights: cracks, rims and minor details. */
  accent: number;
}

/**
 * How a tile kind is drawn on a floor. `round` tiles are circles, `block` tiles squares; `inset`
 * is the gap in pixels left around the shape inside its tile.
 */
export interface TileLook {
  name: string;
  shape: 'block' | 'round';
  color: number;
  stroke?: number;
  inset: number;
}

/** Everything floor-specific in one place: adding or tweaking a floor is a data change. */
export interface FloorTheme {
  name: string;
  palette: Palette;
  /** Room tiles only: `wall` (an L room's missing cell) is drawn in the palette's wall colour. */
  looks: Record<Exclude<Tile, 'floor' | 'wall'>, TileLook>;
  /** The floor's boss is picked from these, once per run (see `bossForFloor`). */
  bosses: readonly BossType[];
  /** The floor's basic walker and turret: each floor's variants look and behave differently. */
  walker: EnemyType;
  turret: EnemyType;
  /** Hit points of the floor's walker when it is a tougher take on its type (the dungeon zombie). */
  walkerHp?: number;
  /** New enemy types that debut on this floor, in rooms built around them. */
  newEnemies?: readonly EnemyType[];
}

const THEMES: readonly FloorTheme[] = [
  {
    name: 'Forest',
    palette: {
      background: 0x0b120b,
      floor: 0x34482c,
      itemFloor: 0x4d5a2a,
      bossFloor: 0x3a3226,
      wall: 0x18261a,
      door: 0x6b4a2a,
      accent: 0x9cc46a,
    },
    looks: {
      obstacle: { name: 'tree', shape: 'round', color: 0x2f6b2f, stroke: 0x5a3b22, inset: 2 },
      rock: { name: 'bush', shape: 'round', color: 0x5f9c3f, stroke: 0x2e5020, inset: 8 },
      hole: { name: 'pond', shape: 'block', color: 0x2a5a8a, stroke: 0x4f86b8, inset: 0 },
      thorn: { name: 'thorn bush', shape: 'round', color: 0x4a3a1e, stroke: 0xc0506a, inset: 4 },
      crusher: { name: 'rolling log', shape: 'block', color: 0x6a4a2c, stroke: 0x3a2616, inset: 2 },
      crystal: { name: 'mirror stone', shape: 'block', color: 0xa8d8c0, stroke: 0xe8fff0, inset: 6 },
      glowshroom: { name: 'puffball', shape: 'round', color: 0xd8c86a, stroke: 0xfff4b0, inset: 10 },
    },
    bosses: ['treantBoss'],
    walker: 'goblin',
    turret: 'seedSpitter',
  },
  {
    name: 'Caves',
    palette: {
      background: 0x0f0a06,
      floor: 0x4a3a2a,
      itemFloor: 0x5c4a2c,
      bossFloor: 0x4a2c20,
      wall: 0x1e150e,
      door: 0x5a4a3a,
      accent: 0x7fd4e0,
    },
    // Earthy browns; the cyan crystals and green glowshrooms are the colour in the dark.
    looks: {
      obstacle: { name: 'stalagmite', shape: 'round', color: 0x7a6450, stroke: 0x4a3a2c, inset: 4 },
      rock: { name: 'loose rock', shape: 'block', color: 0x9a8468, stroke: 0x5a4632, inset: 10 },
      hole: { name: 'chasm', shape: 'block', color: 0x050302, stroke: 0x2a1e14, inset: 0 },
      thorn: { name: 'thorn vine', shape: 'round', color: 0x4a3626, stroke: 0xb0607a, inset: 4 },
      crusher: { name: 'boulder', shape: 'round', color: 0x6a5440, stroke: 0x3a2c20, inset: 2 },
      crystal: { name: 'crystal cluster', shape: 'block', color: 0x7fd4e0, stroke: 0xd8f8ff, inset: 5 },
      glowshroom: { name: 'glowshroom', shape: 'round', color: 0x6ae0a0, stroke: 0xd0ffe0, inset: 8 },
    },
    bosses: ['wormBoss'],
    walker: 'ghoul',
    turret: 'crystalTurret',
    newEnemies: ['bat'],
  },
  {
    name: 'Dungeon',
    palette: {
      background: 0x0d0b10,
      floor: 0x3b3340,
      itemFloor: 0x4a4326,
      bossFloor: 0x4a2630,
      wall: 0x1c1720,
      door: 0x7a5230,
      accent: 0xc84a3a,
    },
    looks: {
      obstacle: { name: 'brick pillar', shape: 'block', color: 0x7a4e44, stroke: 0x4a2c26, inset: 4 },
      rock: { name: 'rubble', shape: 'block', color: 0xa8a090, stroke: 0x5c5040, inset: 10 },
      hole: { name: 'pit', shape: 'block', color: 0x050407, stroke: 0x2a1c20, inset: 0 },
      thorn: { name: 'bramble', shape: 'round', color: 0x3a2a24, stroke: 0xa04a3a, inset: 4 },
      crusher: { name: 'crusher', shape: 'block', color: 0x5c6068, stroke: 0xc84a3a, inset: 1 },
      crystal: { name: 'polished mirror', shape: 'block', color: 0x9aa8c8, stroke: 0xf0f0ff, inset: 4 },
      glowshroom: { name: 'grave mould', shape: 'round', color: 0x8ab070, stroke: 0xd0f0a0, inset: 10 },
    },
    bosses: ['ironMaiden'],
    walker: 'zombie',
    turret: 'gargoyle',
    walkerHp: 5,
    newEnemies: ['ghost'],
  },
];

/** The theme of floor `floorIndex`; floors past the last theme keep it. */
export const themeForFloor = (floorIndex: number): FloorTheme => THEMES[Math.min(Math.max(floorIndex, 0), THEMES.length - 1)];
