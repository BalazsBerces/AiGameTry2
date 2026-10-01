import { describe, expect, it } from 'vitest';
import { artCatalogue, charKey, decorKey, doorKey, floorKey, floorLook, groundKey, joinKey, shotKey, tileKey, wallJoinKey, wallKey, type DoorSide, type FloorKind } from './catalogue';
import { CHARACTERS, type Action } from './characters';
import { PAPER } from './palette';
import { CAVE_FLOOR_LOOKS, JOIN_LOOKS, TILE, WALL_JOIN_LOOKS, WALL_JOIN_SIDES, WALL_STYLES, wallGems, type WallSide } from './terrain';
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
      // Veined walls differ only where a piece has wall gems; many pieces have none.
      expect(VARIANTS.some((v) => svgOf(wallKey('caves', 'top', v, 'veined')) !== svgOf(wallKey('caves', 'top', v, 'strata')))).toBe(true);
      expect(svgOf(doorKey('caves', 'up', true))).not.toBe(svgOf(doorKey('forest', 'up', true)));
      expect(svgOf(floorKey('caves', 'boss', 0))).not.toBe(svgOf(floorKey('forest', 'boss', 0)));
    });

    it('comes out the same when built twice', () => {
      for (const key of [...walls, ...doors, ...floors]) expect(svgOf(key), key).toBe(svgOf(key));
    });

    describe('wall gems', () => {
      const pieces = (['top', 'bottom', 'left', 'right'] as const).flatMap((side) => VARIANTS.map((v) => ({ side, v, gems: wallGems(side, v) })));

      it('sets 0-2 in each wall piece and none in a corner, many pieces going without', () => {
        for (const v of VARIANTS) expect(wallGems('corner', v)).toEqual([]);
        for (const { gems } of pieces) expect(gems.length).toBeLessThanOrEqual(2);
        const bare = pieces.filter((p) => p.gems.length === 0).length;
        expect(bare).toBeGreaterThanOrEqual(pieces.length / 3);
        expect(bare).toBeLessThan(pieces.length);
      });

      it('keeps them back from the edge facing the room', () => {
        const into = { top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 }, left: { x: 1, y: 0 }, right: { x: -1, y: 0 } };
        for (const { side, gems } of pieces) for (const g of gems) expect(TILE / 2 - (g.x * into[side].x + g.y * into[side].y), side).toBeGreaterThanOrEqual(12);
      });

      it('places them the same every time', () => {
        for (const { side, v, gems } of pieces) expect(wallGems(side, v)).toEqual(gems);
      });

      it('draws veined walls with no continuous crystal seam', () => {
        for (const side of ['top', 'bottom', 'left', 'right'] as const) {
          for (const v of VARIANTS) expect(svgOf(wallKey('caves', side, v, 'veined'))).not.toContain('stroke-dasharray="3 9 2 13"');
        }
      });
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
    const joins = ['stalagmite', 'thorn vine', 'loose rock'].flatMap((art) => (['across', 'down'] as const).map((d) => joinKey(art, d)));

    it('joins loose rock into rubble walls, but never the mushroom hollow\'s caps', () => {
      for (const d of ['across', 'down'] as const) expect(byKey.has(joinKey('loose rock', d)), d).toBe(true);
      expect(svgOf(joinKey('loose rock', 'across'))).not.toBe(svgOf(joinKey('loose rock', 'down')));
      expect(JOIN_LOOKS).not.toContain('mushroom cap');
    });

    it('grows rubble walls out of the cave wall: a join for every side a wall can be on, each its own and the same every time', () => {
      const keys = WALL_JOIN_SIDES.map((side) => wallJoinKey('loose rock', side));
      for (const key of keys) {
        expect(byKey.has(key), key).toBe(true);
        expect(svgOf(key), key).toBe(svgOf(key));
      }
      expect(new Set(keys.map(svgOf)).size).toBe(4);
      expect(WALL_JOIN_LOOKS).toEqual(['loose rock']);
    });

    it("names art for every look, sub-themes' included", () => {
      expect([...caveArts].sort()).toEqual(
        ['boulder', 'chasm', 'crystal cluster', 'crystal spire', 'giant mushroom', 'glowshroom', 'loose rock', 'mushroom cap', 'rift', 'stalagmite', 'thorn vine'],
      );
    });

    it('holds every variant of each look, every neighbour mask of chasm and rift, and stalagmite, thorn-vine and loose-rock joins', () => {
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
    /** The worm boss acts out its fight: crawl, roar (rearing), spit, charge, burrow, lob, split and die. */
    const BOSS_ACTIONS = { idle: 2, move: 4, attack: 3, hurt: 1, spit: 2, charge: 2, burrow: 2, lob: 2, split: 2, die: 2 } as const;
    const CAST = {
      ghoul: { views: ['side'], actions: { idle: 2, move: 4, attack: 3, hurt: 1, recover: 2 } },
      bat: { views: ['side'], actions: { idle: 2, move: 4, attack: 3, hurt: 1 } },
      slime: { views: ['side'], actions: { idle: 2, move: 4, attack: 3, hurt: 1, land: 2 } },
      geode: { views: ['down'], actions: { idle: 2, move: 4, attack: 3, hurt: 1 } },
      wormHead: { views: ['side', 'down', 'up'], actions: { idle: 2, move: 4, attack: 3, hurt: 1 } },
      wormBody: { views: ['side', 'down', 'up'], actions: { idle: 2, move: 4, attack: 3, hurt: 1 } },
      wormTail: { views: ['side', 'down', 'up'], actions: { idle: 2, move: 4, attack: 3, hurt: 1 } },
      wormBossHead: { views: ['side', 'down', 'up'], actions: BOSS_ACTIONS, champion: false },
      wormBossBody: { views: ['side', 'down', 'up'], actions: BOSS_ACTIONS, champion: false },
      wormBossTail: { views: ['side', 'down', 'up'], actions: BOSS_ACTIONS, champion: false },
      wormEgg: { views: ['down'], actions: { idle: 2, move: 4, attack: 3, hurt: 1 }, champion: false },
    } as const;
    const KINDS = Object.keys(CAST) as (keyof typeof CAST)[];
    const hasChampion = (kind: keyof typeof CAST) => !('champion' in CAST[kind]);
    const keysOf = (kind: keyof typeof CAST, champion: boolean) =>
      CAST[kind].views.flatMap((view) =>
        (Object.entries(CAST[kind].actions) as [Action, number][]).flatMap(([action, count]) =>
          Array.from({ length: count }, (_, f) => charKey(kind, action, f, view, champion)),
        ),
      );

    it("stalks, lunges and recovers as a ghoul; flutters and swoops as a bat; squashes, hops and lands as a slime, all side on; a geode faces the camera; a worm's and the worm boss's head, body and tail face every way they crawl; an egg sits facing the camera", () => {
      for (const kind of KINDS) {
        expect(CHARACTERS[kind].actions, kind).toEqual(CAST[kind].actions);
        expect([...CHARACTERS[kind].views], kind).toEqual(CAST[kind].views);
      }
    });

    it('holds every action, frame and view of each, plain and gold-trimmed for champions, each frame a drawing of its own', () => {
      for (const kind of KINDS) {
        const plain = keysOf(kind, false);
        const champ = keysOf(kind, true);
        for (const key of plain) expect(byKey.has(key), key).toBe(true);
        expect(new Set(plain.map(svgOf)).size, kind).toBe(plain.length);
        if (!hasChampion(kind)) {
          for (const key of champ) expect(byKey.has(key), key).toBe(false);
          continue;
        }
        plain.forEach((key, i) => expect(svgOf(champ[i]), key).not.toBe(svgOf(key)));
      }
    });

    it("draws the worm's head, body and tail as pieces of their own", () => {
      const idle = (kind: string) => svgOf(charKey(kind, 'idle', 0, 'side'));
      expect(new Set(['wormHead', 'wormBody', 'wormTail'].map(idle)).size).toBe(3);
    });

    it("draws the worm boss's pieces as its own, apart from the worm's and from each other", () => {
      const idle = (kind: string) => svgOf(charKey(kind, 'idle', 0, 'side'));
      expect(new Set(['wormHead', 'wormBody', 'wormTail', 'wormBossHead', 'wormBossBody', 'wormBossTail'].map(idle)).size).toBe(6);
    });

    it("leaves the worm's own pieces drawn exactly as they were", () => {
      const entries = artCatalogue().filter((e) => ['wormHead', 'wormBody', 'wormTail'].includes(e.key.split(':')[1]));
      expect(entries.length).toBe(180);
      // The fingerprint of the worm's frames before the worm boss got its own.
      expect(fnv(entries.map((e) => e.key + e.svg()).join('\n'))).toBe('1d114173');
    });

    it('comes out the same when built twice', () => {
      for (const kind of KINDS) for (const key of [...keysOf(kind, false), ...(hasChampion(kind) ? keysOf(kind, true) : [])]) expect(svgOf(key), key).toBe(svgOf(key));
    });

    it('leaves the rest of the cast drawn exactly as before', () => {
      const entries = artCatalogue().filter((e) => e.key.startsWith('c:') && !(KINDS as string[]).includes(e.key.split(':')[1]));
      expect(entries.length).toBe(128);
      // The fingerprint of every character's frames before the cave cast got theirs.
      expect(fnv(entries.map((e) => e.key + e.svg()).join('\n'))).toBe('a573d34');
    });
  });

  describe('the shots', () => {
    it("draws the geode's shard shot as a hostile crystal shard of its own", () => {
      expect(byKey.has(shotKey('shard'))).toBe(true);
      expect(svgOf(shotKey('shard'))).not.toBe(svgOf(shotKey('enemy')));
      expect(svgOf(shotKey('shard'))).not.toBe(svgOf(shotKey('player')));
      expect(svgOf(shotKey('shard'))).toBe(svgOf(shotKey('shard')));
    });

    it('outlines the shard shot dark round a red-hot core, like every enemy shot', () => {
      const shard = svgOf(shotKey('shard'));
      expect(shard).toContain(PAPER.ink);
      expect(shard).toContain(PAPER.enemyShotCore);
    });

    it("leaves the player's and every other enemy shot drawn exactly as before", () => {
      expect(fnv(svgOf(shotKey('player')) + svgOf(shotKey('enemy')))).toBe('ff01aea8');
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
