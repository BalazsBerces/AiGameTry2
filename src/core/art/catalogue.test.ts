import { describe, expect, it } from 'vitest';
import { artCatalogue, doorKey, floorKey, floorLook, groundKey, wallKey, type DoorSide, type FloorKind } from './catalogue';
import { CAVE_FLOOR_LOOKS, WALL_STYLES, type WallSide } from './terrain';

const SIDES: WallSide[] = ['top', 'bottom', 'left', 'right', 'corner'];
const DOORS: DoorSide[] = ['up', 'down', 'left', 'right'];
const FLOORS: FloorKind[] = ['normal', 'item', 'boss'];
const VARIANTS = [0, 1, 2, 3];

/** A short fingerprint of a text (FNV-1a), to tell whether drawings changed. */
const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};

const byKey =new Map(artCatalogue().map((e) => [e.key, e]));
const svgOf = (key: string) => {
  const entry = byKey.get(key);
  if (!entry) throw new Error(`no art for ${key}`);
  return entry.svg();
};

describe('the art catalogue', () => {
  it('gives every piece its own key', () => {
    const keys = artCatalogue().map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('picks a forest floor tile its variant, as before', () => {
    for (const v of VARIANTS) expect(floorLook('forest', v, 5, 3)).toBe(v);
  });

  it('keeps the forest room shell exactly as it was drawn', () => {
    const keys = [
      ...SIDES.flatMap((side) => VARIANTS.map((v) => wallKey('forest', side, v))),
      ...DOORS.flatMap((side) => [false, true].map((locked) => doorKey('forest', side, locked))),
      ...FLOORS.flatMap((kind) => VARIANTS.map((v) => floorKey('forest', kind, v))),
    ];
    // The fingerprint of the forest's walls, doors and floors before each floor got its own.
    expect(fnv(keys.map(svgOf).join('\n'))).toBe('490d0a0e');
  });

  describe('the caves room shell', () => {
    const walls = WALL_STYLES.caves.flatMap((style) => SIDES.flatMap((side) => VARIANTS.map((v) => wallKey('caves', side, v, style))));
    const doors = DOORS.flatMap((side) => [false, true].map((locked) => doorKey('caves', side, locked)));
    const floors = FLOORS.flatMap((kind) => Array.from({ length: CAVE_FLOOR_LOOKS }, (_, v) => floorKey('caves', kind, v)));

    it('has strata and crystal-veined walls', () => {
      expect([...WALL_STYLES.caves]).toEqual(['strata', 'veined']);
    });

    it('holds walls in both styles for every side and variant, doors for every side open and locked, floors for every kind and look', () => {
      for (const key of [...walls, ...doors, ...floors]) expect(byKey.has(key), key).toBe(true);
      expect(new Set([...walls, ...doors, ...floors]).size).toBe(2 * 5 * 4 + 4 * 2 + 3 * CAVE_FLOOR_LOOKS);
    });

    it('lays its floor marks over a paper ground of their own, one per room kind', () => {
      for (const kind of FLOORS) expect(byKey.has(groundKey('caves', kind)), kind).toBe(true);
      expect(byKey.has(groundKey('forest', 'normal'))).toBe(false);
    });

    it('picks each floor tile a look by its variant and where it lies, the same every time', () => {
      const looks = new Set<number>();
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 13; x++) {
          const look = floorLook('caves', (x + y) % 4, x, y);
          expect(look).toBe(floorLook('caves', (x + y) % 4, x, y));
          expect(byKey.has(floorKey('caves', 'normal', look))).toBe(true);
          looks.add(look);
        }
      }
      // A room's worth of tiles uses (nearly) every look, not just one per variant.
      expect(looks.size).toBeGreaterThan(8);
    });

    it('never lines floor looks up in rows or columns', () => {
      // Same variant everywhere, the worst case: neighbours should still match only by chance (1 in 12).
      let same = 0;
      let pairs = 0;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 16; x++) {
          const look = floorLook('caves', 2, x, y);
          if (x > 0) (pairs++, (same += +(look === floorLook('caves', 2, x - 1, y))));
          if (y > 0) (pairs++, (same += +(look === floorLook('caves', 2, x, y - 1))));
        }
      }
      expect(same / pairs).toBeLessThan(0.15);
    });

    it('draws its own art, not the forest\'s', () => {
      expect(svgOf(wallKey('caves', 'top', 0, 'strata'))).not.toBe(svgOf(wallKey('forest', 'top', 0)));
      expect(svgOf(wallKey('caves', 'top', 0, 'veined'))).not.toBe(svgOf(wallKey('caves', 'top', 0, 'strata')));
      expect(svgOf(doorKey('caves', 'up', true))).not.toBe(svgOf(doorKey('forest', 'up', true)));
      expect(svgOf(floorKey('caves', 'boss', 0))).not.toBe(svgOf(floorKey('forest', 'boss', 0)));
    });

    it('comes out the same when built twice', () => {
      for (const key of [...walls, ...doors, ...floors]) expect(svgOf(key), key).toBe(svgOf(key));
    });
  });
});
