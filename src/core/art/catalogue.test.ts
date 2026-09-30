import { describe, expect, it } from 'vitest';
import { artCatalogue, doorKey, floorKey, wallKey, type DoorSide, type FloorKind } from './catalogue';
import { WALL_STYLES, type WallSide } from './terrain';

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
    const floors = FLOORS.flatMap((kind) => VARIANTS.map((v) => floorKey('caves', kind, v)));

    it('has strata and crystal-veined walls', () => {
      expect([...WALL_STYLES.caves]).toEqual(['strata', 'veined']);
    });

    it('holds walls in both styles for every side and variant, doors for every side open and locked, floors for every kind and variant', () => {
      for (const key of [...walls, ...doors, ...floors]) expect(byKey.has(key), key).toBe(true);
      expect(new Set([...walls, ...doors, ...floors]).size).toBe(2 * 5 * 4 + 4 * 2 + 3 * 4);
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
