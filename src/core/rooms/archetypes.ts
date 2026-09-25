import { type Cell, type Direction, type RoomKind, type RoomShape } from '../map/floorGenerator';
import type { Rng } from '../rng';
import type { Door, EnemySpawn, PickupSpawn, Tile } from './roomGenerator';
import type { MirrorAxis, Symmetry } from './roomValidator';
import { themeForFloor } from '../map/themes';
import type { Crusher } from '../obstacles/crusher';

/** What an archetype gets to draw its idea into. */
export interface ArchetypeContext {
  width: number;
  height: number;
  doors: Door[];
  rng: Rng;
  /** The room's shape; an L's missing cell is walled off after the build, so nothing may stand there. */
  shape?: RoomShape;
}

export interface ArchetypeBuild {
  tiles: Tile[][];
  enemies: EnemySpawn[];
  /** Loot the idea places itself (on top of the room-clear drop). */
  pickups: PickupSpawn[];
  symmetry: Symmetry;
  /** Crushers the idea sets, each on a `crusher` tile. */
  crushers?: Crusher[];
}

/** One room idea: a terrain shape plus the enemies and loot that make it read. */
export interface Archetype {
  id: string;
  /** The only floor this idea appears on. */
  floor: number;
  kind: Extract<RoomKind, 'normal' | 'item'>;
  /** The floor sub-theme a 1x1 idea always belongs to (see core/roomThemes); big rooms take theirs from the floor. */
  theme?: string;
  /** Calm idea; the floor's first breather is its fallback and must fit every door set. */
  breather?: boolean;
  fits(doors: readonly Direction[]): boolean;
  build(ctx: ArchetypeContext): ArchetypeBuild;
  /** Room shapes the idea is drawn for; a single 1x1 cell if left out. */
  shapes?: readonly RoomShape[];
}

export const supportsShape = (a: Archetype, shape: RoomShape) => (a.shapes ?? ['1x1']).includes(shape);

const fitsAll = () => true;

/** Paints on an all-floor grid (of tiles, or of a layout's roles), mirroring every cell across the given axes. */
export class Canvas<T extends string = Tile> {
  readonly tiles: (T | 'floor')[][];
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly axes: MirrorAxis[],
  ) {
    this.tiles = Array.from({ length: height }, () => Array<T | 'floor'>(width).fill('floor'));
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

  paint(cells: Cell[], tile: T | 'floor') {
    for (const c of cells.flatMap((p) => this.images(p))) {
      if (c.x >= 0 && c.y >= 0 && c.x < this.width && c.y < this.height) this.tiles[c.y][c.x] = tile;
    }
  }
}

/** The floor theme's walker (goblin in the forest, ...) on each cell. */
const walkersOf = (floorIndex: number, cells: Cell[]): EnemySpawn[] =>
  cells.map((cell) => ({ type: themeForFloor(floorIndex).walker, cell }));

/** The floor theme's turret (seed-spitter in the forest, ...) on each cell. */
const turretsOf = (floorIndex: number, cells: Cell[]): EnemySpawn[] =>
  cells.map((cell) => ({ type: themeForFloor(floorIndex).turret, cell }));

/**
 * Floor 1 breather, a glade: rows of trees mirrored into all four quadrants, and a pair of
 * goblins facing each other across the open centre row. Trees never touch a door approach, so
 * it fits every door set.
 */
const pillaredHall: Archetype = {
  id: 'pillaredHall',
  floor: 0,
  theme: 'grove',
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
    return { tiles: canvas.tiles, enemies: walkersOf(0, canvas.images({ x, y: 3 }).slice(0, 2)), pickups: [], symmetry: { axes } };
  },
};

/** Floor 1: an L of thicket or pond hugging every corner, with a goblin lurking in each one. */
const fourCorners: Archetype = {
  id: 'fourCorners',
  floor: 0,
  theme: 'marsh',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const arm = rng.int(2, 4);
    const cover: Tile = rng.next() < 0.3 ? 'hole' : 'obstacle';
    canvas.paint([...Array.from({ length: arm }, (_, i) => ({ x: 1 + i, y: 1 })), { x: 1, y: 2 }], cover);
    return { tiles: canvas.tiles, enemies: walkersOf(0, canvas.images({ x: 2, y: 2 })), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 1 puzzle, a goblin hoard: a chest in the middle, boxed in by trees with a bush set into
 * the middle of each wall, so shooting (or bombing) through is the only way in. Two goblins
 * keep watch.
 */
const stash: Archetype = {
  id: 'stash',
  floor: 0,
  theme: 'grove',
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
      enemies: walkersOf(0, [images[0], images[images.length - 1]]),
      pickups: [{ type: 'chest', cell: centre }],
      symmetry: { axes },
    };
  },
};

interface JarShape {
  /** Wall rectangle, inclusive. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** A jar across the middle mirrors both ways; one off to a side only top-to-bottom. */
  axes: MirrorAxis[];
  /** Where the opening may go on each wall. */
  openings: Record<Direction, Cell>;
}

const bigJar = (): JarShape => ({
  x0: 3, x1: 9, y0: 1, y1: 5,
  axes: ['vertical', 'horizontal'],
  openings: { up: { x: 6, y: 1 }, down: { x: 6, y: 5 }, left: { x: 3, y: 3 }, right: { x: 9, y: 3 } },
});

const sideJar = (side: 'left' | 'right', col: number): JarShape => {
  const x0 = side === 'left' ? 2 : 7;
  const x = x0 + col;
  return {
    x0, x1: x0 + 3, y0: 1, y1: 5,
    axes: ['horizontal'],
    openings: { up: { x, y: 1 }, down: { x, y: 5 }, left: { x: x0, y: 3 }, right: { x: x0 + 3, y: 3 } },
  };
};

