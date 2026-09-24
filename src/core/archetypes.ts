import { L_SHAPES, missingCell, type Cell, type Direction, type RoomKind, type RoomShape } from './floorGenerator';
import type { Rng } from './rng';
import { PASSIVE_POOL, WORM_LENGTH, type Door, type EnemySpawn, type PickupSpawn, type Tile } from './roomGenerator';
import type { MirrorAxis, Symmetry } from './roomValidator';
import { themeForFloor } from './themes';
import type { Crusher } from './crusher';

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
  /** Calm idea; the floor's first breather is its fallback and must fit every door set. */
  breather?: boolean;
  fits(doors: readonly Direction[]): boolean;
  build(ctx: ArchetypeContext): ArchetypeBuild;
  /** Room shapes the idea is drawn for; a single 1x1 cell if left out. */
  shapes?: readonly RoomShape[];
}

export const supportsShape = (a: Archetype, shape: RoomShape) => (a.shapes ?? ['1x1']).includes(shape);

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
 * over water both ways, so it's a shootout across the pond; trees offer cover.
 */
const sentryIsland: Archetype = {
  id: 'sentryIsland',
  floor: 0,
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
    return { tiles: canvas.tiles, enemies: turretsOf(0, canvas.images(layout.turret)), pickups: [], symmetry: { axes } };
  },
};

/** A worm lying along `chain`, head first. */
const worm = (chain: Cell[]): EnemySpawn => ({ type: 'worm', cell: chain[0], tail: chain.slice(1) });

/** `length` cells in a row from `from`, stepping by `dx`: a worm lying straight. */
const straight = (from: Cell, dx: number, length = WORM_LENGTH): Cell[] =>
  Array.from({ length }, (_, i) => ({ x: from.x + dx * i, y: from.y }));

/** The caves' own walker (ghouls) and turret (crystal turrets), from floor 2's theme. */
const caveWalkers = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: themeForFloor(1).walker, cell }));
const caveTurret = (cell: Cell): EnemySpawn => ({ type: themeForFloor(1).turret, cell });

/** Point-mirror through the room centre: where the second of a pair of worms lies. */
const opposite = (c: Cell, width: number, height: number): Cell => ({ x: width - 1 - c.x, y: height - 1 - c.y });

/**
 * Floor 2: a stone block fills the middle, leaving a loop of floor around it for worms to run
 * laps on. They start on opposite straights, heading the same way round.
 */
