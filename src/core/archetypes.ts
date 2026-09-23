import type { Cell, Direction, RoomKind } from './floorGenerator';
import type { Rng } from './rng';
import type { Door, EnemySpawn, PickupSpawn, Tile } from './roomGenerator';
import type { MirrorAxis, Symmetry } from './roomValidator';

/** What an archetype gets to draw its idea into. */
export interface ArchetypeContext {
  width: number;
  height: number;
  doors: Door[];
  rng: Rng;
}

export interface ArchetypeBuild {
  tiles: Tile[][];
  enemies: EnemySpawn[];
  /** Loot the idea places itself (on top of the room-clear drop). */
  pickups: PickupSpawn[];
  symmetry: Symmetry;
}

/** One room idea: a terrain shape plus the enemies and loot that make it read. */
export interface Archetype {
  id: string;
  /** The only floor this idea appears on. */
  floor: number;
  kind: Extract<RoomKind, 'normal' | 'item'>;
  /** Calm idea; the floor's first breather is its fallback and must fit every door set. */
  breather?: boolean;
  fits(doors: readonly Direction[]): boolean;
  build(ctx: ArchetypeContext): ArchetypeBuild;
}

const fitsAll = () => true;

/** Paints on an all-floor grid, mirroring every cell across the given axes. */
class Canvas {
  readonly tiles: Tile[][];
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly axes: MirrorAxis[],
  ) {
    this.tiles = Array.from({ length: height }, () => Array<Tile>(width).fill('floor'));
  }

  /** The cell and its images across the canvas's axes (deduplicated). */
  images(c: Cell): Cell[] {
    let out = [c];
    for (const axis of this.axes) {
      out = out.flatMap((p) => [p, axis === 'vertical' ? { x: this.width - 1 - p.x, y: p.y } : { x: p.x, y: this.height - 1 - p.y }]);
    }
    const seen = new Set<string>();
    return out.filter((p) => !seen.has(`${p.x},${p.y}`) && !!seen.add(`${p.x},${p.y}`));
  }

  paint(cells: Cell[], tile: Tile) {
    for (const c of cells.flatMap((p) => this.images(p))) {
      if (c.x >= 0 && c.y >= 0 && c.x < this.width && c.y < this.height) this.tiles[c.y][c.x] = tile;
    }
  }
}

const zombies = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: 'zombie', cell }));

/**
 * Floor 1 breather: rows of pillars mirrored into all four quadrants, and a pair of zombies
 * facing each other across the open centre row. Pillars never touch a door approach, so it
 * fits every door set.
 */
const pillaredHall: Archetype = {
  id: 'pillaredHall',
  floor: 0,
  kind: 'normal',
  breather: true,
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const layout = rng.pick([
      { cols: [3], row: 1 },
      { cols: [2, 4], row: 1 },
      { cols: [3], row: 2 },
      { cols: [2, 4], row: 2 },
      { cols: [3, 6], row: 2 },
    ]);
    canvas.paint(layout.cols.map((x) => ({ x, y: layout.row })), 'obstacle');
    const x = rng.int(3, 4);
    return { tiles: canvas.tiles, enemies: zombies(canvas.images({ x, y: 3 }).slice(0, 2)), pickups: [], symmetry: { axes } };
  },
};

/** Floor 1: an L of cover hugging every corner, with a zombie tucked into each one. */
const fourCorners: Archetype = {
  id: 'fourCorners',
  floor: 0,
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const arm = rng.int(2, 4);
    const cover: Tile = rng.next() < 0.3 ? 'hole' : 'obstacle';
    canvas.paint([...Array.from({ length: arm }, (_, i) => ({ x: 1 + i, y: 1 })), { x: 1, y: 2 }], cover);
    return { tiles: canvas.tiles, enemies: zombies(canvas.images({ x: 2, y: 2 })), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 1 puzzle: a chest in the middle, boxed in by stone with a rock set into the middle of
 * each wall, so shooting (or bombing) through is the only way in. Two zombies keep watch.
 */
const stash: Archetype = {
  id: 'stash',
  floor: 0,
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const centre = { x: (width - 1) / 2, y: (height - 1) / 2 };
    // Half-width of the box: 1 is a snug 3x3, 2 a wider 5x3 vault.
    const half = rng.int(1, 2);
    const left = centre.x - half;
    canvas.paint(
      Array.from({ length: half + 1 }, (_, i) => ({ x: left + i, y: centre.y - 1 })).concat({ x: left, y: centre.y }),
      'obstacle',
    );
    const rocks = [{ x: centre.x, y: centre.y - 1 }, { x: left, y: centre.y }];
    // A wide vault breaks open on the long walls only; its short ends stay stone.
    canvas.paint(half === 1 ? rocks : rocks.slice(0, 1), 'rock');
    // Two guards: either side of the box, or on opposite corners.
    const images = canvas.images(rng.pick([{ x: 2, y: 3 }, { x: 3, y: 1 }, { x: 2, y: 1 }]));
    return {
      tiles: canvas.tiles,
      enemies: zombies([images[0], images[images.length - 1]]),
      pickups: [{ type: 'chest', cell: centre }],
      symmetry: { axes },
    };
  },
};

export const ARCHETYPES: readonly Archetype[] = [pillaredHall, fourCorners, stash];

export const archetypeById = (id: string) => ARCHETYPES.find((a) => a.id === id);

export const archetypesFor = (floorIndex: number, kind: RoomKind) =>
  ARCHETYPES.filter((a) => a.floor === floorIndex && a.kind === kind);

/** The floor's first breather: always valid, used when an idea keeps failing validation. */
export const fallbackArchetype = (floorIndex: number, kind: RoomKind) => {
  const own = archetypesFor(floorIndex, kind);
  return own.find((a) => a.breather) ?? own[0];
};

export const MAX_USES_PER_FLOOR = 2;

export interface RoomToAssign {
  id: string;
  kind: RoomKind;
  doors: readonly Direction[];
}

/**
 * Picks an archetype for every room on a floor that has any, uniformly among those fitting
 * its doors and used fewer than twice. When every fitting idea is at the cap (more rooms than
 * the floor has ideas for), the least-used fitting ones are picked from instead.
 */
export function assignArchetypes(rooms: readonly RoomToAssign[], floorIndex: number, rng: Rng): Map<string, string> {
  const uses = new Map<string, number>();
  const assigned = new Map<string, string>();
  for (const room of rooms) {
    const fitting = archetypesFor(floorIndex, room.kind).filter((a) => a.fits(room.doors));
    if (!fitting.length) continue;
    const count = (a: Archetype) => uses.get(a.id) ?? 0;
    const underCap = fitting.filter((a) => count(a) < MAX_USES_PER_FLOOR);
    const least = Math.min(...fitting.map(count));
    const pick = rng.pick(underCap.length ? underCap : fitting.filter((a) => count(a) === least));
    uses.set(pick.id, count(pick) + 1);
    assigned.set(room.id, pick.id);
  }
  return assigned;
}