function jarWall(shape: JarShape): Cell[] {
  const wall: Cell[] = [];
  for (let x = shape.x0; x <= shape.x1; x++) wall.push({ x, y: shape.y0 }, { x, y: shape.y1 });
  for (let y = shape.y0 + 1; y < shape.y1; y++) wall.push({ x: shape.x0, y }, { x: shape.x1, y });
  return wall;
}

function jarInside(shape: JarShape): Cell[] {
  const inside: Cell[] = [];
  for (let x = shape.x0 + 1; x < shape.x1; x++) for (let y = shape.y0 + 1; y < shape.y1; y++) inside.push({ x, y });
  return inside;
}

/**
 * Floor 1, the goblin den: a ring of trees holding a pack of goblins that can only pour out of
 * one small gap. The gap (the room's one asymmetry) never faces a door, so the pack doesn't
 * spill straight onto the player walking in.
 */
const jar: Archetype = {
  id: 'jar',
  floor: 0,
  theme: 'bramble',
  kind: 'normal',
  // Needs at least one wall without a door for the opening to face.
  fits: (doors) => doors.length < 4,
  build({ width, height, doors, rng }) {
    const sides = doors.map((d) => d.side);
    // The big jar's top and bottom walls would sit on the top and bottom door approaches.
    const shapes = [sideJar('left', rng.int(1, 2)), sideJar('right', rng.int(1, 2))];
    if (!sides.includes('up') && !sides.includes('down')) shapes.push(bigJar(), bigJar());
    const shape = rng.pick(shapes);
    const facing = rng.pick((['up', 'down', 'left', 'right'] as const).filter((s) => !sides.includes(s)));
    const opening = shape.openings[facing];

    const canvas = new Canvas(width, height, []);
    canvas.paint(jarWall(shape), 'obstacle');
    canvas.paint([opening], 'floor');
    const horde = shuffled(jarInside(shape), rng).slice(0, rng.int(4, 5));
    return { tiles: canvas.tiles, enemies: walkersOf(0, horde), pickups: [], symmetry: { axes: shape.axes, feature: [opening] } };
  },
};

/**
 * Floor 1: seed-spitters on an island in a pond. Nobody can walk out to them, but shots fly
 * over water both ways, so it's a shootout across the pond; trees offer cover, and 3-4 goblins
 * come off the banks so the player can't just sit behind one.
 */
const sentryIsland: Archetype = {
  id: 'sentryIsland',
  floor: 0,
  theme: 'marsh',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const layout = rng.pick([
      // One island in the middle, a ring of holes around it (painted as a quarter, mirrored).
      { moat: [{ x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 4, y: 3 }], turret: { x: 5, y: 3 } },
      { moat: [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 3, y: 3 }], turret: rng.pick([{ x: 4, y: 3 }, { x: 5, y: 3 }]) },
      // Twin islands, one turret on each.
      { moat: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 2, y: 3 }, { x: 4, y: 3 }], turret: { x: 3, y: 3 } },
    ]);
    canvas.paint(layout.moat, 'hole');
    if (rng.next() < 0.5) canvas.paint([{ x: 1, y: 1 }], 'obstacle');
    const banks = shuffled(canvas.images({ x: 3, y: 0 }), rng).slice(0, rng.int(3, 4));
    return {
      tiles: canvas.tiles,
      enemies: [...turretsOf(0, canvas.images(layout.turret)), ...walkersOf(0, banks)],
      pickups: [],
      symmetry: { axes },
    };
  },
};

/** The caves' own walker (ghouls) and turret (crystal turrets), from floor 2's theme. */
const caveWalkers = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: themeForFloor(1).walker, cell }));
const caveTurret = (cell: Cell): EnemySpawn => ({ type: themeForFloor(1).turret, cell });

/** Point-mirror through the room centre: where the second of a pair of worms lies. */
const opposite = (c: Cell, width: number, height: number): Cell => ({ x: width - 1 - c.x, y: height - 1 - c.y });

/** Big slimes on each cell: they split into a crowd when killed (core/slime). */
const slimesOf = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: 'slime', cell }));

/**
 * Floor 2: a stone block fills the middle, leaving a loop of floor around it for slimes to hop
 * laps on. They start on opposite straights.
 */
