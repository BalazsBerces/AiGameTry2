import { describe, expect, it } from 'vitest';
import { artCatalogue, charKey, decorKey, doorKey, floorKey, floorLook, groundKey, joinKey, tileKey, wallKey, type DoorSide, type FloorKind } from './catalogue';
import { CHARACTERS, type Action } from './characters';
import { CAVE_FLOOR_LOOKS, WALL_STYLES, type WallSide } from './terrain';
import { themeForFloor } from '../map/themes';
import { roomThemesFor } from '../rooms/roomThemes';

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

const byKey = new Map(artCatalogue().map((e) => [e.key, e]));
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

  describe('the caves terrain', () => {
    const MASKS = Array.from({ length: 16 }, (_, m) => m);
    // Every look the caves draw a tile with: the floor's own and each sub-theme's overrides.
    const caveArts = [
      ...Object.values(themeForFloor(1).looks).map((look) => look.art!),
      ...roomThemesFor(1).flatMap((theme) => Object.values(theme.looks ?? {}).map((look) => look.art!)),
    ];
    const fitted = ['chasm', 'rift'];
    const tiles = caveArts.flatMap((art) => VARIANTS.flatMap((v) => (fitted.includes(art) ? MASKS : [0]).map((m) => tileKey(art, v, m))));
    const joins = ['stalagmite', 'thorn vine'].flatMap((art) => (['across', 'down'] as const).map((d) => joinKey(art, d)));

    it("names art for every look, sub-themes' included", () => {
      expect([...caveArts].sort()).toEqual(
        ['boulder', 'chasm', 'crystal cluster', 'crystal spire', 'giant mushroom', 'glowshroom', 'loose rock', 'mushroom cap', 'rift', 'stalagmite', 'thorn vine'],
      );
    });

    it('holds every variant of each look, every neighbour mask of chasm and rift, and stalagmite and thorn-vine joins', () => {
      for (const key of [...tiles, ...joins]) expect(byKey.has(key), key).toBe(true);
      expect(new Set(tiles).size).toBe(9 * 4 + 2 * 4 * 16);
    });

    it('fits chasm and rift pieces to their neighbours: each mask a piece of its own', () => {
      for (const art of fitted) expect(new Set(MASKS.map((m) => svgOf(tileKey(art, 0, m)))).size, art).toBe(16);
      expect(svgOf(tileKey('rift', 0, 5))).not.toBe(svgOf(tileKey('chasm', 0, 5)));
    });

    it('comes out the same when built twice', () => {
      for (const key of [...tiles, ...joins]) expect(svgOf(key), key).toBe(svgOf(key));
    });
  });

  describe('the caves decor', () => {
    const kinds = [...new Set(roomThemesFor(1).flatMap((theme) => theme.decor.map((d) => d.id)))];
    const keys = kinds.flatMap((kind) => VARIANTS.map((v) => decorKey(kind, v)));

    it('scatters bones and a dropped miner\'s pick among the shards, spores and cracks', () => {
      expect([...kinds].sort()).toEqual(['bones', 'caps', 'cracks', 'dust', 'glints', 'moss', 'pebbles', 'pick', 'shards', 'spores']);
    });

    it('holds paper art for every variant of every kind, each a drawing of its own', () => {
      for (const key of keys) expect(byKey.has(key), key).toBe(true);
      const pebbles = svgOf(decorKey('pebbles', 0));
      for (const kind of kinds.filter((k) => k !== 'pebbles')) expect(svgOf(decorKey(kind, 0)), kind).not.toBe(pebbles);
      for (const kind of kinds) expect(new Set(VARIANTS.map((v) => svgOf(decorKey(kind, v)))).size, kind).toBe(4);
    });

    it('comes out the same when built twice', () => {
      for (const key of keys) expect(svgOf(key), key).toBe(svgOf(key));
    });
  });

  describe('the cave cast', () => {
    const CAST = { ghoul: { idle: 2, move: 4, attack: 3, hurt: 1, recover: 2 }, bat: { idle: 2, move: 4, attack: 3, hurt: 1 } };
    const keysOf = (kind: keyof typeof CAST, champion: boolean) =>
      (Object.entries(CAST[kind]) as [Action, number][]).flatMap(([action, count]) => Array.from({ length: count }, (_, f) => charKey(kind, action, f, 'side', champion)));

    it('stalks, winds up, lunges, recovers and flinches as a ghoul; flutters, telegraphs, swoops and flinches as a bat, side on', () => {
      for (const kind of ['ghoul', 'bat'] as const) {
        expect(CHARACTERS[kind].actions, kind).toEqual(CAST[kind]);
        expect([...CHARACTERS[kind].views], kind).toEqual(['side']);
      }
    });

    it('holds every action, frame and view of both, plain and gold-trimmed for champions, each frame a drawing of its own', () => {
      for (const kind of ['ghoul', 'bat'] as const) {
        const plain = keysOf(kind, false);
        const champ = keysOf(kind, true);
        for (const key of [...plain, ...champ]) expect(byKey.has(key), key).toBe(true);
        expect(new Set(plain.map(svgOf)).size, kind).toBe(plain.length);
        plain.forEach((key, i) => expect(svgOf(champ[i]), key).not.toBe(svgOf(key)));
      }
    });

    it('comes out the same when built twice', () => {
      for (const kind of ['ghoul', 'bat'] as const) for (const key of [...keysOf(kind, false), ...keysOf(kind, true)]) expect(svgOf(key), key).toBe(svgOf(key));
    });

    it('leaves the rest of the cast drawn exactly as before', () => {
      const entries = artCatalogue().filter((e) => e.key.startsWith('c:') && !['ghoul', 'bat'].includes(e.key.split(':')[1]));
      expect(entries.length).toBe(128);
      // The fingerprint of every character's frames before the cave cast got theirs.
      expect(fnv(entries.map((e) => e.key + e.svg()).join('\n'))).toBe('a573d34');
    });
  });

  it('keeps the forest terrain, joins and decor exactly as they were drawn', () => {
    const forest = ['tree', 'oak', 'willow', 'bush', 'reed clump', 'bramble bush', 'pond', 'bog', 'thorn bush', 'rolling log', 'mirror stone', 'puffball'];
    const decor = ['grass', 'leaves', 'flowers', 'puddle', 'reeds', 'lilypad', 'thornLitter', 'berries', 'pebbles'];
    const entries = artCatalogue().filter((e) => {
      const [kind, name] = e.key.split(':');
      return kind === 'k' ? decor.includes(name) : ['t', 'j'].includes(kind) && forest.includes(name);
    });
    expect(entries.length).toBe(212);
    // The fingerprint of the forest's terrain tiles, joins and decor before the caves got theirs.
    expect(fnv(entries.map((e) => e.key + e.svg()).join('\n'))).toBe('4a2d21a6');
  });
});