const track: Archetype = {
  id: 'track',
  floor: 1,
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
    const first = straight({ x: 4, y: rng.pick([0, 1]) }, -1);
    const worms = [first];
    if (rng.next() < 0.6) worms.push(first.map((c) => opposite(c, width, height)));
    return { tiles: canvas.tiles, enemies: worms.map(worm), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2: two jars facing each other across the middle of the room. One holds ghouls, the
 * other a worm; both spill into the same narrow gap between them.
 */
const twinJars: Archetype = {
  id: 'twinJars',
  floor: 1,
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const left = sideJar('left', 1);
    const right = sideJar('right', 1);
    const canvas = new Canvas(width, height, []);
    canvas.paint([...jarWall(left), ...jarWall(right)], 'obstacle');
    canvas.paint([left.openings.right, right.openings.left], 'floor');
    const [hordeJar, wormJar] = rng.next() < 0.5 ? [left, right] : [right, left];
    const horde = shuffled(jarInside(hordeJar), rng).slice(0, rng.int(3, 4));
    // An L through the jar's 2x3 inside: down one column, then across the bottom.
    const [a, b] = [wormJar.x0 + 1, wormJar.x0 + 2];
    const coiled = rng.next() < 0.5
      ? [{ x: a, y: 2 }, { x: a, y: 3 }, { x: a, y: 4 }, { x: b, y: 4 }]
      : [{ x: b, y: 2 }, { x: b, y: 3 }, { x: b, y: 4 }, { x: a, y: 4 }];
    return { tiles: canvas.tiles, enemies: [...caveWalkers(horde), worm(coiled)], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2: a firing line of crystal turrets along one wall, behind a moat of holes, facing open
 * floor with a few rocks to duck behind (which the turrets slowly force you out of). Their shots
 * ricochet off the stone walls, so the far wall is no refuge. The line sits on a wall with no door.
 */
const gallery: Archetype = {
  id: 'gallery',
  floor: 1,
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
    return { tiles: canvas.tiles, enemies: turrets, pickups: [], symmetry: { axes } };
  },
};

/** Floor 2: a grid of pillars with worms threading between them. */
const serpentGarden: Archetype = {
  id: 'serpentGarden',
  floor: 1,
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const cols = rng.pick([[2, 4, 6], [3, 5]]);
    canvas.paint(cols.map((x) => ({ x, y: 2 })), rng.next() < 0.3 ? 'rock' : 'obstacle');
    const first = straight({ x: 4, y: 1 }, -1);
    const second = rng.next() < 0.5 ? first.map((c) => opposite(c, width, height)) : first.map((c) => ({ x: width - 1 - c.x, y: c.y }));
    return { tiles: canvas.tiles, enemies: [worm(first), worm(second)], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 2 breather: an open courtyard framed by stone in its corners, three ghouls milling
 * about the middle. Nothing touches a door approach, so it fits every door set.
 */
const courtyard: Archetype = {
  id: 'courtyard',
  floor: 1,
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
 * with a rock and a crystal turret standing guard on either side.
 */
const vault: Archetype = {
  id: 'vault',
  floor: 1,
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
    return { tiles: canvas.tiles, enemies: turrets, pickups: [{ type: 'lockedChest', cell: at({ x: 6, y: 0 }) }], symmetry: { axes } };
  },
};

/** The dungeon's walker (its tougher zombie) and turret (the gargoyle), from its theme. */
const dungeonWalkers = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: themeForFloor(2).walker, cell }));
const dungeonTurrets = (cells: Cell[]): EnemySpawn[] => cells.map((cell) => ({ type: themeForFloor(2).turret, cell }));

/**
 * Floor 3: a stone keep in the middle with gargoyles inside, firing out through arrow slits
 * (holes: shots pass, feet don't). Zombies patrol the grounds around it.
 */
const fortress: Archetype = {
  id: 'fortress',
  floor: 2,
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
    return { tiles: canvas.tiles, enemies: [...turrets, ...dungeonWalkers(patrol)], pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 3: the floor has fallen away except for a cross of narrow walkways joining the doors.
 * Gargoyles on the far corners rake whoever is out on the cross.
 */
const killbox: Archetype = {
  id: 'killbox',
  floor: 2,
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
    return {
      tiles: canvas.tiles,
      enemies: dungeonTurrets(chosen),
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
 */
const crossfire: Archetype = {
  id: 'crossfire',
  floor: 2,
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
    return { tiles: canvas.tiles, enemies: turrets, pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 3 breather: broken rock walls, mirrored into every corner, with a pair of zombies
 * shambling around them. Nothing touches a door approach, so it fits every door set.
 */
const ruins: Archetype = {
  id: 'ruins',
  floor: 2,
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
    return { tiles: canvas.tiles, enemies: dungeonWalkers([first, second]), pickups: [], symmetry: { axes } };
  },
};

/**
 * Floor 3 puzzle: a chest buried in the middle of a dense field of rocks, with gargoyles
 * covering it; digging in means standing still under fire (or spending a bomb).
 */
const minefield: Archetype = {
  id: 'minefield',
  floor: 2,
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
    return { tiles: canvas.tiles, enemies: turrets, pickups: [{ type: 'chest', cell: { x: 6, y: 3 } }], symmetry: { axes } };
  },
};

/** The item on show, in the middle of the room where every showcase frames it. */
const showpiece = (width: number, height: number, rng: Rng): PickupSpawn => ({
  type: 'passive',
  cell: { x: (width - 1) / 2, y: (height - 1) / 2 },
  passive: rng.pick(PASSIVE_POOL),
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
    return { tiles: canvas.tiles, enemies: [], pickups: [showpiece(width, height, rng)], symmetry: { axes } };
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
    return { tiles: canvas.tiles, enemies: [], pickups: [showpiece(width, height, rng)], symmetry: { axes } };
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
    return { tiles: canvas.tiles, enemies: [], pickups: [showpiece(width, height, rng)], symmetry: { axes } };
  },
};

/**
 * Floor 1: thorn hedges wind through the room, mirrored into all four quadrants, with goblins
 * loose in the lanes between them. The hedges never seal floor away or touch a door approach,
 * so it fits every door set; shots fly over them, so the fight is about luring walkers into
 * the thorns while not brushing against them yourself.
 */
const thornMaze: Archetype = {
  id: 'thornMaze',
  floor: 0,
  kind: 'normal',
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // Each layout is a top-left quarter of hedge plus a lane cell a goblin prowls.
    const layout = rng.pick([
      // Hedgerows: an L in each corner, lanes along the walls and through the middle.
      { hedge: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 2 }], lane: { x: 3, y: 2 } },
      // Crossed hedges: a stub off the wall meets a post, leaving a crooked lane.
      { hedge: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }], lane: { x: 3, y: 1 } },
      // Zigzag: staggered hedges the walkers have to snake through.
      { hedge: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 1 }], lane: { x: 2, y: 2 } },
    ]);
    canvas.paint(layout.hedge, 'thorn');
    // Sometimes a bush in each corner nook as well.
    if (rng.next() < 0.5) canvas.paint([{ x: 0, y: 1 }], 'thorn');
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

/**
 * Wide room, every floor: run the gauntlet down a long hall. The floor's turrets line ledges
 * along the top and bottom walls behind a moat of holes, a pack of its walkers holds the middle,
 * and scattered cover breaks up the lane. Door columns and the side doors' row stay clear, so
 * it fits every door set.
 */
const gauntlet = (floor: number): Archetype => ({
  id: `gauntlet${floor + 1}`,
  floor,
  kind: 'normal',
  shapes: ['2x1'],
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // The ledge spans the middle of each long wall, sealed at its ends; doors sit at x 5 and 20.
    const ledgeEnd = rng.int(8, 9);
    canvas.paint(
      [{ x: ledgeEnd, y: 0 }, ...Array.from({ length: 13 - ledgeEnd }, (_, i) => ({ x: ledgeEnd + i, y: 1 }))],
      'hole',
    );
    const cover = rng.pick([
      [{ x: 3, y: 2 }],
      [{ x: 2, y: 2 }, { x: 8, y: 3 }],
      [{ x: 7, y: 2 }],
      [{ x: 3, y: 2 }, { x: 10, y: 3 }],
    ]);
    canvas.paint(cover, rng.next() < 0.5 ? 'rock' : 'obstacle');
    const post = { x: rng.int(ledgeEnd + 2, 12), y: 0 };
    const posts = canvas.images(post);
    // Both ledges manned, or only the top one.
    const manned = rng.next() < 0.5 ? posts : posts.filter((c) => c.y === 0);
    const pack = canvas.images(rng.pick([{ x: 12, y: 3 }, { x: 12, y: 2 }, { x: 11, y: 3 }]));
    return {
      tiles: canvas.tiles,
      enemies: [
        ...turretsOf(floor, manned),
        ...walkersOf(floor, pack),
      ],
      pickups: [],
      symmetry: { axes },
    };
  },
});