const track: Archetype = {
  id: 'track',
  floor: 1,
  theme: 'rift',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const halfWidth = rng.int(2, 3);
    const block = Array.from({ length: halfWidth + 1 }, (_, i) => [{ x: 6 - i, y: 2 }, { x: 6 - i, y: 3 }]).flat();
    canvas.paint(block, 'obstacle');
    // Rock kerbs at the ends of the block, sometimes.
    if (rng.next() < 0.5) canvas.paint([{ x: 6 - halfWidth - 1, y: 2 }], 'rock');
    const first = { x: rng.int(3, 4), y: rng.pick([0, 1]) };
    return { tiles: canvas.tiles, enemies: slimesOf([first, opposite(first, width, height)]), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2: two jars facing each other across the middle of the room. One holds ghouls, the
 * other a big slime; both spill into the same narrow gap between them.
 */
const twinJars: Archetype = {
  id: 'twinJars',
  floor: 1,
  theme: 'hollow',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const left = sideJar('left', 1);
    const right = sideJar('right', 1);
    const canvas = new Canvas(width, height, []);
    canvas.paint([...jarWall(left), ...jarWall(right)], 'obstacle');
    canvas.paint([left.openings.right, right.openings.left], 'floor');
    const [hordeJar, slimeJar] = rng.next() < 0.5 ? [left, right] : [right, left];
    const horde = shuffled(jarInside(hordeJar), rng).slice(0, rng.int(3, 4));
    const slime = rng.pick(jarInside(slimeJar));
    return { tiles: canvas.tiles, enemies: [...caveWalkers(horde), ...slimesOf([slime])], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2: a firing line of crystal turrets along one wall, behind a moat of holes, facing open
 * floor with a few rocks to duck behind (which the turrets slowly force you out of). Their shots
 * ricochet off the stone walls, so the far wall is no refuge, and three ghouls stalk the open floor
 * to flush the player out of cover. The line sits on a wall with no door.
 */
const gallery: Archetype = {
  id: 'gallery',
  floor: 1,
  theme: 'grotto',
  kind: 'normal',
  fits: (doors) => !doors.includes('up') || !doors.includes('down'),
  build({ width, height, doors, rng }) {
    const axes: MirrorAxis[] = ['vertical'];
    const canvas = new Canvas(width, height, axes);
    const top = !doors.some((d) => d.side === 'up') && (doors.some((d) => d.side === 'down') || rng.next() < 0.5);
    const row = (y: number) => (top ? y : height - 1 - y);
    canvas.paint(Array.from({ length: 7 }, (_, i) => ({ x: i, y: row(1) })), 'hole');
    const cover = rng.pick([[{ x: 3, y: 4 }, { x: 4, y: 4 }], [{ x: 2, y: 4 }, { x: 5, y: 4 }], [{ x: 4, y: 3 }, { x: 4, y: 4 }]]);
    canvas.paint(cover.map((c) => ({ x: c.x, y: row(c.y) })), 'rock');
    const turrets = [2, 6, 10].map((x) => caveTurret({ x, y: row(0) }));
    const stalkers = caveWalkers([{ x: 3, y: 5 }, { x: 9, y: 5 }, { x: 6, y: 3 }].map((c) => ({ x: c.x, y: row(c.y) })));
    return { tiles: canvas.tiles, enemies: [...turrets, ...stalkers], pickups: [], symmetry: { axes } };
  },
};

/** Floor 2: a grid of pillars with big slimes hopping between them. */
const serpentGarden: Archetype = {
  id: 'serpentGarden',
  floor: 1,
  theme: 'rift',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const cols = rng.pick([[2, 4, 6], [3, 5]]);
    canvas.paint(cols.map((x) => ({ x, y: 2 })), rng.next() < 0.3 ? 'rock' : 'obstacle');
    const lanes = shuffled(canvas.images({ x: rng.int(2, 4), y: 1 }), rng).slice(0, rng.int(2, 3));
    return { tiles: canvas.tiles, enemies: slimesOf(lanes), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2 breather: an open courtyard framed by stone in its corners, three ghouls milling
 * about the middle. Nothing touches a door approach, so it fits every door set.
 */
const courtyard: Archetype = {
  id: 'courtyard',
  floor: 1,
  theme: 'hollow',
  kind: 'normal',
  breather: true,
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const corner = rng.pick([
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }],
    ]);
    canvas.paint(corner, 'obstacle');
    if (rng.next() < 0.5) canvas.paint([{ x: 3, y: 0 }], 'obstacle');
    const x = rng.int(3, 4);
    return { tiles: canvas.tiles, enemies: caveWalkers([{ x, y: 3 }, { x: 6, y: 3 }, { x: width - 1 - x, y: 3 }]), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2 puzzle: a locked chest in a stone alcove set into a doorless wall, its mouth plugged
 * with a rock and a crystal turret standing guard on either side, while 2-3 ghouls prowl the floor
 * in front of it.
 */
const vault: Archetype = {
  id: 'vault',
  floor: 1,
  theme: 'grotto',
  kind: 'normal',
  fits: (doors) => !doors.includes('up') || !doors.includes('down'),
  build({ width, height, doors, rng }) {
    const axes: MirrorAxis[] = ['vertical'];
    const canvas = new Canvas(width, height, axes);
    const top = !doors.some((d) => d.side === 'up') && (doors.some((d) => d.side === 'down') || rng.next() < 0.5);
    const at = (c: Cell) => ({ x: c.x, y: top ? c.y : height - 1 - c.y });
    canvas.paint([{ x: 4, y: 0 }, { x: 4, y: 1 }, { x: 5, y: 1 }].map(at), 'obstacle');
    canvas.paint([at({ x: 6, y: 1 })], 'rock');
    const guard = rng.pick([{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 1 }]);
    const turrets = [guard, { x: width - 1 - guard.x, y: guard.y }].map((c) => caveTurret(at(c)));
    const prowl = shuffled([{ x: 2, y: 4 }, { x: 10, y: 4 }, { x: 6, y: 3 }], rng).slice(0, rng.int(2, 3));
    return {
      tiles: canvas.tiles,
      enemies: [...turrets, ...caveWalkers(prowl.map(at))],
      pickups: [{ type: 'lockedChest', cell: at({ x: 6, y: 0 }) }],
      symmetry: { axes },
    };
  },
};

/** The dungeon's walker (its tougher zombie) and turret (the gargoyle), from its theme. */
const dungeonWalkers = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: themeForFloor(2).walker, cell }));
const dungeonTurrets = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: themeForFloor(2).turret, cell }));

/** The dungeon's shielded skeleton knights, on each cell. */
const knightsOf = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: 'knight', cell }));

/**
 * Floor 3: a stone keep in the middle with gargoyles inside, firing out through arrow slits
 * (holes: shots pass, feet don't). Shielded knights patrol the grounds around it, so circling
 * one to get at its back puts you in the gargoyles' sights.
 */
