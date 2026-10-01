/**
 * The gloom: a moderate darkness over every cave room but the worm boss's arena, cut by light
 * pools round its glowers (the player, shots in flight, crystal, glowing fungus, the floor's
 * glints). Atmosphere, not a mechanic: the room stays readable everywhere, and nothing here moves,
 * flickers or drifts but the pools' slow breathing.
 * The Candle Witch's dark is her own and has nothing to do with it.
 */
import type { Cell } from '../map/floorGenerator';
import { themeForFloor } from '../map/themes';
import type { Decor } from '../rooms/dressing';
import type { Tile } from '../rooms/roomGenerator';
import { decorNudge } from './catalogue';
import { TILE, wallGems, type WallSide } from './terrain';

/** How dark the gloom is away from any light: moderate, never hiding the room's layout. */
export const GLOOM = { color: 0x04070a, alpha: 0.55 };
/**
 * The rock round the room sinks deeper into the gloom, so the walls recede and the eye stays on the
 * floor: a shade per band, stacking up `step` px apart going out from the room's edge.
 */
export const WALL_SHADE = { bands: [0.12, 0.12, 0.14], step: 10 };

/** A lit spot cut out of the gloom. */
export interface LightPool {
  /** Reach in px: full light out to about half of it, fading to none at the edge. */
  radius: number;
  /** 0-1: how far it lifts the gloom at its centre. */
  intensity: number;
}

/** The light round the player: modest, so their surroundings are always clear. */
export const PLAYER_POOL: LightPool = { radius: 140, intensity: 1 };
/** The light round a shot in flight (the player's or an enemy's), at a shot's usual size. */
export const SHOT_POOL: LightPool = { radius: 46, intensity: 0.9 };

/** A room is gloomy when it is in the caves and isn't the worm boss's arena; cleared, item and start rooms too. */
export function isGloomy(room: { floorIndex: number; enemies: readonly { type: string }[] }): boolean {
  return themeForFloor(room.floorIndex).shell === 'caves' && !room.enemies.some((e) => e.type === 'wormBoss');
}

/** How far a light pool breathes: its strength between these shares of full. */
export const PULSE = { min: 0.72, max: 1 };
/** One breath takes between these, in ms, by its seed. */
const BREATH_MS = { min: 3000, max: 5000 };

