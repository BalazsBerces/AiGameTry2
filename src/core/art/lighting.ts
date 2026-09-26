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
}

/** The light the player carries. */
export const PLAYER_LIGHT = { radius: 150, intensity: 1, warm: true };

/** How dark rooms are away from any light, and how far the vignette darkens the corners. */
export const DARK = { color: 0x04070a, alpha: 0.62, vignette: 0.7 };

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
