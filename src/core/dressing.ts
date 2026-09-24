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

/** How many looks each tile kind may come in: an art-pass sprite picks one by the tile's variant. */
export const VARIANTS = 4;

/** Tiles that pool into connected shapes the art pass can edge (shorelines, pit rims). */
const REGION_TILES: readonly Tile[] = ['hole'];

/** A connected group of pit, pond or chasm tiles (4-way: diagonal neighbours are separate). */
export interface Region {
  tile: Tile;
  cells: Cell[];
}

export interface Dressing {
  decor: Decor[];
  /** variants[y][x]: which of `VARIANTS` looks the tile at x,y takes; stable for the seed. */
  variants: number[][];
  regions: Region[];
}

/** Every connected group of region tiles, found by flood fill. */
function findRegions(tiles: Tile[][]): Region[] {
  const seen = new Set<string>();
  const regions: Region[] = [];
  tiles.forEach((row, y) =>
    row.forEach((tile, x) => {
      if (!REGION_TILES.includes(tile) || seen.has(`${x},${y}`)) return;
      const cells: Cell[] = [];
      const queue: Cell[] = [{ x, y }];
      seen.add(`${x},${y}`);
      while (queue.length) {
        const c = queue.shift()!;
        cells.push(c);
        for (const n of [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }]) {
          if (tiles[n.y]?.[n.x] !== tile || seen.has(`${n.x},${n.y}`)) continue;
          seen.add(`${n.x},${n.y}`);
          queue.push(n);
        }
      }
      regions.push({ tile, cells });
    }),
  );
  return regions;
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
 * scattered over its floor in its theme's kinds, a variant number for every tile, and its
 * connected pits and ponds grouped into regions. The same tiles, theme and seed always dress alike.
 */
export function dressRoom({ tiles, theme, rng }: DressingRequest): Dressing {
  // Their own stream, so a change to how decor is laid never reshuffles the tiles' variants.
  const variantRng = rng.fork('variants');
  const variants = tiles.map((row) => row.map(() => variantRng.int(0, VARIANTS - 1)));
  const regions = findRegions(tiles);
  const kinds = roomThemeById(theme)?.decor ?? [];
  const floor = tiles.flatMap((row, y) => row.flatMap((t, x) => (t === 'floor' ? [{ x, y }] : [])));
  if (!kinds.length || !floor.length) return { decor: [], variants, regions };
  const count = Math.min(floor.length, Math.max(DECOR.min, Math.round(floor.length * DECOR.density)));
  const decor = shuffled(floor, rng)
    .slice(0, count)
    .map((cell) => ({ cell, kind: rng.pick(kinds).id }));
  return { decor, variants, regions };
}
