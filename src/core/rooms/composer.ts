import { Canvas } from './archetypes';
import { L_SHAPES, missingCell, type Cell, type RoomShape } from '../map/floorGenerator';
import type { Rng } from '../rng';
import { outsideRoom, roomSize, WORM_LENGTH, type Door, type EnemySpawn, type EnemyType, type PickupSpawn, type Tile } from './roomGenerator';
import { roomThemeById, type Role } from './roomThemes';
import { nearDoor, validateRoom, type MirrorAxis, type Symmetry } from './roomValidator';
import { themeForFloor } from '../map/themes';

/**
 * Where an encounter may put someone: `perch` a post out of reach (for turrets), `open` the
 * open floor, `lurk` a spot tucked out of the way and `centre` the middle of the room.
 */
export type SpotTag = 'perch' | 'open' | 'lurk' | 'centre';

export interface Spot {
  cell: Cell;
  tag: SpotTag;
}

export interface LayoutContext {
  width: number;
  height: number;
  doors: Door[];
  rng: Rng;
  /** An L's missing cell is walled off after the draw, taking any spots there with it. */
  shape: RoomShape;
}

export interface LayoutDraw {
  /** roles[y][x]: what each cell is, before the room's theme turns roles into tiles. */
  roles: (Role | 'floor')[][];
  spots: Spot[];
  symmetry: Symmetry;
}

/** A big room's terrain, painted in roles and marked with tagged spawn spots; it knows nothing of who fights there. */
export interface Layout {
  id: string;
  shapes: readonly RoomShape[];
  draw(ctx: LayoutContext): LayoutDraw;
}

/** Who stands on a spot: the floor's walker or turret, or a named enemy (a worm lies in a straight line from its spot). */
export type Cast = 'walker' | 'turret' | EnemyType;

export interface Ask {
  tag: SpotTag;
  cast: Cast;
  /** How many, inclusive; fewer spots than `min` of the tag and the pairing can't host it. */
  count: [min: number, max: number];
  /**
   * A swarm: `count` flyers (never scaled by area) packed round one or two nests on spots of the
   * tag, filling the free floor outward from each nest, rather than one to a spot.
   */
  swarm?: boolean;
  /** Exactly `count` whatever the room's size (a big room grows its worm longer instead). */
  unscaled?: boolean;
}

/** A big room's fight: who stands where, asked for by spot tag so any layout can host it. */
export interface Encounter {
  id: string;
  asks: readonly Ask[];
  /** The only floor this fight appears on, for one built round that floor's own enemies; every floor if left out. */
  floor?: number;
}

/** One quarter's cells and their images across both axes. */
const mirrored = (canvas: Canvas<Role>, cells: Cell[], tag: SpotTag): Spot[] =>
  cells.flatMap((c) => canvas.images(c)).map((cell) => ({ cell, tag }));

/** A sketch's terrain letters: `#` stone, `%` breakable, `o` pit, `^` the theme's hazard, `*` its feature. */
const SKETCH_ROLES: Record<string, Role> = { '#': 'cover', '%': 'breakable', o: 'pit', '^': 'hazard', '*': 'feature' };
/** A sketch's spawn spots, on floor: `P` perch, `C` centre, `O` open, `L` lurk. */
const SKETCH_TAGS: Record<string, SpotTag> = { P: 'perch', C: 'centre', O: 'open', L: 'lurk' };

/**
 * Paints a top-left quarter, drawn as rows of sketch letters (`.` floor), mirrored into the whole
 * room, and returns its spots. `swap` turns a letter into another role (or floor) for a variant.
 */
function sketch(canvas: Canvas<Role>, quarter: readonly string[], swap: Partial<Record<string, Role | 'floor'>> = {}): Spot[] {
  const spots: Spot[] = [];
  quarter.forEach((row, y) =>
    [...row].forEach((letter, x) => {
      const role = letter in swap ? swap[letter] : SKETCH_ROLES[letter];
      if (role) canvas.paint([{ x, y }], role);
      if (SKETCH_TAGS[letter]) spots.push(...mirrored(canvas, [{ x, y }], SKETCH_TAGS[letter]));
    }),
  );
  return spots;
}

/** Stone or breakable, a coin flip: cover that may or may not be shot away. */
const coverOf = (rng: Rng, stone = 0.5): Role => (rng.next() < stone ? 'cover' : 'breakable');