const fortress: Archetype = {
  id: 'fortress',
  floor: 2,
  theme: 'cellblock',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const half = rng.int(2, 3);
    canvas.paint(Array.from({ length: half + 1 }, (_, i) => ({ x: 6 - i, y: 2 })).concat({ x: 6 - half, y: 3 }), 'obstacle');
    // Slits in line with the turrets: above/below them, or in the end walls beside them.
    const post = { x: 6 - half + 1, y: 3 };
    const slits = rng.pick([['top'], ['side'], ['top', 'side']]);
    if (slits.includes('top')) canvas.paint([{ x: post.x, y: 2 }], 'hole');
    if (slits.includes('side')) canvas.paint([{ x: 6 - half, y: 3 }], 'hole');
    const turrets = dungeonTurrets(canvas.images(post));
    const first = { x: rng.int(2, 4), y: 0 };
    const patrol = [first, opposite(first, width, height)].slice(0, rng.int(1, 2));
    return { tiles: canvas.tiles, enemies: [...turrets, ...knightsOf(patrol)], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 3: the floor has fallen away except for a cross of narrow walkways joining the doors.
 * Gargoyles on the far corners rake whoever is out on the cross, while 2-3 ghosts drift at the
 * player over the drop, where nobody on foot can follow.
 */
const killbox: Archetype = {
  id: 'killbox',
  floor: 2,
  theme: 'machineHall',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const walkway = rng.pick([1, 3]);
    const quadrant: Cell[] = [];
    for (let x = 0; x < 6; x++) for (let y = 0; y < (walkway === 1 ? 3 : 2); y++) quadrant.push({ x, y });
    canvas.paint(quadrant, 'hole');
    const perches = canvas.images(rng.pick([{ x: 0, y: 0 }, { x: 2, y: 0 }]));
    // All four corners, or just a diagonal pair; unused perches stay fallen away.
    const chosen = rng.next() < 0.5 ? perches : [perches[0], perches[perches.length - 1]];
    for (const c of chosen) canvas.tiles[c.y][c.x] = 'floor';
    const haunts = shuffled([{ x: 3, y: 3 }, { x: 9, y: 3 }, { x: 6, y: 3 }], rng).slice(0, rng.int(2, 3));
    return {
      tiles: canvas.tiles,
      enemies: [...dungeonTurrets(chosen), ...ghosts(haunts)],
      pickups: [],
      // A diagonal pair is only point-symmetric; the perches are the idea's own feature.
      symmetry: { axes, feature: chosen },
    };
  },
};

/**
 * Floor 3: a long nest across the room, packed with zombies and roosting gargoyles, with one opening on a
 * wall without a door. Its top and bottom walls would block those doors, so it only fits
 * rooms entered from the sides.
 */
const nest: Archetype = {
  id: 'nest',
  floor: 2,
  theme: 'cellblock',
  kind: 'normal',
  fits: (doors) => !doors.includes('up') && !doors.includes('down'),
  build({ width, height, doors, rng }) {
    const sides = doors.map((d) => d.side);
    const shape: JarShape = {
      x0: 2, x1: 10, y0: 1, y1: 5,
      axes: ['vertical', 'horizontal'],
      openings: { up: { x: 6, y: 1 }, down: { x: 6, y: 5 }, left: { x: 2, y: 3 }, right: { x: 10, y: 3 } },
    };
    const facing = rng.pick((['up', 'down', 'left', 'right'] as const).filter((s) => !sides.includes(s)));
    const opening = shape.openings[facing];
    const canvas = new Canvas(width, height, []);
    canvas.paint(jarWall(shape), 'obstacle');
    canvas.paint([opening], 'floor');
    // Gargoyles roost in two opposite corners of the nest, zombies crowd its middle row.
    const roosts = rng.next() < 0.5 ? [{ x: 3, y: 2 }, { x: 9, y: 4 }] : [{ x: 9, y: 2 }, { x: 3, y: 4 }];
    const zombieCells = shuffled([{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 7, y: 3 }, { x: 9, y: 3 }], rng).slice(0, rng.int(2, 3));
    return {
      tiles: canvas.tiles,
      enemies: [...dungeonTurrets(roosts), ...dungeonWalkers(zombieCells)],
      pickups: [],
      symmetry: { axes: shape.axes, feature: [opening] },
    };
  },
};

/**
 * Floor 3: two lanes along the top and bottom walls, each walled off from the middle and
 * guarded by a gargoyle at both ends, so anyone cutting through a lane is caught between them.
 * A shielded knight marches down each lane, pushing the player out into the gargoyles' sights.
 */
const crossfire: Archetype = {
  id: 'crossfire',
  floor: 2,
  theme: 'machineHall',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const length = rng.int(2, 3);
    canvas.paint(Array.from({ length }, (_, i) => ({ x: 2 + i, y: 2 })), 'obstacle');
    if (rng.next() < 0.6) canvas.paint([{ x: 2 + length, y: 2 }], 'rock');
    const end = { x: rng.pick([0, 1]), y: 1 };
    const turrets = dungeonTurrets(canvas.images(end));
    const lanes = canvas.images({ x: rng.int(3, 4), y: 0 });
    const knights = knightsOf([lanes[0], lanes[lanes.length - 1]]);
    return { tiles: canvas.tiles, enemies: [...turrets, ...knights], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 3 breather: broken rock walls, mirrored into every corner, with a pair of zombies
 * shambling around them. Nothing touches a door approach, so it fits every door set.
 */
const ruins: Archetype = {
  id: 'ruins',
  floor: 2,
  theme: 'crypt',
  kind: 'normal',
  breather: true,
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const fragment = rng.pick([
      [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 1 }],
      [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
      [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }],
    ]);
    canvas.paint(fragment, 'rock');
    if (rng.next() < 0.5) canvas.paint([{ x: 1, y: 1 }], 'rock');
    const first = { x: rng.int(2, 4), y: 0 };
    const second = rng.next() < 0.5 ? opposite(first, width, height) : { x: width - 1 - first.x, y: first.y };
    // Sometimes a ghost haunts the middle of the ruins as well.
    const haunt = rng.next() < 0.35 ? ghosts([{ x: (width - 1) / 2, y: (height - 1) / 2 }]) : [];
    return { tiles: canvas.tiles, enemies: [...dungeonWalkers([first, second]), ...haunt], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 3 puzzle: a chest buried in the middle of a dense field of rocks, with gargoyles
 * covering it; digging in means standing still under fire (or spending a bomb), with 2-3 zombies
 * shambling in among the rocks.
 */
const minefield: Archetype = {
  id: 'minefield',
  floor: 2,
  theme: 'crypt',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const reach = rng.int(2, 3);
    const field: Cell[] = [];
    for (let x = 6 - reach; x <= 6; x++) for (let y = 2; y <= 3; y++) field.push({ x, y });
    canvas.paint(field, 'rock');
    canvas.paint([{ x: 6, y: 3 }], 'floor');
    if (rng.next() < 0.5) canvas.paint([{ x: 6 - reach, y: 1 }], 'rock');
    const guard = rng.pick([{ x: 1, y: 1 }, { x: 2, y: 0 }]);
    const images = canvas.images(guard);
    const turrets = dungeonTurrets([images[0], images[images.length - 1]]);
    const shamblers = shuffled([{ x: 2, y: 3 }, { x: 10, y: 3 }, { x: 4, y: 0 }, { x: 8, y: 6 }], rng).slice(0, rng.int(2, 3));
    return {
      tiles: canvas.tiles,
      enemies: [...turrets, ...dungeonWalkers(shamblers)],
      pickups: [{ type: 'chest', cell: { x: 6, y: 3 } }],
      symmetry: { axes },
    };
  },
};

/**
 * The item on show, in the middle of the room where every showcase frames it. Which passive it
 * is gets decided when the player walks in (core/world), so it is never one they already own.
 */
const showpiece = (width: number, height: number): PickupSpawn => ({
  type: 'passive',
  cell: { x: (width - 1) / 2, y: (height - 1) / 2 },
});

/** Floor 1 item room: the item on an altar, ringed by pillars. */
const altar: Archetype = {
  id: 'altar',
  floor: 0,
  kind: 'item',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    canvas.paint(rng.pick([[{ x: 4, y: 2 }], [{ x: 5, y: 2 }], [{ x: 4, y: 1 }, { x: 5, y: 2 }], [{ x: 3, y: 1 }, { x: 4, y: 2 }]]), 'obstacle');
    if (rng.next() < 0.5) canvas.paint([{ x: 3, y: 3 }], 'obstacle');
    return { tiles: canvas.tiles, enemies: [], pickups: [showpiece(width, height)], symmetry: { axes } };
  },
};

/** Floor 2 item room: the item on an island shrine in a ring of holes, reached by two bridges. */
const shrine: Archetype = {
  id: 'shrine',
  floor: 1,
  kind: 'item',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const half = rng.int(2, 3);
    canvas.paint(Array.from({ length: half + 1 }, (_, i) => ({ x: 6 - i, y: 2 })).concat({ x: 6 - half, y: 3 }), 'hole');
    canvas.paint([rng.next() < 0.5 ? { x: 6, y: 2 } : { x: 6 - half, y: 3 }], 'floor');
    if (rng.next() < 0.5) canvas.paint([{ x: 1, y: 1 }], 'obstacle');
    return { tiles: canvas.tiles, enemies: [], pickups: [showpiece(width, height)], symmetry: { axes } };
  },
};

/** Floor 3 item room: a reliquary nave, columns lining the walls down to the item. */
const reliquary: Archetype = {
  id: 'reliquary',
  floor: 2,
  kind: 'item',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const cols = rng.pick([[2, 4], [3, 5], [1, 3, 5], [2]]);
    canvas.paint(cols.map((x) => ({ x, y: 1 })), rng.next() < 0.5 ? 'rock' : 'obstacle');
    return { tiles: canvas.tiles, enemies: [], pickups: [showpiece(width, height)], symmetry: { axes } };
  },
};

