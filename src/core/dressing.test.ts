import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { dressRoom } from './dressing';
import { generateRoom, type Tile } from './roomGenerator';
import { roomThemeById } from './roomThemes';

/** Real rooms to dress: a 1x1 idea and a composed big room per floor, each in one of its themes. */
const ROOMS = [
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