/**
 * The gauntlet, a long hall: ledges along the top and bottom walls behind a moat of pits, with
 * cover and bushes breaking up the lane, and a walled pocket in the middle for the pack to hold.
 * Door columns (5, 20) and the side doors' row stay clear.
 */
const gauntlet: Layout = {
  id: 'gauntlet',
  shapes: ['2x1'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'LL.......oPPP',
      '..#.....ooooo',
      '.O.#.%..O..#C',
      '....O..#O...C',
    ], { '%': coverOf(rng, 0.3) });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The island hall: a ring of pits in the middle of the hall around a long island of turret posts
 * nobody can walk to, with lanes along both long walls broken up by cover (and sometimes the
 * theme's hazard). Nothing touches a door approach, so it fits every door set.
 */
const islandHall: Layout = {
  id: 'islandHall',
  shapes: ['2x1'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'LL.....#O....',
      '..#.^....#.CC',
      '...O...oooooo',
      '..%#...oPPPPP',
    ], { '%': coverOf(rng), '^': rng.next() < 0.6 ? 'hazard' : 'floor' });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The descent, a tall room down three terraces: two drops of pits cross the room, each crossed only
 * at two narrow stairs, with a landing between them and posts in the corners covering the stairs.
 * Doors sit on the terraces, clear of the drops.
 */
const descent: Layout = {
  id: 'descent',
  shapes: ['1x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'PP.....',
      '..#..#.',
      '....O..',
      '.%.#...',
      'oooo.oo',
      'L....C.',
      'L.O.#.C',
    ], { '%': coverOf(rng, 0.3) });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The arena, a big room for a set-piece battle: a pit (or a stone dais) fills the middle, pillars
 * ring it, a ring of open floor round it and posts in the corners. Painted as one quarter
 * mirrored into all four; the door columns (5, 20) and rows (2, 11) stay clear.
 */
const arena: Layout = {
  id: 'arena',
  shapes: ['2x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'LP..%....O...',
      '..P.....#....',
      '....L.#...#..',
      '.#..O...#..#.',
      '..#...#..O.C.',
      'P.O..%..O.ooo',
      '....L..#.Cooo',
    ], { o: rng.next() < 0.7 ? 'pit' : 'cover', '#': coverOf(rng, 0.6), '%': coverOf(rng, 0.3) });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The ambush, an L room: blinds of stone or rock stand where the arms meet, lurking spots wait in
 * each arm's far end, pressed against the missing corner and out of sight of the other arm, and
 * posts hold the elbow's outer corner. Painted as one quarter mirrored into all four (the missing
 * one is walled off afterwards), so every orientation of the L is drawn alike. Door columns
 * (5, 20) and rows (2, 11) stay clear.
 */