/**
 * Floor 1: hedges of bushes wind through the room, mirrored into all four quadrants, with goblins
 * loose in the lanes between them. One end of each quarter's hedge is a thorn bush, so the fight
 * is about luring walkers into the thorny ends while not brushing against them yourself. The
 * hedges never seal floor away or touch a door approach, so it fits every door set.
 */
const thornMaze: Archetype = {
  id: 'thornMaze',
  floor: 0,
  theme: 'bramble',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // Each layout is a top-left quarter of hedge, the hedge's ends, and a lane cell a goblin prowls.
    const layout = rng.pick([
      // Hedgerows: an L in each corner, lanes along the walls and through the middle.
      { hedge: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 2 }], ends: [{ x: 4, y: 1 }, { x: 2, y: 2 }], lane: { x: 3, y: 2 } },
      // Crossed hedges: a stub off the wall meets a post, leaving a crooked lane.
      { hedge: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }], ends: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 2, y: 2 }], lane: { x: 3, y: 1 } },
      // Zigzag: staggered hedges the walkers have to snake through.
      { hedge: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 1 }], ends: [{ x: 2, y: 1 }, { x: 3, y: 2 }, { x: 5, y: 1 }], lane: { x: 2, y: 2 } },
    ]);
    canvas.paint(layout.hedge, 'rock');
    // Sometimes a bush in each corner nook as well.
    if (rng.next() < 0.5) canvas.paint([{ x: 0, y: 1 }], 'rock');
    // One thorny end per quarter: four thorns in all, within the thorn cap.
    canvas.paint([rng.pick(layout.ends)], 'thorn');
    const lanes = canvas.images(layout.lane);
    // A pack in every quarter, or just a diagonal pair.
    const chosen = rng.next() < 0.5 ? lanes : [lanes[0], lanes[lanes.length - 1]];
    return { tiles: canvas.tiles, enemies: walkersOf(0, chosen), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 3: crushers hang in alcoves along the top and bottom walls, each facing a twin across
 * the room, ready to slam down (or up) across the middle when the player steps into their
 * column. Walkers wait in the crushers' paths, to be lured under them. Crusher columns stay
 * clear of the middle column and the side door rows, so no lane ends on a door approach.
 */
const crusherCorridor: Archetype = {
  id: 'crusherCorridor',
  floor: 2,
  theme: 'machineHall',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const cols = rng.pick([[3], [4], [2, 4], [3, 5]]);
    if (rng.next() < 0.5) {
      const flanks = cols.flatMap((x) => [x - 1, x + 1]).filter((x) => x >= 1 && x <= 5 && !cols.includes(x));
      canvas.paint(flanks.map((x) => ({ x, y: 1 })), 'obstacle');
    }
    const crusherCells = cols.flatMap((x) => canvas.images({ x, y: 1 }));
    canvas.paint(crusherCells, 'crusher');
    const lured = rng.pick(cols);
    const enemies = walkersOf(2, [{ x: lured, y: 3 }, { x: width - 1 - lured, y: 3 }]);
    if (rng.next() < 0.4) enemies.push(...turretsOf(2, [{ x: 0, y: 0 }, { x: width - 1, y: height - 1 }]));
    return {
      tiles: canvas.tiles,
      enemies,
      pickups: [],
      symmetry: { axes },
      crushers: crusherCells.map((cell): Crusher => ({ cell, axis: 'vertical' })),
    };
  },
};