/** A number in [0, 1) that `seed` and `k` always give. */
const hash = (seed: number, k: number) => {
  const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * How strongly a glower's light pool shines at `time` (ms), as a share of full: a slow breath
 * of its own pace and phase for its `seed`, so neighbours never swell together.
 */
export function pulse(seed: number, time: number): number {
  const period = BREATH_MS.min + hash(seed, 0) * (BREATH_MS.max - BREATH_MS.min);
  const phase = hash(seed, 1) * Math.PI * 2;
  const swell = (1 + Math.sin((time / period) * Math.PI * 2 + phase)) / 2;
  return PULSE.min + (PULSE.max - PULSE.min) * swell;
}

/** The colour a fixed glower casts into its light pool, if any. */
export type GlowTint = 'cyan' | 'violet';
/** Each tint's light: crystal a cold blue, fungus a deep purple; deeper than the things themselves, for mood. */
export const GLOW_COLOR: Record<GlowTint, string> = { cyan: '#3a78f0', violet: '#9a36e0' };
/**
 * A coloured glower's light is its colour, not white: it lifts only `lift` of the gloom a white light
 * would, and lays its colour over the pool at `glow` strength.
 */
export const TINTED = { lift: 0.45, glow: 0.42 };

/** Something fixed in a room that casts a light pool: where (px from the room's top-left tile corner), how far and strong, and its pulse's seed. */
export interface Glower extends LightPool {
  x: number;
  y: number;
  tint: GlowTint;
  seed: number;
}

/** Terrain looks that glow, by look: crystal cyan, glowing fungus violet. Mushroom caps stay dull. */
const GLOWING_LOOKS: Readonly<Record<string, LightPool & { tint: GlowTint; rise: number }>> = {
  'crystal cluster': { radius: 85, intensity: 0.5, tint: 'cyan', rise: 6 },
  'crystal spire': { radius: 95, intensity: 0.5, tint: 'cyan', rise: 14 },
  glowshroom: { radius: 90, intensity: 0.55, tint: 'violet', rise: 6 },
  'giant mushroom': { radius: 100, intensity: 0.5, tint: 'violet', rise: 16 },
};
/** Floor decor that glints in the gloom: very faint. */
const GLOWING_DECOR: Readonly<Record<string, LightPool & { tint: GlowTint }>> = {
  glints: { radius: 36, intensity: 0.22, tint: 'cyan' },
  shards: { radius: 32, intensity: 0.18, tint: 'cyan' },
  spores: { radius: 36, intensity: 0.22, tint: 'violet' },
};
/** A wall gem's faint light. */
export const WALL_GEM_GLOW: LightPool & { tint: GlowTint } = { radius: 44, intensity: 0.3, tint: 'cyan' };
/** How a terrain look glows (raised `rise` px off its tile's centre, to the glowing part), or undefined if it stays dull. */
export const lookGlow = (look: string): (LightPool & { tint: GlowTint; rise: number }) | undefined => GLOWING_LOOKS[look];
/** How a decor kind glints, or undefined if it doesn't. */
export const decorGlow = (kind: string): (LightPool & { tint: GlowTint }) | undefined => GLOWING_DECOR[kind];

/** What a room's fixed glowers are read from. */
export interface GlowRoom {
  /** tiles[y][x]: a glower whose tile is gone (broken, burst) is gone with it. */
  tiles: readonly (readonly Tile[])[];
  /** The look a terrain tile is drawn as in this room (core/roomThemes). */
  lookOf: (tile: Tile) => string | undefined;
  decor: readonly Decor[];
  /** The room's wall pieces: where (their cell), which side they face the room from, and their variant. */
  walls: readonly { cell: Cell; side: WallSide; variant: number }[];
  /** Crystal-veined walls carry wall gems; strata walls carry none. */
  veined?: boolean;
}

/**
 * Every fixed glower in a room: one per crystal cluster, crystal spire, glowshroom and giant
 * mushroom on its tile, one per glinting decor piece where it is drawn, and one per wall gem where
 * its wall piece sets it. Each has a seed of its own, so neighbours breathe out of step.
 */
export function glowersOf(room: GlowRoom): Glower[] {
  const centre = (cell: Cell) => ({ x: (cell.x + 0.5) * TILE, y: (cell.y + 0.5) * TILE });
  const seedOf = (cell: Cell, k: number) => Math.imul(cell.x + 101, 73856093) ^ Math.imul(cell.y + 101, 19349663) ^ Math.imul(k + 1, 83492791);
  const tiles = room.tiles.flatMap((row, y) =>
    row.flatMap((tile, x) => {
      const look = room.lookOf(tile);
      const glow = look ? lookGlow(look) : undefined;
      if (!glow) return [];
      const c = centre({ x, y });
      return [{ x: c.x, y: c.y - glow.rise, radius: glow.radius, intensity: glow.intensity, tint: glow.tint, seed: seedOf({ x, y }, 0) }];
    }),
  );
  const decor = room.decor.flatMap((d) => {
    const glow = decorGlow(d.kind);
    if (!glow) return [];
    const [c, nudge] = [centre(d.cell), decorNudge(d.cell, 'caves')];
    return [{ x: c.x + nudge.x, y: c.y + nudge.y, ...glow, seed: seedOf(d.cell, 1) }];
  });
  const gems = room.veined
    ? room.walls.flatMap((w) =>
        wallGems(w.side, w.variant).map((g, i) => {
          const c = centre(w.cell);
          return { x: c.x + g.x, y: c.y + g.y, ...WALL_GEM_GLOW, seed: seedOf(w.cell, 2 + i) };
        }),
      )
    : [];
  return [...tiles, ...decor, ...gems];
}