const ambush: Layout = {
  id: 'ambush',
  shapes: L_SHAPES,
  draw({ width, height, rng, shape }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const drawn = sketch(canvas, [
      'P.P......P.O.',
      '..#.....#....',
      '...%...#....%',
      '..O......#..C',
      '.#..#...L##..',
      '.P..#..L.##CO',
      '..O...L.L....',
    ], { '#': coverOf(rng, 0.6), '%': coverOf(rng, 0.3) });
    // Which quarter each image lands in: the elbow faces the missing cell across the room.
    const gap = missingCell(shape) ?? { x: 1, y: 1 };
    const quarter = (c: Cell) => ({ x: c.x < width / 2 ? 0 : 1, y: c.y < height / 2 ? 0 : 1 });
    const isElbow = (s: Spot) => quarter(s.cell).x !== gap.x && quarter(s.cell).y !== gap.y;
    const inArmEnd = (s: Spot) => !isElbow(s) && (quarter(s.cell).x !== gap.x || quarter(s.cell).y !== gap.y);
    const spots = drawn.filter((s) => (s.tag === 'lurk' ? inArmEnd(s) : s.tag === 'perch' ? isElbow(s) : true));
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The colonnade, a wide hall: two ranks of pillars run its length, meeting in a block at the
 * centre, leaving a lane down the middle and aisles along the walls, with posts in the aisles and
 * the theme's hazard now and then. Door columns (5, 20) and the side doors' row stay clear.
 */
const colonnade: Layout = {
  id: 'colonnade',
  shapes: ['2x1'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'LLO......^...',
      '...P...P...P.',
      '..#..#..#..##',
      '...O..OC..C.C',
    ], { '#': coverOf(rng, 0.6) });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The cloister, a tall room round a big centre block (or sunken pit): a ring of corridor runs all
 * the way round it, with pillars in the walks. Doors sit mid-wall, clear of the block.
 */
const cloister: Layout = {
  id: 'cloister',
  shapes: ['1x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // `B` is the centre block: mostly solid stone, sometimes a sunken pit.
    // prettier-ignore
    const spots = sketch(canvas, [
      'LP.....',
      '...O...',
      '..#....',
      '...C..C',
      'P.#.BBB',
      'L...BBB',
      'L.%OBBB',
    ], { B: rng.next() < 0.7 ? 'cover' : 'pit', '%': rng.next() < 0.5 ? 'breakable' : 'hazard' });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The crossing, a tall room split across the middle by a chasm with one wide bridge over it,
 * posts on both banks covering it: whoever holds the far side holds the bridge. Doors sit well
 * clear of the drop.
 */
const crossing: Layout = {
  id: 'crossing',
  shapes: ['1x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'LL.....',
      '..#....',
      '....O..',
      '.#..%..',
      '.O..#..',
      'PP..^CC',
      'ooooo..',
    ], { '%': coverOf(rng, 0.3), '^': rng.next() < 0.6 ? 'hazard' : 'floor' });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The pond garden, a big room of four pools set round a centre stone, with open lawns between
 * them. Painted as one quarter mirrored into all four; door columns (5, 20) and rows (2, 11) stay clear.
 */
const pondGarden: Layout = {
  id: 'pondGarden',
  shapes: ['2x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'L........OP..',
      '.L..#...#...P',
      '......ooo.^..',
      '.#.O.#ooo.#..',
      '..P....oo.O..',
      '.^..O.#...#C.',
      'L.........C**',
    ], { '*': rng.next() < 0.5 ? 'cover' : 'feature', '^': rng.next() < 0.7 ? 'hazard' : 'floor' });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The cross hall, a big room quartered by broken walls: stubs reach in from the middle of every
 * wall, leaving a gap round the centre, so each quarter is its own pocket joined to the others.
 * Door columns (5, 20) and rows (2, 11) stay clear.
 */
const crossHall: Layout = {
  id: 'crossHall',
  shapes: ['2x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'L........L.P#',
      '..#........P#',
      '..%..O...%..#',
      '..O.....#...%',
      '......#..O...',
      'P..%.......#C',
      '####...O...C.',
    ], { '%': coverOf(rng, 0.3) });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The bastion, an L room whose elbow is held by a block of stone ringed by pillars, with pits
 * breaking up each arm. Painted as one quarter mirrored into all four (the missing one is walled
 * off afterwards). Door columns (5, 20) and rows (2, 11) stay clear.
 */
const bastion: Layout = {
  id: 'bastion',
  shapes: L_SHAPES,
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'LP.......O...',
      '....#........',
      '...oo...#..%.',
      '..O.o......C.',
      'P..#...%..#..',
      '...O....C.###',
      'L....#....###',
    ], { '%': coverOf(rng, 0.3) });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The pond corner, an L room with a wide pool filling its elbow: the fight runs round its shore
 * from one arm to the other, with cover dotted along each arm. Painted as one quarter mirrored
 * into all four (the missing one is walled off afterwards). Door columns (5, 20) and rows (2, 11)
 * stay clear.
 */
const pondCorner: Layout = {
  id: 'pondCorner',
  shapes: L_SHAPES,
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // prettier-ignore
    const spots = sketch(canvas, [
      'L..P.....O...',
      '..#.....#....',
      '....#....%...',
      '...O....#..C.',
      '.P.....O..ooo',
      '..#....C.oooo',
      'L...#....oooo',
    ], { '#': coverOf(rng, 0.6), '%': coverOf(rng, 0.3) });
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/** The floor's turrets hold the perches while a pack of its walkers holds the middle. */
const ledgeSentries: Encounter = {
  id: 'ledgeSentries',
  asks: [
    { tag: 'perch', cast: 'turret', count: [2, 4] },
    { tag: 'centre', cast: 'walker', count: [2, 4] },
  ],
};

/** No turrets: the floor's walkers wait tucked in the corners and a few more roam the open floor. */
const prowlers: Encounter = {
  id: 'prowlers',
  asks: [
    { tag: 'lurk', cast: 'walker', count: [2, 4] },
    { tag: 'open', cast: 'walker', count: [1, 2] },
  ],
};

/** A set-piece battle: a pack of the floor's walkers roams the open floor while its turrets hold the posts. */
const siege: Encounter = {
  id: 'siege',
  asks: [
    { tag: 'open', cast: 'walker', count: [2, 5] },
    { tag: 'perch', cast: 'turret', count: [2, 4] },
  ],
};

/** An ambush: walkers wait tucked out of sight, and a turret may watch from a post. */
const ambushPack: Encounter = {
  id: 'ambush',
  asks: [
    { tag: 'lurk', cast: 'walker', count: [2, 4] },
    { tag: 'perch', cast: 'turret', count: [0, 1] },
  ],
};

export const LAYOUTS: readonly Layout[] = [
  gauntlet,
  islandHall,
  colonnade,
  descent,
  cloister,
  crossing,
  arena,
  pondGarden,
  crossHall,
  ambush,
  bastion,
  pondCorner,
];

/** True if normal rooms of this shape are composed (rather than built from an archetype). */
export const composes = (shape: RoomShape) => LAYOUTS.some((l) => l.shapes.includes(shape));
/** Floor 1: a wasp swarm (or two) hangs off the posts, with goblins on the ground. */
const waspSwarm: Encounter = {
  id: 'waspSwarm',
  floor: 0,
  asks: [
    { tag: 'perch', cast: 'wasp', count: [8, 12], swarm: true },
    { tag: 'open', cast: 'walker', count: [0, 2] },
  ],
};

/** Floor 1: boars across the open floor, charging whoever crosses it, goblins backing them up. */
const boarCharge: Encounter = {
  id: 'boarCharge',
  floor: 0,
  asks: [
    { tag: 'open', cast: 'boar', count: [2, 2] },
    { tag: 'lurk', cast: 'walker', count: [0, 2] },
  ],
};

/** Floor 2: a bat colony (or two) roosting in the nooks, ghouls down below. */
const batColony: Encounter = {
  id: 'batColony',
  floor: 1,
  asks: [
    { tag: 'lurk', cast: 'bat', count: [8, 12], swarm: true },
    { tag: 'centre', cast: 'walker', count: [0, 2] },
  ],
};

/** Floor 2: one long worm stretched across the open floor, ghouls prowling round it. */
const wormNest: Encounter = {
  id: 'wormNest',
  floor: 1,
  asks: [
    { tag: 'open', cast: 'worm', count: [1, 1], unscaled: true },
    { tag: 'centre', cast: 'walker', count: [1, 2] },
  ],
};

/** Floor 2: big slimes wobble across the open floor, each one a crowd once split; a crystal turret may watch. */
const slimePit: Encounter = {
  id: 'slimePit',
  floor: 1,
  asks: [
    { tag: 'open', cast: 'slime', count: [3, 4] },
    { tag: 'perch', cast: 'turret', count: [0, 1] },
  ],
};

/** Floor 3: shielded knights hold the middle while gargoyles watch from the posts. */
const knightPatrol: Encounter = {
  id: 'knightPatrol',
  floor: 2,
  asks: [
    { tag: 'centre', cast: 'knight', count: [2, 3] },
    { tag: 'perch', cast: 'turret', count: [0, 2] },
  ],
};

/** Floor 3: ghosts drift out of the nooks while zombies shamble through the open. */
const haunting: Encounter = {
  id: 'haunting',
  floor: 2,
  asks: [
    { tag: 'lurk', cast: 'ghost', count: [2, 3] },
    { tag: 'open', cast: 'walker', count: [1, 2] },
  ],
};

export const ENCOUNTERS: readonly Encounter[] = [
  ledgeSentries,
  prowlers,
  siege,
  ambushPack,
  waspSwarm,
  boarCharge,
  batColony,
  wormNest,
  slimePit,
  knightPatrol,
  haunting,
];

/** Layouts drawn for a big shape (on every floor: the floor's themes reskin them). */
export const layoutsFor = (shape: RoomShape) => LAYOUTS.filter((l) => l.shapes.includes(shape));

/** The fights a floor's big rooms can hold: the shared ones and its own. */
export const encountersFor = (floorIndex: number) => ENCOUNTERS.filter((e) => e.floor === undefined || e.floor === floorIndex);

export interface ComposeRequest {
  shape: RoomShape;
  doors: Door[];
  /** The room's sub-theme id (core/roomThemes). */
  theme: string;
  floorIndex: number;
  rng: Rng;
  /** Force a layout or an encounter by id, rather than rolling one. */
  layout?: string;
  encounter?: string;
}

export interface Composition {
  tiles: Tile[][];
  enemies: EnemySpawn[];
  pickups: PickupSpawn[];
  symmetry: Symmetry;
  /** The layout's spawn spots left on floor, taken or not. */
  spots: Spot[];
  layout: string;
  encounter: string;
}

export const MAX_COMPOSE_ATTEMPTS = 40;

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function weightedPick<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T {
  let roll = rng.next() * items.reduce((sum, item) => sum + weight(item), 0);
  return items.find((item) => (roll -= weight(item)) < 0) ?? items[items.length - 1];
}

const key = (c: Cell) => `${c.x},${c.y}`;

/** How long a worm grows in a big room of each shape: the more room, the longer. */
export const wormLength = (shape: RoomShape) => (shape === '2x2' ? 8 : shape.startsWith('L') ? 7 : shape === '1x1' ? WORM_LENGTH : 6);

/**
 * A worm's body behind a head on `head`: a straight run of free floor off in some direction,
 * clear of every cell already taken; undefined if there's no room for one.
 */
function wormTail(head: Cell, length: number, tiles: Tile[][], taken: Set<string>, doors: Door[], rng: Rng): Cell[] | undefined {
  for (const [dx, dy] of shuffled([[1, 0], [-1, 0], [0, 1], [0, -1]], rng)) {
    const tail = Array.from({ length: length - 1 }, (_, i) => ({ x: head.x + dx * (i + 1), y: head.y + dy * (i + 1) }));
    if (tail.some((c) => nearDoor(doors, c))) continue;
    if (tail.every((c) => tiles[c.y]?.[c.x] === 'floor' && !taken.has(key(c)))) return tail;
  }
  return undefined;
}

/** How many times over an encounter's asks a big room of each shape holds: more room, more enemies. */
export const AREA_SCALE: Partial<Record<RoomShape, number>> = { '2x1': 1.5, '1x2': 1.5, '2x2': 2.5 };
const L_SCALE = 2;

/** An ask's count range scaled to the room's shape. */
export function scaleCount([min, max]: readonly [number, number], shape: RoomShape): [number, number] {
  const scale = AREA_SCALE[shape] ?? (shape.startsWith('L') ? L_SCALE : 1);
  return [Math.round(min * scale), Math.round(max * scale)];
}

const EIGHT_WAY = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** How far from its nest a swarm may pack, in tiles (8-way). */
export const SWARM_RADIUS = 3;

/**
 * Up to `count` free floor cells packed round `nest`: breadth-first outward, 8-way, within
 * `SWARM_RADIUS`. Flyers cross pits, so the clump spreads over anything but wall to reach floor.
 */
function clump(nest: Cell, count: number, free: (c: Cell) => boolean, tiles: Tile[][]): Cell[] {
  const out: Cell[] = [];
  const seen = new Set([key(nest)]);
  const queue = [nest];
  while (queue.length && out.length < count) {
    const c = queue.shift()!;
    if (free(c)) out.push(c);
    for (const [dx, dy] of EIGHT_WAY) {
      const n = { x: c.x + dx, y: c.y + dy };
      const within = Math.max(Math.abs(n.x - nest.x), Math.abs(n.y - nest.y)) <= SWARM_RADIUS;
      const tile = tiles[n.y]?.[n.x];
      if (within && tile !== undefined && tile !== 'wall' && !seen.has(key(n))) {
        seen.add(key(n));
        queue.push(n);
      }
    }
  }
  return out;
}

/** The encounter's cast on free spots of the tags it asks for; undefined if a tag runs short. */
function cast(
  encounter: Encounter,
  spots: Spot[],
  tiles: Tile[][],
  doors: Door[],
  floorIndex: number,
  shape: RoomShape,
  rng: Rng,
): EnemySpawn[] | undefined {
  const floor = themeForFloor(floorIndex);
  const typeOf = (c: Cast): EnemyType => (c === 'walker' ? floor.walker : c === 'turret' ? floor.turret : c);
  const taken = new Set<string>();
  const take = (c: Cell) => taken.add(key(c));
  const enemies: EnemySpawn[] = [];
  for (const ask of encounter.asks) {
    if (ask.swarm) {
      const nests = shuffled(spots.filter((s) => s.tag === ask.tag && !taken.has(key(s.cell))), rng).slice(0, rng.int(1, 2));
      const wanted = rng.int(...ask.count);
      // Off the room's edge (bar the nest itself), which is left for the theme's dressing.
      const edge = (c: Cell) =>
        EIGHT_WAY.slice(0, 4).some(([dx, dy]) => (tiles[c.y + dy]?.[c.x + dx] ?? 'wall') === 'wall');
      const open = (c: Cell) => tiles[c.y]?.[c.x] === 'floor' && !taken.has(key(c)) && !nearDoor(doors, c);
      // Split between the nests (a lone nest takes them all); each packs its share round itself.
      const shares = nests.length === 1 ? [wanted] : [Math.ceil(wanted / 2), Math.floor(wanted / 2)];
      let placed = 0;
      nests.forEach(({ cell }, i) => {
        const packable = (c: Cell) => open(c) && (!edge(c) || key(c) === key(cell));
        for (const c of clump(cell, shares[i], packable, tiles)) {
          take(c);
          enemies.push({ type: typeOf(ask.cast), cell: c });
          placed++;
        }
      });
      if (placed < ask.count[0]) return undefined;
      continue;
    }
    const free = shuffled(spots.filter((s) => s.tag === ask.tag && !taken.has(key(s.cell))), rng);
    const count = ask.unscaled ? ask.count : scaleCount(ask.count, shape);
    const wanted = rng.int(...count);
    let placed = 0;
    for (const { cell } of free) {
      if (placed >= wanted || taken.has(key(cell))) continue;
      const type = typeOf(ask.cast);
      const tail = type === 'worm' ? wormTail(cell, wormLength(shape), tiles, taken, doors, rng) : undefined;
      if (type === 'worm' && !tail) continue;
      [cell, ...(tail ?? [])].forEach(take);
      enemies.push(tail ? { type, cell, tail } : { type, cell });
      placed++;
    }
    if (placed < count[0]) return undefined;
  }
  return enemies;
}

/**
 * A big normal room built from a layout drawn for its shape and an encounter (weighted by its
 * theme), with the theme turning the layout's roles into tiles. Rerolls until the room passes
 * validation; undefined if it never does (or nothing is drawn for the shape).
 */
export function composeRoom(req: ComposeRequest): Composition | undefined {
  const { width, height } = roomSize('normal', req.shape);
  const theme = roomThemeById(req.theme);
  const layouts = layoutsFor(req.shape).filter((l) => !req.layout || l.id === req.layout);
  const encounters = encountersFor(req.floorIndex).filter((e) => !req.encounter || e.id === req.encounter);
  if (!theme || !layouts.length || !encounters.length) return undefined;
  const { rng } = req;
  for (let attempt = 0; attempt < MAX_COMPOSE_ATTEMPTS; attempt++) {
    const layout = rng.pick(layouts);
    const encounter = weightedPick(encounters, (e) => theme.encounterWeights[e.id] ?? 1, rng);
    const drawn = layout.draw({ width, height, doors: req.doors, rng, shape: req.shape });
    const outside = outsideRoom(req.shape, width, height);
    const tiles = drawn.roles.map((row, y) =>
      row.map((r, x): Tile => (outside({ x, y }) ? 'wall' : r === 'floor' ? 'floor' : theme.roles[r])),
    );
    // Spots on terrain, or crowding a door, could never pass validation: drop them before casting.
    const spots = drawn.spots.filter((s) => tiles[s.cell.y][s.cell.x] === 'floor' && !nearDoor(req.doors, s.cell));
    const enemies = cast(encounter, spots, tiles, req.doors, req.floorIndex, req.shape, rng);
    if (!enemies) continue;
    const room = { tiles, enemies, pickups: [] as PickupSpawn[], symmetry: drawn.symmetry };
    if (validateRoom({ ...room, doors: req.doors }, room.symmetry).length === 0) {
      return { ...room, spots, layout: layout.id, encounter: encounter.id };
    }
  }
  return undefined;
}
