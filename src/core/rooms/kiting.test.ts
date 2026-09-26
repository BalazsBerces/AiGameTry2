import { describe, expect, it } from 'vitest';
import { escapeRoutes, openTraps, trapPockets } from './kiting';
import type { Door, EnemySpawn, Tile } from './roomGenerator';

/** Rows of `.` floor, `#` stone, `%` rock, `o` hole, `W` wall. */
const grid = (rows: string[]): Tile[][] =>
  rows.map((r) => [...r].map((c) => ({ '.': 'floor', '#': 'obstacle', '%': 'rock', o: 'hole', W: 'wall' })[c] as Tile));
const door = (side: Door['side'], x: number, y: number): Door => ({ side, cell: { x, y } });
const size = (tiles: Tile[][], tile: Tile) => tiles.flat().filter((t) => t === tile).length;

// prettier-ignore
const CORNER_TRAPS = grid([
  '...#.#...',
  '##.#.#.##',
  '.........',
  '##.#.#.##',
  '...#.#...',
]);
const SIDE_DOORS = [door('left', 0, 2), door('right', 8, 2)];

describe('trapPockets', () => {
  it('finds nothing in an open room', () => {
    expect(trapPockets(grid(['.......', '.......', '.......']), [door('left', 0, 1)])).toEqual([]);
  });

  it('finds a corridor of three or more tiles behind a single one-tile way in', () => {
    // prettier-ignore
    const tiles = grid([
      '....#..',
      '###.#..',
      '.......',
      '.......',
    ]);
    const pockets = trapPockets(tiles, [door('left', 0, 2)]);
    expect(pockets).toHaveLength(1);
    expect(pockets[0].map((c) => `${c.x},${c.y}`).sort()).toEqual(['0,0', '1,0', '2,0', '3,0', '3,1'].sort());
  });

  it('lets a one- or two-tile nook be', () => {
    // A two-tile nook at the top of the middle column in each half; the corner pockets are the traps.
    const pockets = trapPockets(CORNER_TRAPS, SIDE_DOORS);
    expect(pockets).toHaveLength(4);
    for (const p of pockets) expect(p).toHaveLength(4);
  });

  it("leaves an enemy den's single opening alone", () => {
    // A pen whose only way out is the one-tile gap at (5,3).
    // prettier-ignore
    const tiles = grid([
      '........',
      '..####..',
      '..#..#..',
      '..#.....',
      '..####..',
    ]);
    expect(trapPockets(tiles, [door('left', 0, 0)])).toHaveLength(1);
    expect(trapPockets(tiles, [door('left', 0, 0)], [{ x: 3, y: 2 }])).toEqual([]);
  });
});

describe('openTraps', () => {
  it('opens the closed end of each trap so it loops round, mirroring every opening', () => {
    const opened = openTraps(CORNER_TRAPS, SIDE_DOORS, ['vertical', 'horizontal']);
    expect(opened).toBeDefined();
    expect(trapPockets(opened!, SIDE_DOORS)).toEqual([]);
    // Only barrier turned to floor, and only a little of it.
    const removed = size(CORNER_TRAPS, 'obstacle') - size(opened!, 'obstacle');
    expect(removed).toBeGreaterThan(0);
    expect(removed).toBeLessThanOrEqual(4);
    opened!.forEach((row, y) => row.forEach((t, x) => t !== CORNER_TRAPS[y][x] && expect(CORNER_TRAPS[y][x]).toBe('obstacle')));
    // Still mirrored both ways.
    for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) {
      expect(opened![y][x]).toBe(opened![y][8 - x]);
      expect(opened![y][x]).toBe(opened![4 - y][x]);
    }
  });

  it('never opens the room wall or a hole, and gives up when nothing else would do', () => {
    // prettier-ignore
    const tiles = grid([
      'WWoW.',
      '.....',
      'WoWW.',
      'WWWW.',
    ]);
    expect(trapPockets(tiles, [door('down', 4, 3)])).toHaveLength(1);
    expect(openTraps(tiles, [door('down', 4, 3)], [])).toBeUndefined();
  });

  it('leaves a room with no traps untouched', () => {
    const tiles = grid(['.......', '..#....', '.......']);
    expect(openTraps(tiles, [door('left', 0, 1)], [])).toEqual(tiles);
  });
});

describe('escapeRoutes', () => {
  const OPEN = grid(Array.from({ length: 7 }, () => '.............'));
  const LEFT = door('left', 0, 3);
  const goblins = (cells: [number, number][]): EnemySpawn[] => cells.map(([x, y]) => ({ type: 'goblin', cell: { x, y } }));

  it('counts every way in from the door as a way out of an empty room', () => {
    expect(escapeRoutes(OPEN, [LEFT], [])).toEqual([3]);
  });

  it('still leaves two ways out with a goblin waiting across the room', () => {
    expect(escapeRoutes(OPEN, [LEFT], goblins([[11, 3]]))[0]).toBeGreaterThanOrEqual(2);
  });

  it('closes the ways out that goblins beside the door would reach first', () => {
    expect(escapeRoutes(OPEN, [LEFT], goblins([[2, 1], [2, 5], [3, 3]]))[0]).toBeLessThan(2);
  });

  it('counts a way out only if it leads somewhere: a blind alley is no escape', () => {
    // prettier-ignore
    const tiles = grid([
      '.#...........',
      '.#...........',
      '.#...........',
      '.............',
      '.############',
      '.............',
      '.............',
    ]);
    // Up the left column is a three-tile dead end; along the middle row and down the column are real.
    expect(escapeRoutes(tiles, [LEFT], [])).toEqual([2]);
  });

  it('times flyers by straight-line distance, over holes', () => {
    // prettier-ignore
    const tiles = grid([
      '.............',
      '.............',
      '.............',
      '..ooooooooo..',
      '.............',
      '.............',
      '.............',
    ]);
    const wasps: EnemySpawn[] = [{ type: 'wasp', cell: { x: 3, y: 1 } }, { type: 'wasp', cell: { x: 3, y: 5 } }, { type: 'wasp', cell: { x: 2, y: 3 } }];
    expect(escapeRoutes(tiles, [LEFT], wasps)[0]).toBeLessThan(2);
  });
});