/** Ghosts on each cell: they drift through walls, rocks and pits, so they may start anywhere on floor. */
const ghosts = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: 'ghost', cell }));

/**
 * Floor 3, the haunted hall: tombs mirrored into every quarter of a crypt, each sealing a ghost
 * in stone that nobody could walk to, though the ghosts drift straight out through the walls.
 * Sometimes a ring of pits in the middle holds one more, and zombies shamble down the open
 * middle row. Tombs stay clear of the door approaches, so it fits every door set.
 */
const hauntedHall: Archetype = {
  id: 'hauntedHall',
  floor: 2,
  theme: 'crypt',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const crosses = rng.next() < 0.5;
    // A cross of stone round one cell, or a sarcophagus: a sealed row of three cells.
    const tomb = crosses
      ? { stone: [{ x: 3, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 2 }], inside: [{ x: 3, y: 1 }] }
      : {
          stone: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
          inside: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
        };
    canvas.paint(tomb.stone, 'obstacle');
    const tombs = canvas.images(rng.pick(tomb.inside));
    // Every tomb haunted, or just a diagonal pair.
    const haunted = rng.next() < 0.5 ? tombs : [tombs[0], tombs[tombs.length - 1]];
    const enemies = ghosts(haunted);
    // The pit ring would cut the top and bottom doors off behind a sarcophagus's corner stones.
    if (crosses && rng.next() < 0.5) {
      canvas.paint([{ x: 6, y: 2 }, { x: 5, y: 3 }], 'hole');
      enemies.push(...ghosts([{ x: (width - 1) / 2, y: (height - 1) / 2 }]));
    }
    if (rng.next() < 0.4) enemies.push(...walkersOf(2, canvas.images({ x: 3, y: 3 })));
    return { tiles: canvas.tiles, enemies, pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2: a hall of mirrors built around bank shots. Crystals, mirrored into all four quarters,
 * bounce every shot, so each crystal turret sits straight in line with one: its shots come back
 * off it at angles, and the player can bank their own shots off it back at the turret. Ghouls
 * roam the open middle. Nothing touches a door approach, so it fits every door set.
 */
const crystalGallery: Archetype = {
  id: 'crystalGallery',
  floor: 1,
  theme: 'grotto',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // Each layout is a top-left quarter of crystals, a turret post in line with one, and a ghoul's spot.
    const layout = rng.pick([
      // Prism: a turret caged in crystal in the middle, open only to the sides; mirror posts in the corners.
      { crystals: [{ x: 5, y: 2 }, { x: 6, y: 2 }, { x: 2, y: 1 }], post: { x: 6, y: 3 }, ghoul: { x: 3, y: 3 } },
      // Corner mirrors: turrets in the corners, crystals down their wall and along their row.
      { crystals: [{ x: 3, y: 0 }, { x: 0, y: 2 }], post: { x: 0, y: 0 }, ghoul: { x: 6, y: 2 } },
      // Mirror screens: crystal bars across the room, a turret atop each.
      { crystals: [{ x: 3, y: 1 }, { x: 3, y: 2 }], post: { x: 3, y: 0 }, ghoul: { x: 6, y: 2 } },
    ]);
    canvas.paint(layout.crystals, 'crystal');
    const posts = canvas.images(layout.post);
    // Every post manned, or (when there are four) just a diagonal pair.
    const manned = posts.length > 2 && rng.next() < 0.5 ? [posts[0], posts[posts.length - 1]] : posts;
    const ghouls = canvas.images(layout.ghoul);
    return {
      tiles: canvas.tiles,
      enemies: [...turretsOf(1, manned), ...walkersOf(1, ghouls)],
      pickups: [],
      symmetry: { axes },
    };
  },
};

/**
 * Floor 3: skeleton knights stand guard over a chest on a pillared dais in the middle of the
 * room. Their shields turn to meet the player, so the chest is won by circling round the guards
 * (the pillars are cover and something to lead them round); sometimes gargoyles watch from the
 * corners. Nothing touches a door approach, so it fits every door set.
 */
const knightGuard: Archetype = {
  id: 'knightGuard',
  floor: 2,
  theme: 'cellblock',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // A top-left quarter of pillars, and the post of one knight (mirrored to the others).
    const layout = rng.pick([
      { pillars: [{ x: 5, y: 2 }], post: { x: 4, y: 3 } },
      { pillars: [{ x: 5, y: 2 }, { x: 3, y: 1 }], post: { x: 4, y: 3 } },
      { pillars: [{ x: 5, y: 2 }], post: { x: 4, y: 2 } },
      { pillars: [{ x: 4, y: 2 }, { x: 5, y: 2 }], post: { x: 3, y: 3 } },
    ]);
    canvas.paint(layout.pillars, 'obstacle');
    const enemies = knightsOf(canvas.images(layout.post));
    if (rng.next() < 0.4) enemies.push(...turretsOf(2, [{ x: 0, y: 0 }, { x: width - 1, y: height - 1 }]));
    const chest = { x: (width - 1) / 2, y: (height - 1) / 2 };
    return { tiles: canvas.tiles, enemies, pickups: [{ type: 'chest', cell: chest }], symmetry: { axes } };
  },
};