/**
 * Tall room, every floor: a descent down three terraces. Two drops of holes cross the room,
 * crossed only at stairs (the gaps), with the floor's walkers waiting on the landing between
 * and its turrets covering the stairs from the corners. Doors sit on the terraces, clear of the
 * drops, so it fits every door set.
 */
const descent = (floor: number): Archetype => ({
  id: `descent${floor + 1}`,
  floor,
  kind: 'normal',
  shapes: ['1x2'],
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // Drops on rows 4 and 9 (mirror images); stairs in the middle or down both sides.
    const centreStairs = rng.next() < 0.5;
    const drop = centreStairs ? [0, 1, 2, 3, 4] : [2, 3, 4, 5, 6];
    canvas.paint(drop.map((x) => ({ x, y: 4 })), 'hole');
    if (rng.next() < 0.5) canvas.paint([{ x: rng.int(3, 4), y: 2 }], rng.next() < 0.5 ? 'rock' : 'obstacle');
    const landing = canvas.images(centreStairs ? rng.pick([{ x: 2, y: 6 }, { x: 3, y: 6 }]) : rng.pick([{ x: 5, y: 6 }, { x: 4, y: 6 }]));
    const walkers = rng.next() < 0.5 ? landing : [landing[0], landing[landing.length - 1]];
    const corners = canvas.images({ x: rng.pick([0, 1]), y: 0 });
    const turrets = rng.next() < 0.5 ? corners : [corners[0], corners[corners.length - 1]];
    return {
      tiles: canvas.tiles,
      enemies: [
        ...turretsOf(floor, turrets),
        ...walkersOf(floor, walkers),
      ],
      pickups: [],
      symmetry: { axes },
    };
  },
});

/**
 * Big room, every floor: an arena for a set-piece battle. A pit (or a stone dais) fills the
 * middle, pillars ring it, a pack of the floor's walkers circles the ring and its turrets hold
 * the corners. Painted as one quarter mirrored into all four; the door columns (5, 20) and rows
 * (2, 11) stay clear, so it fits every door set.
 */
