import { describe, expect, it } from 'vitest';
import { composeRoom, ENCOUNTERS, encountersFor, LAYOUTS, layoutsFor } from './composer';
import { L_SHAPES, missingCell, SHAPE_CELLS } from '../map/floorGenerator';
import { createRng } from '../rng';
import { outsideRoom, placeDoors, roomSize, type DoorSpec } from './roomGenerator';
import { validateRoom } from './roomValidator';

const WIDE_SLOTS: DoorSpec[] = [
  { side: 'up', at: { x: 0, y: 0 } }, { side: 'up', at: { x: 1, y: 0 } },
  { side: 'down', at: { x: 0, y: 0 } }, { side: 'down', at: { x: 1, y: 0 } },
  { side: 'left', at: { x: 0, y: 0 } }, { side: 'right', at: { x: 1, y: 0 } },
];
/** Every non-empty set of a wide room's door slots. */
const WIDE_DOOR_SETS = Array.from({ length: (1 << WIDE_SLOTS.length) - 1 }, (_, m) => WIDE_SLOTS.filter((_, i) => (m + 1) & (1 << i)));
const wideDoors = (specs: DoorSpec[]) => placeDoors(specs, 26, 7);
const FLOOR_THEMES = [
  ['grove', 'marsh', 'bramble'],
  ['grotto', 'hollow', 'rift'],
  ['crypt', 'cellblock', 'machineHall'],
];

const SIDES = ['up', 'down', 'left', 'right'] as const;
const STEP = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } } as const;
const BIG_SHAPES = ['2x1', '1x2', '2x2', ...L_SHAPES] as const;
type BigShape = (typeof BIG_SHAPES)[number];
/** Every wall slot a door can take: an outward side of one of the shape's map cells. */
const slots = (shape: BigShape): DoorSpec[] => {
  const cells = SHAPE_CELLS[shape];
  const inShape = (c: { x: number; y: number }) => cells.some((d) => d.x === c.x && d.y === c.y);
  const box = missingCell(shape);
  return cells.flatMap((at) =>
    SIDES.filter((side) => {
      const n = { x: at.x + STEP[side].x, y: at.y + STEP[side].y };
      // An L's inner sides face its missing cell: wall, not a way out.
      return !inShape(n) && !(box && n.x === box.x && n.y === box.y);
    }).map((side) => ({ side, at })),
  );
};
/** Every non-empty set of the shape's door slots, thinned to about `max`. */
const doorSets = (shape: BigShape, max = 70) => {
  const s = slots(shape);
  const all = Array.from({ length: (1 << s.length) - 1 }, (_, m) => s.filter((_, i) => (m + 1) & (1 << i)));
  const step = Math.ceil(all.length / max);
  return all.filter((_, i) => i % step === 0);
};
const doorsFor = (shape: BigShape, specs: DoorSpec[]) => {
  const { width, height } = roomSize('normal', shape);
  return placeDoors(specs, width, height);
};