/**
 * Floor 1, the wasp nest: one swarm of 5-7 wasps hangs on a long reed island in a pond in the
 * middle of the room. Nobody walks out to it, but the wasps fly straight over the water, so the fight is
 * thinning a buzzing swarm as it comes; sometimes a pair of goblins prowls the banks too. The pond
 * stays small, so the player keeps most of the room to dodge in, and it clears every door approach.
 */
const waspNest: Archetype = {
  id: 'waspNest',
  floor: 0,
  theme: 'marsh',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // The island is the middle row from `from` to the centre column; the pond rings it (painted as a quarter).
    const from = rng.pick([3, 4]);
    const island = Array.from({ length: 7 - from }, (_, i) => ({ x: from + i, y: 3 }));
    canvas.paint([...Array.from({ length: 8 - from }, (_, i) => ({ x: from - 1 + i, y: 2 })), { x: from - 1, y: 3 }], 'hole');
    // Sometimes a stand of reeds on each bank.
    if (rng.next() < 0.5) canvas.paint([{ x: 1, y: 1 }], 'obstacle');
    // The swarm packs together along the island.
    const shore = island.flatMap((c) => canvas.images(c)).sort((a, b) => a.x - b.x);
    const size = Math.min(shore.length, rng.int(5, 7));
    const start = rng.int(0, shore.length - size);
    const wasps = shore.slice(start, start + size);
    // A goblin pair on opposite banks, or none.
    const banks = canvas.images({ x: 3, y: 1 });
    const guards = rng.next() < 0.5 ? walkersOf(0, [banks[0], banks[banks.length - 1]]) : [];
    return {
      tiles: canvas.tiles,
      enemies: [...wasps.map((cell): EnemySpawn => ({ type: 'wasp', cell })), ...guards],
      pickups: [],
      symmetry: { axes },
    };
  },
};

/**
 * Floor 1, the boar run: open ground with lone posts mirrored into every quarter, and a pair of
 * boars at opposite ends. Rock posts are bait: dodge a charge so the boar smashes one and stands
 * stunned. Stone posts stun it without breaking. The posts leave the middle row and column clear,
 * so no post blocks a door approach and the room fits every door set.
 */