const arena = (floor: number): Archetype => ({
  id: `arena${floor + 1}`,
  floor,
  kind: 'normal',
  shapes: ['2x2'],
  fits: fitsAll,
  build({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    // The centre piece, as its top-left quarter around the middle (12..13, 6..7).
    const centre = rng.pick([
      [{ x: 11, y: 6 }, { x: 12, y: 6 }, { x: 12, y: 5 }],
      [{ x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }, { x: 11, y: 5 }, { x: 12, y: 5 }],
      [{ x: 12, y: 6 }],
    ]);
    canvas.paint(centre, rng.next() < 0.7 ? 'hole' : 'obstacle');
    const pillars = rng.pick([[{ x: 7, y: 3 }], [{ x: 6, y: 2 }, { x: 6, y: 4 }], [{ x: 8, y: 2 }], [{ x: 7, y: 3 }, { x: 10, y: 2 }]]);
    canvas.paint(pillars, rng.next() < 0.5 ? 'rock' : 'obstacle');
    const blocked = new Set([...centre, ...pillars].map((c) => `${c.x},${c.y}`));
    const spots = shuffled([{ x: 9, y: 4 }, { x: 4, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 1 }], rng).filter((c) => !blocked.has(`${c.x},${c.y}`));
    const pack = canvas.images(spots[0]);
    // A second wave on a diagonal pair, sometimes.
    if (rng.next() < 0.5) {
      const second = canvas.images(spots[1]);
      pack.push(second[0], second[second.length - 1]);
    }
    const corners = canvas.images(rng.pick([{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 5 }]));
    const turrets = rng.next() < 0.5 ? corners : [corners[0], corners[corners.length - 1]];
    return {
      tiles: canvas.tiles,
      enemies: [...turretsOf(floor, turrets), ...walkersOf(floor, pack)],
      pickups: [],
      symmetry: { axes },
    };
  },
});

/**
 * L room, every floor: an ambush around the corner. Blinds of stone or rock stand where the
 * arms meet, and a pack of the floor's walkers waits in each arm's far end, pressed against the
 * missing corner, out of sight of the other arm; a turret may hold the elbow's outer corner.
 * Painted as one quarter mirrored into all four (the missing one is walled off afterwards), so
 * each arm mirrors along its length and every orientation of the L is drawn alike. Door columns
 * (5, 20) and rows (2, 11) stay clear, so it fits every door set.
 */
const ambush = (floor: number): Archetype => ({
  id: `ambush${floor + 1}`,
  floor,
  kind: 'normal',
  shapes: L_SHAPES,
  fits: fitsAll,
  build({ width, height, rng, shape }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas(width, height, axes);
    const blind = rng.pick([
      [{ x: 10, y: 4 }, { x: 11, y: 4 }, { x: 10, y: 5 }, { x: 11, y: 5 }],
      [{ x: 10, y: 3 }, { x: 10, y: 4 }, { x: 10, y: 5 }],
      [{ x: 9, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 4 }],
    ]);
    canvas.paint(blind, rng.next() < 0.5 ? 'rock' : 'obstacle');
    // Which quarter each image lands in: the elbow faces the missing cell across the room.
    const gap = (shape && missingCell(shape)) ?? { x: 1, y: 1 };
    const quarter = (c: Cell) => ({ x: c.x < width / 2 ? 0 : 1, y: c.y < height / 2 ? 0 : 1 });
    const isElbow = (c: Cell) => quarter(c).x !== gap.x && quarter(c).y !== gap.y;
    const inArmEnd = (c: Cell) => !isElbow(c) && (quarter(c).x !== gap.x || quarter(c).y !== gap.y);
    const lurks = shuffled([{ x: 8, y: 5 }, { x: 9, y: 6 }, { x: 7, y: 6 }], rng).slice(0, rng.int(1, 2));
    const pack = lurks.flatMap((c) => canvas.images(c)).filter(inArmEnd);
    const enemies = walkersOf(floor, pack);
    if (rng.next() < 0.6) enemies.push(...turretsOf(floor, canvas.images(rng.pick([{ x: 2, y: 0 }, { x: 1, y: 5 }])).filter(isElbow)));
    return { tiles: canvas.tiles, enemies, pickups: [], symmetry: { axes } };
  },
});

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
  ...[0, 1, 2].flatMap((floor) => [gauntlet(floor), descent(floor)]),
  ...[0, 1, 2].map(arena),
  ...[0, 1, 2].map(ambush),
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
}

/**
 * Picks an archetype for every room on a floor that has any, uniformly among those drawn for
 * its shape, fitting its doors and used fewer than twice. When every fitting idea is at the cap
 * (more rooms than the floor has ideas for), the least-used fitting ones are picked from instead.
 */
export function assignArchetypes(rooms: readonly RoomToAssign[], floorIndex: number, rng: Rng): Map<string, string> {
  const uses = new Map<string, number>();
  const assigned = new Map<string, string>();
  for (const room of rooms) {
    const fitting = archetypesFor(floorIndex, room.kind, room.shape ?? '1x1').filter((a) => a.fits(room.doors));
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
