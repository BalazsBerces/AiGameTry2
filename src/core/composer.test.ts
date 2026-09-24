import { describe, expect, it } from 'vitest';
import { composeRoom, ENCOUNTERS, LAYOUTS } from './composer';
import { L_SHAPES, missingCell, SHAPE_CELLS } from './floorGenerator';
import { createRng } from './rng';
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
    expect(ENCOUNTERS.length).toBeGreaterThanOrEqual(2);
    const pairs = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const doors = wideDoors(WIDE_DOOR_SETS[seed % WIDE_DOOR_SETS.length]);
      const room = composeRoom({ shape: '2x1', doors, theme: 'bramble', floorIndex: 0, rng: createRng(seed) })!;
      pairs.add(`${room.layout} + ${room.encounter}`);
    }
    expect(pairs.size).toBe(wideLayouts.length * ENCOUNTERS.length);
  });

  it('builds every theme, layout and encounter pairing validly for every door set', () => {
    for (const [floorIndex, themes] of FLOOR_THEMES.entries()) {
      for (const theme of themes) {
        for (const layout of LAYOUTS.filter((l) => l.shapes.includes('2x1'))) {
          for (const encounter of ENCOUNTERS) {
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

  it('stands every enemy on a spawn spot of a tag its encounter asked for', () => {
    for (const room of sample('rift', 1, 100)) {
      const asked = new Set(ENCOUNTERS.find((e) => e.id === room.encounter)!.asks.map((a) => a.tag));
      for (const e of room.enemies) {
        const spot = room.spots.find((s) => s.cell.x === e.cell.x && s.cell.y === e.cell.y);
        expect(spot && asked.has(spot.tag), `${room.layout} + ${room.encounter} ${e.type} at ${e.cell.x},${e.cell.y}`).toBe(true);
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

  it('favours the encounters that suit the theme, without ruling the others out', () => {
    const share = (theme: string, floorIndex: number) => {
      const rooms = sample(theme, floorIndex);
      return rooms.filter((r) => r.encounter === 'ledgeSentries').length / rooms.length;
    };
    // The marsh leans to sentries on the ledges, the grove to prowlers in its corners.
    expect(share('marsh', 0)).toBeGreaterThan(2 * share('grove', 0));
    expect(share('grove', 0)).toBeGreaterThan(0);
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
          for (const encounter of ENCOUNTERS) {
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
