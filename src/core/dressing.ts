import type { Cell } from './floorGenerator';
import type { Rng } from './rng';
import type { Tile } from './roomGenerator';
import { roomThemeById } from './roomThemes';

/** A bit of set dressing lying on a floor cell: never blocks feet or shots, it's only drawn. */
export interface Decor {
  cell: Cell;
  /** A decor kind id from the room's sub-theme (core/roomThemes). */
  kind: string;
}

/** Share of a room's floor cells that get decor, and the least any room with floor gets. */
export const DECOR = { density: 0.1, min: 3 };

export interface DressingRequest {
  tiles: Tile[][];
  /** The room's sub-theme id: it picks the decor kinds. */
  theme: string;
  rng: Rng;
}

export interface Dressing {
  decor: Decor[];
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A room's art-pass hooks, worked out from its finished tiles and never changing them: decor
 * scattered over its floor in its theme's kinds. The same tiles, theme and seed always dress alike.
 */
export function dressRoom({ tiles, theme, rng }: DressingRequest): Dressing {
  const kinds = roomThemeById(theme)?.decor ?? [];
  const floor = tiles.flatMap((row, y) => row.flatMap((t, x) => (t === 'floor' ? [{ x, y }] : [])));
  if (!kinds.length || !floor.length) return { decor: [] };
  const count = Math.min(floor.length, Math.max(DECOR.min, Math.round(floor.length * DECOR.density)));
  const decor = shuffled(floor, rng)
    .slice(0, count)
    .map((cell) => ({ cell, kind: rng.pick(kinds).id }));
  return { decor };
}
