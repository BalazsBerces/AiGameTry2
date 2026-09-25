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

/**
 * The gauntlet, a long hall: ledges along the top and bottom walls behind a moat of pits, with
 * scattered cover breaking up the lane. Door columns (5, 20) and the side doors' row stay clear.
 */
const gauntlet: Layout = {
  id: 'gauntlet',
  shapes: ['2x1'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // The ledge spans the middle of each long wall, sealed at its ends.
    const ledgeEnd = rng.int(8, 9);
    canvas.paint([{ x: ledgeEnd, y: 0 }, ...Array.from({ length: 13 - ledgeEnd }, (_, i) => ({ x: ledgeEnd + i, y: 1 }))], 'pit');
    const cover = rng.pick([[{ x: 3, y: 2 }], [{ x: 2, y: 2 }, { x: 8, y: 3 }], [{ x: 7, y: 2 }], [{ x: 3, y: 2 }, { x: 10, y: 3 }]]);
    canvas.paint(cover, rng.next() < 0.5 ? 'breakable' : 'cover');
    const posts = Array.from({ length: 11 - ledgeEnd }, (_, i) => ({ x: ledgeEnd + 2 + i, y: 0 }));
    const spots = [
      ...mirrored(canvas, posts, 'perch'),
      ...mirrored(canvas, [{ x: 12, y: 3 }, { x: 12, y: 2 }, { x: 11, y: 3 }], 'centre'),
      ...mirrored(canvas, [{ x: 5, y: 3 }, { x: 8, y: 2 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 'lurk'),
    ];
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The island hall: a ring of pits in the middle of the hall around an island nobody can walk
 * to, with lanes along both long walls; cover (and sometimes the theme's hazard) breaks up the
 * ends. Nothing touches a door approach, so it fits every door set.
 */
const islandHall: Layout = {
  id: 'islandHall',
  shapes: ['2x1'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // A quarter of the ring: along row 2 to the middle, then down its end; the island is row 3 inside it.
    const from = rng.int(9, 10);
    canvas.paint([...Array.from({ length: 13 - from }, (_, i) => ({ x: from + i, y: 2 })), { x: from, y: 3 }], 'pit');
    canvas.paint(rng.pick([[{ x: 6, y: 1 }], [{ x: 6, y: 2 }], [{ x: 4, y: 2 }, { x: 7, y: 1 }]]), rng.next() < 0.5 ? 'breakable' : 'cover');
    if (rng.next() < 0.6) canvas.paint(rng.pick([[{ x: 3, y: 1 }], [{ x: 7, y: 3 }], [{ x: 3, y: 1 }, { x: 7, y: 3 }]]), 'hazard');
    const island = Array.from({ length: 12 - from }, (_, i) => ({ x: from + 1 + i, y: 3 }));
    const spots = [
      ...mirrored(canvas, island, 'perch'),
      ...mirrored(canvas, [{ x: 11, y: 1 }, { x: 12, y: 1 }], 'centre'),
      ...mirrored(canvas, [{ x: 4, y: 3 }, { x: 7, y: 0 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 0, y: 1 }], 'lurk'),
    ];
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The descent, a tall room down three terraces: two drops of pits cross the room, crossed only at
 * stairs (the gaps), with a landing between them and posts in the corners covering the stairs.
 * Doors sit on the terraces, clear of the drops.
 */
const descent: Layout = {
  id: 'descent',
  shapes: ['1x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // Drops on rows 4 and 9 (mirror images); stairs in the middle or down both sides.
    const centreStairs = rng.next() < 0.5;
    canvas.paint((centreStairs ? [0, 1, 2, 3, 4] : [2, 3, 4, 5, 6]).map((x) => ({ x, y: 4 })), 'pit');
    if (rng.next() < 0.5) canvas.paint([{ x: rng.int(3, 4), y: 2 }], rng.next() < 0.5 ? 'breakable' : 'cover');
    const landing = centreStairs ? [{ x: 2, y: 6 }, { x: 3, y: 6 }] : [{ x: 5, y: 6 }, { x: 4, y: 6 }];
    const spots = [
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 'perch'),
      ...mirrored(canvas, landing, 'centre'),
      ...mirrored(canvas, [{ x: 2, y: 2 }, { x: 5, y: 2 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 6 }, { x: 0, y: 5 }], 'lurk'),
    ];
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
    // The centre piece, as its top-left quarter around the middle (12..13, 6..7).
    const centre = rng.pick([
      [{ x: 11, y: 6 }, { x: 12, y: 6 }, { x: 12, y: 5 }],
      [{ x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }, { x: 11, y: 5 }, { x: 12, y: 5 }],
      [{ x: 12, y: 6 }],
    ]);
    canvas.paint(centre, rng.next() < 0.7 ? 'pit' : 'cover');
    const pillars = rng.pick([[{ x: 7, y: 3 }], [{ x: 6, y: 2 }, { x: 6, y: 4 }], [{ x: 8, y: 2 }], [{ x: 7, y: 3 }, { x: 10, y: 2 }]]);
    canvas.paint(pillars, rng.next() < 0.5 ? 'breakable' : 'cover');
    const spots = [
      ...mirrored(canvas, [{ x: 9, y: 4 }, { x: 4, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 1 }], 'open'),
      ...mirrored(canvas, [{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 5 }], 'perch'),
      ...mirrored(canvas, [{ x: 10, y: 4 }, { x: 12, y: 3 }], 'centre'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 3, y: 3 }], 'lurk'),
    ];
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
    const blind = rng.pick([
      [{ x: 10, y: 4 }, { x: 11, y: 4 }, { x: 10, y: 5 }, { x: 11, y: 5 }],
      [{ x: 10, y: 3 }, { x: 10, y: 4 }, { x: 10, y: 5 }],
      [{ x: 9, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 4 }],
    ]);
    canvas.paint(blind, rng.next() < 0.5 ? 'breakable' : 'cover');
    // Which quarter each image lands in: the elbow faces the missing cell across the room.
    const gap = missingCell(shape) ?? { x: 1, y: 1 };
    const quarter = (c: Cell) => ({ x: c.x < width / 2 ? 0 : 1, y: c.y < height / 2 ? 0 : 1 });
    const isElbow = (s: Spot) => quarter(s.cell).x !== gap.x && quarter(s.cell).y !== gap.y;
    const inArmEnd = (s: Spot) => !isElbow(s) && (quarter(s.cell).x !== gap.x || quarter(s.cell).y !== gap.y);
    const spots = [
      ...mirrored(canvas, [{ x: 8, y: 5 }, { x: 9, y: 6 }, { x: 7, y: 6 }], 'lurk').filter(inArmEnd),
      ...mirrored(canvas, [{ x: 2, y: 0 }, { x: 1, y: 5 }], 'perch').filter(isElbow),
      ...mirrored(canvas, [{ x: 4, y: 4 }, { x: 6, y: 2 }], 'open'),
      ...mirrored(canvas, [{ x: 12, y: 6 }, { x: 8, y: 3 }], 'centre'),
    ];
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The colonnade, a wide hall: two rows of pillars run its length, leaving a lane down the middle
 * and aisles along the walls, with posts between the pillars and the theme's hazard now and then
 * in the aisles. Door columns (5, 20) and the side doors' row stay clear.
 */
const colonnade: Layout = {
  id: 'colonnade',
  shapes: ['2x1'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    const pillars = rng.pick([[3, 7, 11], [2, 8, 11], [3, 9]]);
    canvas.paint(pillars.map((x) => ({ x, y: 2 })), rng.next() < 0.6 ? 'cover' : 'breakable');
    if (rng.next() < 0.5) canvas.paint([{ x: rng.pick([9, 10]), y: 0 }], 'hazard');
    const spots = [
      ...mirrored(canvas, [{ x: 7, y: 1 }, { x: 11, y: 1 }], 'perch'),
      ...mirrored(canvas, [{ x: 12, y: 3 }, { x: 10, y: 3 }], 'centre'),
      ...mirrored(canvas, [{ x: 5, y: 3 }, { x: 8, y: 3 }, { x: 9, y: 1 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 'lurk'),
    ];
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The cloister, a tall room round a solid centre block: a ring of corridor runs all the way round
 * it, with a pillar or two in the side walks. Doors sit mid-wall, clear of the block.
 */
const cloister: Layout = {
  id: 'cloister',
  shapes: ['1x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // The block's top-left quarter: 3 or 5 wide, 4 or 6 tall in all.
    const block = rng.pick([
      [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }],
      [{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }],
      [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }],
    ]);
    canvas.paint(block, rng.next() < 0.7 ? 'cover' : 'pit');
    if (rng.next() < 0.6) canvas.paint([{ x: 2, y: 4 }], rng.next() < 0.5 ? 'breakable' : 'hazard');
    const spots = [
      ...mirrored(canvas, [{ x: 1, y: 0 }, { x: 0, y: 5 }], 'perch'),
      ...mirrored(canvas, [{ x: 3, y: 6 }, { x: 6, y: 3 }], 'centre'),
      ...mirrored(canvas, [{ x: 3, y: 2 }, { x: 2, y: 6 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 0, y: 6 }], 'lurk'),
    ];
    return { roles: canvas.tiles, spots, symmetry: { axes } };
  },
};

/**
 * The crossing, a tall room split across the middle by a chasm with a bridge (or two) over it:
 * whoever holds the far side holds the bridge. Doors sit well clear of the drop.
 */
const crossing: Layout = {
  id: 'crossing',
  shapes: ['1x2'],
  draw({ width, height, rng }) {
    const axes: MirrorAxis[] = ['vertical', 'horizontal'];
    const canvas = new Canvas<Role>(width, height, axes);
    // The drop fills rows 6 and 7; one wide bridge in the middle, or two narrow ones at the sides.
    const drop = rng.next() < 0.5 ? [0, 1, 2, 3, 4] : [2, 3, 4, 5, 6];
    canvas.paint(drop.map((x) => ({ x, y: 6 })), 'pit');
    if (rng.next() < 0.5) canvas.paint([{ x: 3, y: 3 }], rng.next() < 0.5 ? 'cover' : 'breakable');
    const spots = [
      ...mirrored(canvas, [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 6, y: 4 }], 'perch'),
      ...mirrored(canvas, [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 1, y: 5 }], 'centre'),
      ...mirrored(canvas, [{ x: 4, y: 3 }, { x: 2, y: 4 }, { x: 5, y: 2 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 'lurk'),
    ];
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
    const pool = rng.pick([
      [{ x: 7, y: 3 }, { x: 8, y: 3 }, { x: 7, y: 4 }],
      [{ x: 7, y: 3 }, { x: 8, y: 3 }, { x: 7, y: 4 }, { x: 8, y: 4 }],
      [{ x: 8, y: 3 }, { x: 9, y: 3 }, { x: 9, y: 4 }],
    ]);
    canvas.paint(pool, 'pit');
    canvas.paint([{ x: 12, y: 6 }], rng.next() < 0.5 ? 'cover' : 'feature');
    if (rng.next() < 0.5) canvas.paint([{ x: 3, y: 5 }], 'hazard');
    const spots = [
      ...mirrored(canvas, [{ x: 10, y: 1 }, { x: 2, y: 4 }], 'perch'),
      ...mirrored(canvas, [{ x: 11, y: 6 }, { x: 12, y: 5 }], 'centre'),
      ...mirrored(canvas, [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 4, y: 3 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 1, y: 1 }], 'lurk'),
    ];
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
    const reach = rng.int(2, 3);
    // Down from the top wall in the middle columns, and in from the side walls in the middle rows.
    canvas.paint(Array.from({ length: reach }, (_, i) => ({ x: 12, y: i + 1 })), 'cover');
    canvas.paint(Array.from({ length: reach + 1 }, (_, i) => ({ x: i + 2, y: 6 })), rng.next() < 0.6 ? 'cover' : 'breakable');
    if (rng.next() < 0.5) canvas.paint([{ x: 8, y: 3 }], 'breakable');
    const spots = [
      ...mirrored(canvas, [{ x: 12, y: 0 }, { x: 0, y: 6 }], 'perch'),
      ...mirrored(canvas, [{ x: 10, y: 6 }, { x: 12, y: 5 }], 'centre'),
      ...mirrored(canvas, [{ x: 8, y: 5 }, { x: 3, y: 3 }, { x: 9, y: 2 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 'lurk'),
    ];
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
    canvas.paint(rng.pick([[{ x: 11, y: 5 }, { x: 12, y: 5 }, { x: 12, y: 4 }], [{ x: 12, y: 5 }, { x: 12, y: 6 }]]), 'cover');
    canvas.paint(rng.pick([[{ x: 4, y: 4 }, { x: 5, y: 4 }], [{ x: 8, y: 2 }], [{ x: 4, y: 4 }, { x: 8, y: 2 }]]), 'pit');
    if (rng.next() < 0.5) canvas.paint([{ x: 9, y: 5 }], 'breakable');
    const spots = [
      ...mirrored(canvas, [{ x: 1, y: 0 }, { x: 0, y: 4 }], 'perch'),
      ...mirrored(canvas, [{ x: 10, y: 6 }, { x: 12, y: 3 }], 'centre'),
      ...mirrored(canvas, [{ x: 6, y: 5 }, { x: 8, y: 4 }, { x: 3, y: 2 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 1, y: 6 }], 'lurk'),
    ];
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
    canvas.paint(rng.pick([
      [{ x: 11, y: 5 }, { x: 12, y: 5 }, { x: 11, y: 6 }, { x: 12, y: 6 }],
      [{ x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }, { x: 11, y: 5 }, { x: 12, y: 5 }, { x: 12, y: 4 }],
    ]), 'pit');
    canvas.paint(rng.pick([[{ x: 6, y: 3 }], [{ x: 4, y: 4 }, { x: 8, y: 2 }]]), rng.next() < 0.5 ? 'cover' : 'breakable');
    const spots = [
      ...mirrored(canvas, [{ x: 9, y: 4 }, { x: 3, y: 1 }], 'perch'),
      ...mirrored(canvas, [{ x: 9, y: 6 }, { x: 10, y: 4 }], 'centre'),
      ...mirrored(canvas, [{ x: 6, y: 5 }, { x: 8, y: 1 }, { x: 3, y: 4 }], 'open'),
      ...mirrored(canvas, [{ x: 0, y: 0 }, { x: 1, y: 6 }], 'lurk'),
    ];
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
/** Floor 1: a wasp swarm hangs off the posts and nooks, with a goblin or two on the ground. */
const waspSwarm: Encounter = {
  id: 'waspSwarm',
  floor: 0,
  asks: [
    { tag: 'perch', cast: 'wasp', count: [2, 3] },
    { tag: 'lurk', cast: 'wasp', count: [1, 2] },
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

/** Floor 2: a bat colony roosting in the nooks and on the posts, ghouls down below. */
const batColony: Encounter = {
  id: 'batColony',
  floor: 1,
  asks: [
    { tag: 'lurk', cast: 'bat', count: [2, 3] },
    { tag: 'perch', cast: 'bat', count: [1, 2] },
    { tag: 'centre', cast: 'walker', count: [0, 2] },
  ],
};

/** Floor 2: worms coiled in the open, a crystal turret keeping watch. */
const wormNest: Encounter = {
  id: 'wormNest',
  floor: 1,
  asks: [
    { tag: 'open', cast: 'worm', count: [1, 2] },
    { tag: 'perch', cast: 'turret', count: [0, 2] },
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

/**
 * A worm's body behind a head on `head`: a straight run of free floor off in some direction,
 * clear of every cell already taken; undefined if there's no room for one.
 */
function wormTail(head: Cell, tiles: Tile[][], taken: Set<string>, rng: Rng): Cell[] | undefined {
  for (const [dx, dy] of shuffled([[1, 0], [-1, 0], [0, 1], [0, -1]], rng)) {
    const tail = Array.from({ length: WORM_LENGTH - 1 }, (_, i) => ({ x: head.x + dx * (i + 1), y: head.y + dy * (i + 1) }));
    if (tail.every((c) => tiles[c.y]?.[c.x] === 'floor' && !taken.has(key(c)))) return tail;
  }
  return undefined;
}

/** The encounter's cast on free spots of the tags it asks for; undefined if a tag runs short. */
function cast(encounter: Encounter, spots: Spot[], tiles: Tile[][], floorIndex: number, rng: Rng): EnemySpawn[] | undefined {
  const floor = themeForFloor(floorIndex);
  const typeOf = (c: Cast): EnemyType => (c === 'walker' ? floor.walker : c === 'turret' ? floor.turret : c);
  const taken = new Set<string>();
  const take = (c: Cell) => taken.add(key(c));
  const enemies: EnemySpawn[] = [];
  for (const ask of encounter.asks) {
    const free = shuffled(spots.filter((s) => s.tag === ask.tag && !taken.has(key(s.cell))), rng);
    const wanted = rng.int(...ask.count);
    let placed = 0;
    for (const { cell } of free) {
      if (placed >= wanted || taken.has(key(cell))) continue;
      const type = typeOf(ask.cast);
      const tail = type === 'worm' ? wormTail(cell, tiles, taken, rng) : undefined;
      if (type === 'worm' && !tail) continue;
      [cell, ...(tail ?? [])].forEach(take);
      enemies.push(tail ? { type, cell, tail } : { type, cell });
      placed++;
    }
    if (placed < ask.count[0]) return undefined;
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
    const enemies = cast(encounter, spots, tiles, req.floorIndex, rng);
    if (!enemies) continue;
    const room = { tiles, enemies, pickups: [] as PickupSpawn[], symmetry: drawn.symmetry };
    if (validateRoom({ ...room, doors: req.doors }, room.symmetry).length === 0) {
      return { ...room, spots, layout: layout.id, encounter: encounter.id };
    }
  }
  return undefined;
}