describe('composeRoom for wide rooms', () => {
  it('builds a valid room from one of the wide layouts and one of the encounters', () => {
    for (let seed = 0; seed < 20; seed++) {
      const doors = wideDoors(WIDE_DOOR_SETS[seed * 3]);
      const room = composeRoom({ shape: '2x1', doors, theme: 'grove', floorIndex: 0, rng: createRng(seed) })!;
      expect(LAYOUTS.filter((l) => l.shapes.includes('2x1')).map((l) => l.id)).toContain(room.layout);
      expect(ENCOUNTERS.map((e) => e.id)).toContain(room.encounter);
      expect(validateRoom({ ...room, doors }, room.symmetry)).toEqual([]);
      expect(room.enemies.length).toBeGreaterThan(0);
    }
  });

  it('mixes layouts and encounters: each layout shows up with each encounter', () => {
    const wideLayouts = LAYOUTS.filter((l) => l.shapes.includes('2x1'));
    expect(wideLayouts.length).toBeGreaterThanOrEqual(2);
    expect(encountersFor(0).length).toBeGreaterThanOrEqual(2);
    const pairs = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const doors = wideDoors(WIDE_DOOR_SETS[seed % WIDE_DOOR_SETS.length]);
      const room = composeRoom({ shape: '2x1', doors, theme: 'bramble', floorIndex: 0, rng: createRng(seed) })!;
      pairs.add(`${room.layout} + ${room.encounter}`);
    }
    expect(pairs.size).toBe(wideLayouts.length * encountersFor(0).length);
  });

  it('builds every theme, layout and encounter pairing validly for every door set', { timeout: 60_000 }, () => {
    for (const [floorIndex, themes] of FLOOR_THEMES.entries()) {
      for (const theme of themes) {
        for (const layout of LAYOUTS.filter((l) => l.shapes.includes('2x1'))) {
          for (const encounter of encountersFor(floorIndex)) {
            for (const [i, specs] of WIDE_DOOR_SETS.entries()) {
              const doors = wideDoors(specs);
              const where = `${theme} ${layout.id} + ${encounter.id} doors ${JSON.stringify(specs)}`;
              const room = composeRoom({ shape: '2x1', doors, theme, floorIndex, rng: createRng(i), layout: layout.id, encounter: encounter.id });
              expect(room, where).toBeDefined();
              expect([room!.layout, room!.encounter], where).toEqual([layout.id, encounter.id]);
              expect(validateRoom({ ...room!, doors }, room!.symmetry), where).toEqual([]);
            }
          }
        }
      }
    }
  });

  const sample = (theme: string, floorIndex: number, seeds = 300) =>
    Array.from({ length: seeds }, (_, seed) =>
      composeRoom({ shape: '2x1', doors: wideDoors(WIDE_DOOR_SETS[seed % WIDE_DOOR_SETS.length]), theme, floorIndex, rng: createRng(seed) })!,
    );

  it('stands every enemy on a spawn spot of a tag its encounter asked for (a swarm within 3 tiles of one)', () => {
    for (const room of sample('rift', 1, 100)) {
      const asks = ENCOUNTERS.find((e) => e.id === room.encounter)!.asks;
      const asked = new Set(asks.filter((a) => !a.swarm).map((a) => a.tag));
      const nested = new Set(asks.filter((a) => a.swarm).map((a) => a.tag));
      for (const e of room.enemies) {
        const onSpot = room.spots.some((s) => s.cell.x === e.cell.x && s.cell.y === e.cell.y && asked.has(s.tag));
        const byNest = room.spots.some(
          (s) => nested.has(s.tag) && Math.max(Math.abs(s.cell.x - e.cell.x), Math.abs(s.cell.y - e.cell.y)) <= 3,
        );
        expect(onSpot || byNest, `${room.layout} + ${room.encounter} ${e.type} at ${e.cell.x},${e.cell.y}`).toBe(true);
      }
    }
  });

  it('only grows thorns in the bramble thicket', () => {
    const thorns = (theme: string, floorIndex: number) =>
      sample(theme, floorIndex).reduce((n, r) => n + r.tiles.flat().filter((t) => t === 'thorn').length, 0);
    expect(thorns('bramble', 0)).toBeGreaterThan(0);
    for (const [floorIndex, themes] of FLOOR_THEMES.entries()) {
      for (const theme of themes.filter((t) => t !== 'bramble')) expect(thorns(theme, floorIndex), theme).toBe(0);
    }
  });
});

describe('composeRoom for every big shape', () => {
  it('draws layouts for tall, 2x2 and every L room, and builds every pairing validly for every door set', () => {
    for (const shape of BIG_SHAPES) {
      const layouts = LAYOUTS.filter((l) => l.shapes.includes(shape));
      expect(layouts.length, shape).toBeGreaterThan(0);
      const outside = outsideRoom(shape, roomSize('normal', shape).width, roomSize('normal', shape).height);
      for (const [floorIndex, themes] of FLOOR_THEMES.entries()) {
        for (const layout of layouts) {
          for (const encounter of encountersFor(floorIndex)) {
            for (const [i, specs] of doorSets(shape, 20).entries()) {
              const theme = themes[i % 3];
              const doors = doorsFor(shape, specs);
              const where = `${shape} ${theme} ${layout.id} + ${encounter.id} doors ${JSON.stringify(specs)}`;
              const room = composeRoom({ shape, doors, theme, floorIndex, rng: createRng(i), layout: layout.id, encounter: encounter.id });
              expect(room, where).toBeDefined();
              expect(validateRoom({ ...room!, doors }, room!.symmetry), where).toEqual([]);
              expect(room!.enemies.length, where).toBeGreaterThan(0);
              // An L's missing cell is wall, and nothing stands in it.
              room!.tiles.forEach((row, y) => row.forEach((t, x) => expect(t === 'wall', `${where} ${x},${y}`).toBe(outside({ x, y }))));
            }
          }
        }
      }
    }
  }, 60_000);
});

