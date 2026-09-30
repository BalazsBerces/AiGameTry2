import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { dressRoom, VARIANTS } from './dressing';
import { generateRoom, type Tile } from './roomGenerator';
import { roomThemeById } from './roomThemes';
import type { RoomShape } from '../map/floorGenerator';

/** Real rooms to dress: a 1x1 idea and a composed big room per floor, each in one of its themes. */
const ROOMS: { floor: number; theme: string; shape: RoomShape; archetype?: string }[] = [
  { floor: 0, theme: 'grove', shape: '1x1' as const, archetype: 'pillaredHall' },
  { floor: 0, theme: 'marsh', shape: '2x1' as const },
  { floor: 1, theme: 'hollow', shape: '1x2' as const },
  { floor: 1, theme: 'grotto', shape: '1x1' as const, archetype: 'crystalGallery' },
  { floor: 2, theme: 'crypt', shape: '2x2' as const },
  { floor: 2, theme: 'machineHall', shape: 'L-br' as const },
];
const tilesOf = (r: (typeof ROOMS)[number], seed: number): Tile[][] =>
  generateRoom({ id: '0,0', kind: 'normal', doors: ['up'], shape: r.shape, archetype: r.archetype, theme: r.theme }, r.floor, createRng(seed)).tiles;

describe('dressRoom decor', () => {
  it("scatters the theme's own decor over floor cells only, a handful in every room", () => {
    for (const r of ROOMS) {
      for (let seed = 0; seed < 10; seed++) {
        const tiles = tilesOf(r, seed);
        const { decor } = dressRoom({ tiles, theme: r.theme, rng: createRng(seed) });
        const kinds = roomThemeById(r.theme)!.decor.map((d) => d.id);
        expect(decor.length, r.theme).toBeGreaterThanOrEqual(3);
        for (const d of decor) {
          expect(tiles[d.cell.y][d.cell.x], `${r.theme} ${d.kind} at ${d.cell.x},${d.cell.y}`).toBe('floor');
          expect(kinds).toContain(d.kind);
        }
      }
    }
  });

  it('never touches the tiles, so it can never block anything', () => {
    for (const r of ROOMS) {
      const tiles = tilesOf(r, 3);
      const before = JSON.stringify(tiles);
      dressRoom({ tiles, theme: r.theme, rng: createRng(3) });
      expect(JSON.stringify(tiles)).toBe(before);
    }
  });

  it('gives the same decor for the same seed', () => {
    const tiles = tilesOf(ROOMS[1], 4);
    expect(dressRoom({ tiles, theme: 'marsh', rng: createRng(9) }).decor).toEqual(dressRoom({ tiles, theme: 'marsh', rng: createRng(9) }).decor);
  });
});

describe('dressRoom variants', () => {
  it('numbers every tile with a variant, stable for the same seed and varied across the room', () => {
    for (const r of ROOMS) {
      const tiles = tilesOf(r, 2);
      const { variants } = dressRoom({ tiles, theme: r.theme, rng: createRng(5) });
      expect(variants.length).toBe(tiles.length);
      variants.forEach((row, y) => {
        expect(row.length).toBe(tiles[y].length);
        for (const v of row) expect(v >= 0 && v < VARIANTS && Number.isInteger(v)).toBe(true);
      });
      expect(new Set(variants.flat()).size, r.theme).toBeGreaterThan(1);
      expect(dressRoom({ tiles, theme: r.theme, rng: createRng(5) }).variants).toEqual(variants);
    }
  });
});

describe('dressRoom regions', () => {
  /** `o` a hole (pond, pit or chasm), `#` stone, `.` floor. */
  const picture = (rows: string[]): Tile[][] => rows.map((row) => [...row].map((ch) => (ch === 'o' ? 'hole' : ch === '#' ? 'obstacle' : 'floor')));
  const cells = (region: { cells: { x: number; y: number }[] }) => region.cells.map((c) => `${c.x},${c.y}`).sort();

  it('groups exactly the connected holes, one region per pond', () => {
    const tiles = picture([
      'oo.....',
      'o...#oo',
      '.....o.',
      '..o....',
      '.o.....',
    ]);
    const { regions } = dressRoom({ tiles, theme: 'marsh', rng: createRng(1) });
    const found = regions.map(cells).sort((a, b) => a[0].localeCompare(b[0]));
    // Diagonal neighbours are separate ponds: shorelines run along edges, not corners.
    expect(found).toEqual([['0,0', '0,1', '1,0'], ['1,4'], ['2,3'], ['5,1', '5,2', '6,1']].map((r) => r.sort()));
    for (const region of regions) expect(region.tile).toBe('hole');
  });

  it('has no regions in a room without holes', () => {
    expect(dressRoom({ tiles: picture(['....', '.#..']), theme: 'grove', rng: createRng(1) }).regions).toEqual([]);
  });
});

describe('dressRoom wall style', () => {
  const crystals = (tiles: Tile[][]) => tiles.flat().filter((t) => t === 'crystal').length;
  const CAVES = [...ROOMS.filter((r) => r.floor === 1), { floor: 1, theme: 'grotto', shape: '2x1' as const }, { floor: 1, theme: 'rift', shape: '2x2' as const }];

  it('veins a caves room with 3 or more crystal tiles, and gives the rest rock strata', () => {
    const seen = new Set<string>();
    for (const r of CAVES) {
      for (let seed = 0; seed < 12; seed++) {
        const tiles = tilesOf(r, seed);
        const { wallStyle } = dressRoom({ tiles, theme: r.theme, rng: createRng(seed) });
        expect(wallStyle, `${r.theme} ${seed}: ${crystals(tiles)} crystals`).toBe(crystals(tiles) >= 3 ? 'veined' : 'strata');
        seen.add(wallStyle);
      }
    }
    // Real rooms come in both.
    expect([...seen].sort()).toEqual(['strata', 'veined']);
  });

  it('counts exactly: two crystals is strata, three is veined', () => {
    const picture = (rows: string[]): Tile[][] => rows.map((row) => [...row].map((ch) => (ch === 'c' ? 'crystal' : 'floor')));
    expect(dressRoom({ tiles: picture(['c...', '...c']), theme: 'grotto', rng: createRng(1) }).wallStyle).toBe('strata');
    expect(dressRoom({ tiles: picture(['c...', '.c.c']), theme: 'grotto', rng: createRng(1) }).wallStyle).toBe('veined');
  });

  it('is the same for the same layout, whatever the seed it is dressed with', () => {
    for (const r of CAVES) {
      const tiles = tilesOf(r, 6);
      const styles = new Set([1, 2, 3, 4].map((seed) => dressRoom({ tiles, theme: r.theme, rng: createRng(seed) }).wallStyle));
      expect(styles.size, r.theme).toBe(1);
    }
  });

  it('keeps forest rooms in their hedges, crystals or not', () => {
    for (const r of ROOMS.filter((r) => r.floor === 0)) {
      for (let seed = 0; seed < 5; seed++) expect(dressRoom({ tiles: tilesOf(r, seed), theme: r.theme, rng: createRng(seed) }).wallStyle).toBe('hedge');
    }
    expect(dressRoom({ tiles: [['crystal', 'crystal', 'crystal', 'crystal']], theme: 'grove', rng: createRng(1) }).wallStyle).toBe('hedge');
  });
});
