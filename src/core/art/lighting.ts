/**
 * The dark rooms' lights: every room is dark but for pools of light round the player, shots in
 * flight and glowing things. Lights only brighten and warm; shadows never move.
 */

export interface Light {
  x: number;
  y: number;
  /** Reach in px: full light out to about half of it, fading to none at the edge. */
  radius: number;
  /** 0-1: how far it lifts the dark at its centre. */
  intensity: number;
  /** Also warms the colours it falls on (the player's lantern, glowshrooms). */
  warm?: boolean;
  /** Flickers, in its own way for this seed (a flame, a glow); shots burn steady. */
  flicker?: number;
}

/** The light the player carries. */
export const PLAYER_LIGHT = { radius: 150, intensity: 1, warm: true, flicker: 1 };

/** How dark rooms are away from any light, and how far the vignette darkens the corners. */
export const DARK = { color: 0x04070a, alpha: 0.62, vignette: 0.7 };

/** How far a light's flicker may stray: its radius by this share either way, its strength down by this share. */
export const FLICKER = { radius: 0.05, intensity: 0.12 };

/** A number in [0, 1) that `seed` and `k` always give. */
const hash = (seed: number, k: number) => {
  const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** Slow, uneven wandering in [-1, 1]: a few sines with the light's own speeds and phases. */
function wander(seed: number, time: number, channel: number): number {
  const s = time / 1000;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < 3; i++) {
    const w = 1 / (i + 1);
    const speed = (0.6 + hash(seed, channel * 7 + i) * 1.4) * (i + 1) * 1.7;
    sum += w * Math.sin(s * speed + hash(seed, channel * 7 + i + 3) * Math.PI * 2);
    weight += w;
  }
  return sum / weight;
}

/**
 * How a light breathes at `time`: factors for its radius and strength, the same for the same
 * `seed` and moment, and kept within `FLICKER` so the room never dims past readable.
 */
export function flicker(seed: number, time: number): { radius: number; intensity: number } {
  return {
    radius: 1 + FLICKER.radius * wander(seed, time, 0),
    intensity: 1 - FLICKER.intensity * (wander(seed, time, 1) + 1) / 2,
  };
}

export interface Lights {
  /** Registers or moves a light, by any key (the shot, the glowshroom's cell). */
  set(key: unknown, light: Light): void;
  remove(key: unknown): void;
  /** Drops every light but the player's (on entering a room). */
  clear(): void;
  /** This frame's lights: the player's first, where the player is, then every other. */
  frame(player: { x: number; y: number }): Light[];
}

export function createLights(): Lights {
  const lights = new Map<unknown, Light>();
  return {
    set: (key, light) => void lights.set(key, light),
    remove: (key) => void lights.delete(key),
    clear: () => lights.clear(),
    frame: (player) => [{ x: player.x, y: player.y, ...PLAYER_LIGHT }, ...lights.values()],
  };
}