describe('enemy counts by room area', () => {
  // Prowlers ask for 2-4 lurkers and 1-2 on the open floor: 3-6 before scaling.
  it.each([
    ['2x1', 5, 9],
    ['1x2', 5, 9],
    ['L-tl', 6, 12],
    ['L-br', 6, 12],
    ['2x2', 8, 15],
  ] as const)('fills a %s room with %i-%i prowlers', (shape, min, max) => {
    const counts = new Set<number>();
    for (const [i, specs] of doorSets(shape, 30).entries()) {
      const doors = doorsFor(shape, specs);
      const room = composeRoom({ shape, doors, theme: 'hollow', floorIndex: 1, rng: createRng(i), encounter: 'prowlers' })!;
      const where = `${shape} ${room.layout} doors ${JSON.stringify(specs)}`;
      expect(room.enemies.length, where).toBeGreaterThanOrEqual(min);
      expect(room.enemies.length, where).toBeLessThanOrEqual(max);
      counts.add(room.enemies.length);
    }
    // Well past the old most of six.
    expect(Math.max(...counts)).toBeGreaterThan(6);
  });
});

describe('swarms in big rooms', () => {
  type Cell = { x: number; y: number };
  const near = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 3;
  /** Whether one or two of the cells can stand as nests with every cell within 3 tiles of one. */
  const packsRoundTwoNests = (cells: Cell[]) =>
    cells.some((a) => cells.some((b) => cells.every((c) => near(c, a) || near(c, b))));

  it.each([
    ['waspSwarm', 0, 'wasp', 'marsh'],
    ['batColony', 1, 'bat', 'hollow'],
  ] as const)('%s sends 8-12 in one or two tight clusters, in every big shape', (encounter, floorIndex, type, theme) => {
    for (const shape of BIG_SHAPES) {
      for (const [i, specs] of doorSets(shape, 12).entries()) {
        const doors = doorsFor(shape, specs);
        const room = composeRoom({ shape, doors, theme, floorIndex, rng: createRng(i), encounter })!;
        const where = `${shape} ${room?.layout} doors ${JSON.stringify(specs)}`;
        expect(room, where).toBeDefined();
        const swarm = room.enemies.filter((e) => e.type === type).map((e) => e.cell);
        expect(swarm.length, where).toBeGreaterThanOrEqual(8);
        expect(swarm.length, where).toBeLessThanOrEqual(12);
        expect(packsRoundTwoNests(swarm), where).toBe(true);
        expect(validateRoom({ ...room, doors }, room.symmetry), where).toEqual([]);
      }
    }
  });
});

describe('big-room content per floor', () => {
  const SPECIALS = [['wasp', 'boar'], ['bat', 'worm', 'slime'], ['knight', 'ghost']];

  it('gives every floor about three layouts per big shape and four or more encounters', () => {
    for (const floorIndex of [0, 1, 2]) {
      for (const shape of BIG_SHAPES) expect(layoutsFor(shape).length, `${shape}`).toBeGreaterThanOrEqual(3);
      expect(encountersFor(floorIndex).length, `floor ${floorIndex + 1}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("brings each floor's own enemies into its big rooms", () => {
    for (const [floorIndex, themes] of FLOOR_THEMES.entries()) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 300; seed++) {
        const shape = BIG_SHAPES[seed % BIG_SHAPES.length];
        const sets = doorSets(shape);
        const doors = doorsFor(shape, sets[seed % sets.length]);
        const room = composeRoom({ shape, doors, theme: themes[seed % 3], floorIndex, rng: createRng(seed) })!;
        for (const e of room.enemies) seen.add(e.type);
      }
      for (const special of SPECIALS[floorIndex]) expect(seen, `floor ${floorIndex + 1}`).toContain(special);
    }
  });
});

describe('sub-theme encounter weights', () => {
  const FAVOURITE: Record<string, string> = {
    grove: 'boarCharge', marsh: 'waspSwarm', bramble: 'ambush',
    grotto: 'ledgeSentries', hollow: 'batColony', rift: 'wormNest',
    crypt: 'haunting', cellblock: 'knightPatrol', machineHall: 'siege',
  };
  const share = (encounter: string, theme: string, floorIndex: number) => {
    let hits = 0;
    const n = 150;
    for (let seed = 0; seed < n; seed++) {
      const shape = BIG_SHAPES[seed % BIG_SHAPES.length];
      const sets = doorSets(shape);
      const room = composeRoom({ shape, doors: doorsFor(shape, sets[seed % sets.length]), theme, floorIndex, rng: createRng(seed) })!;
      if (room.encounter === encounter) hits++;
    }
    return hits / n;
  };

  it('makes each sub-theme favour its fitting fight over the rest of its floor, never ruling others out', { timeout: 60_000 }, () => {
    for (const [floorIndex, themes] of FLOOR_THEMES.entries()) {
      for (const theme of themes) {
        const favourite = FAVOURITE[theme];
        const own = share(favourite, theme, floorIndex);
        const elsewhere = themes.filter((t) => t !== theme).map((t) => share(favourite, t, floorIndex));
        for (const other of elsewhere) expect(own, `${theme} ${favourite}`).toBeGreaterThan(1.5 * other);
        expect(own, theme).toBeLessThan(0.7);
      }
    }
  });
});