const boarRun: Archetype = {
  id: 'boarRun',
  floor: 0,
  theme: 'grove',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // A top-left quarter of posts: at least one rock to smash, often a stone one to stun on.
    const posts = rng.pick([
      { rock: [{ x: 3, y: 1 }], stone: [{ x: 5, y: 2 }] },
      { rock: [{ x: 2, y: 2 }, { x: 4, y: 1 }], stone: [] },
      { rock: [{ x: 4, y: 2 }], stone: [{ x: 2, y: 1 }] },
      { rock: [{ x: 3, y: 2 }], stone: [{ x: 5, y: 1 }] },
    ]);
    canvas.paint(posts.rock, 'rock');
    canvas.paint(posts.stone, 'obstacle');
    if (rng.next() < 0.5) canvas.paint([{ x: 0, y: 0 }], 'obstacle');
    // Boars at opposite corners, or facing each other down the middle row.
    const images = canvas.images(rng.pick([{ x: 1, y: 1 }, { x: 1, y: 5 }, { x: 3, y: 3 }]));
    const boars = [images[0], images[images.length - 1]].map((cell): EnemySpawn => ({ type: 'boar', cell }));
    return { tiles: canvas.tiles, enemies: boars, pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2, the glowshroom cave: glowshrooms, mirrored into all four quarters, stand where the
 * cave's enemies start or have to pass, so a well-timed shot bursts one over them and stuns
 * them (an opening), as long as the player keeps out of the cloud themselves. Either a crystal
 * turret sits in a ring of glowshrooms in the middle, or ghouls wait beside caps in the lanes.
 * The caps stand alone or in short bars that wall nothing off and keep clear of the middle row
 * and column, so it fits every door set.
 */
const glowshroomCave: Archetype = {
  id: 'glowshroomCave',
  floor: 1,
  theme: 'hollow',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // A top-left quarter of glowshrooms, and a ghoul's spot beside one (mirrored to the others).
    const layout = rng.pick([
      // Ring: caps round a crystal turret in the middle, ghouls roaming the corners.
      { shrooms: [{ x: 5, y: 2 }], ghoul: { x: 2, y: 1 }, ringed: true },
      // Bars: a short bar of caps in each quarter, a ghoul waiting at its foot.
      { shrooms: [{ x: 3, y: 1 }, { x: 3, y: 2 }], ghoul: { x: 4, y: 2 }, ringed: false },
      // Patches: two caps either side of the ghoul's lane.
      { shrooms: [{ x: 2, y: 2 }, { x: 4, y: 1 }], ghoul: { x: 3, y: 1 }, ringed: false },
    ]);
    canvas.paint(layout.shrooms, 'glowshroom');
    // Sometimes a stalagmite in each corner too.
    if (rng.next() < 0.5) canvas.paint([{ x: 0, y: 0 }], 'obstacle');
    const posts = canvas.images(layout.ghoul);
    // Ghouls in every quarter, or just a diagonal pair.
    const ghouls = rng.next() < 0.5 ? posts : [posts[0], posts[posts.length - 1]];
    const turrets = layout.ringed ? turretsOf(1, [{ x: (width - 1) / 2, y: (height - 1) / 2 }]) : [];
    return { tiles: canvas.tiles, enemies: [...turrets, ...walkersOf(1, ghouls)], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2, the bat roost: chasms mirrored into every quarter, and bats roosting on their brinks
 * (islands in the middle of a chasm, ledges along a rift, or corner pockets cut off by the drop).
 * They flutter out over the dark and swoop across it at the player, who has to fight them from
 * the edge. Sometimes ghouls wander the floor between. Chasms stay clear of the door approaches,
 * so it fits every door set.
 */
const batRoost: Archetype = {
  id: 'batRoost',
  floor: 1,
  theme: 'rift',
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // A top-left quarter of chasm, the bats' roosts on its brink, and a ghoul's spot on open floor.
    const layout = rng.pick([
      // Islands: a pillar of rock rising out of a chasm on either side of the middle.
      {
        chasm: [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 3, y: 2 }, { x: 5, y: 2 }, { x: 3, y: 3 }, { x: 5, y: 3 }],
        roosts: [{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 2, y: 1 }],
        ghoul: { x: 1, y: 1 },
        sinkhole: false,
      },
      // Rifts: two deep drops either side of a bridge down the middle.
      {
        chasm: [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }],
        roosts: [{ x: 4, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 1 }],
        ghoul: { x: 1, y: 0 },
        sinkhole: false,
      },
      // Pockets: the corners cut off by the drop.
      {
        chasm: [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
        roosts: [{ x: 1, y: 1 }, { x: 1, y: 0 }],
        ghoul: { x: 4, y: 3 },
        sinkhole: true,
      },
    ]);
    canvas.paint(layout.chasm, 'hole');
    // Some layouts sometimes open a sinkhole in the middle too.
    if (layout.sinkhole && rng.next() < 0.5) canvas.paint([{ x: 5, y: 3 }, { x: 6, y: 3 }], 'hole');
    // A colony of 5-7 spread over the brinks.
    const bats = shuffled(layout.roosts.flatMap((c) => canvas.images(c)), rng).slice(0, rng.int(5, 7));
    const spots = canvas.images(layout.ghoul);
    const ghouls = rng.next() < 0.4 ? [spots[0], spots[spots.length - 1]] : [];
    return {
      tiles: canvas.tiles,
      enemies: [...bats.map((cell): EnemySpawn => ({ type: 'bat', cell })), ...walkersOf(1, ghouls)],
      pickups: [],
      symmetry: { axes },
    };
  },
};

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const ARCHETYPES: readonly Archetype[] = [
  pillaredHall,
  fourCorners,
  stash,
  jar,
  sentryIsland,
  courtyard,
  track,
  twinJars,
  gallery,
  serpentGarden,
  vault,
  ruins,
  fortress,
  killbox,
  nest,
  crossfire,
  minefield,
  altar,
  shrine,
  reliquary,
  thornMaze,
  crusherCorridor,
  crystalGallery,
  knightGuard,
  waspNest,
  boarRun,
  hauntedHall,
  glowshroomCave,
  batRoost,
];

export const archetypeById = (id: string) => ARCHETYPES.find((a) => a.id === id);

/** The floor's ideas for a kind of room, only those drawn for `shape` when one is given. */
export const archetypesFor = (floorIndex: number, kind: RoomKind, shape?: RoomShape) =>
  ARCHETYPES.filter((a) => a.floor === floorIndex && a.kind === kind && (!shape || supportsShape(a, shape)));

/** The floor's first breather for the shape: always valid, used when an idea keeps failing validation. */
export const fallbackArchetype = (floorIndex: number, kind: RoomKind, shape: RoomShape = '1x1') => {
  const own = archetypesFor(floorIndex, kind, shape);
  return own.find((a) => a.breather) ?? own[0];
};

export const MAX_USES_PER_FLOOR = 2;

export interface RoomToAssign {
  id: string;
  kind: RoomKind;
  doors: readonly Direction[];
  /** A single 1x1 cell if left out. */
  shape?: RoomShape;
  /** The room's sub-theme: ideas tagged with it are picked first. */
  theme?: string;
}

/**
 * Picks an archetype for every room on a floor that has any, uniformly among those drawn for
 * its shape, fitting its doors and used fewer than twice, and among those of the room's theme
 * while any of them are left. When every fitting idea is at the cap (more rooms than the floor
 * has ideas for), the least-used fitting ones are picked from instead.
 */
export function assignArchetypes(rooms: readonly RoomToAssign[], floorIndex: number, rng: Rng): Map<string, string> {
  const uses = new Map<string, number>();
  const assigned = new Map<string, string>();
  for (const room of rooms) {
    const fitting = archetypesFor(floorIndex, room.kind, room.shape ?? '1x1').filter((a) => a.fits(room.doors));
    if (!fitting.length) continue;
    const count = (a: Archetype) => uses.get(a.id) ?? 0;
    const underCap = fitting.filter((a) => count(a) < MAX_USES_PER_FLOOR);
    const themed = underCap.filter((a) => a.theme === room.theme);
    const least = Math.min(...fitting.map(count));
    const pick = rng.pick(themed.length ? themed : underCap.length ? underCap : fitting.filter((a) => count(a) === least));
    uses.set(pick.id, count(pick) + 1);
    assigned.set(room.id, pick.id);
  }
  return assigned;
}
