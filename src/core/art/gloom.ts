/**
 * The gloom: a moderate darkness over every cave room but the worm boss's arena, cut by light
 * pools round its glowers (the player, shots in flight). Atmosphere, not a mechanic: the room stays
 * readable everywhere, and nothing here moves, flickers or drifts but the pools' slow breathing.
 * The Candle Witch's dark is her own and has nothing to do with it.
 */
import { themeForFloor } from '../map/themes';

/** How dark the gloom is away from any light: moderate, never hiding the room's layout. */
export const GLOOM = { color: 0x04070a, alpha: 0.46 };

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
