import { describe, expect, it } from 'vitest';
import { ARCHETYPES, supportsShape } from './archetypes';
import { composeRoom } from './composer';
import type { Cell } from './floorGenerator';
import { addFiller } from './filler';
import { createRng } from './rng';
import { placeDoors, type DoorSpec, type Tile } from './roomGenerator';
import { doorApproach, validateRoom, type Symmetry, type RoomToValidate } from './roomValidator';
import { floodFill } from './grid';
import { isWalkable } from './tiles';

const WIDE_SLOTS: DoorSpec[] = [
  { side: 'up', at: { x: 0, y: 0 } }, { side: 'up', at: { x: 1, y: 0 } },
  { side: 'down', at: { x: 0, y: 0 } }, { side: 'down', at: { x: 1, y: 0 } },
  { side: 'left', at: { x: 0, y: 0 } }, { side: 'right', at: { x: 1, y: 0 } },
];
const WIDE_DOOR_SETS = Array.from({ length: (1 << WIDE_SLOTS.length) - 1 }, (_, m) => WIDE_SLOTS.filter((_, i) => (m + 1) & (1 << i)));
const FLOOR_THEMES = [
  ['grove', 'marsh', 'bramble'],
  ['grotto', 'hollow', 'rift'],
  ['crypt', 'cellblock', 'machineHall'],
];

interface Case {
  room: RoomToValidate;
  symmetry: Symmetry;
  protect: Cell[];
  theme: string;
  size: 'big' | 'small';
  where: string;
}

/** Composed wide rooms, every floor and theme, a spread of door sets. */
function bigRooms(): Case[] {
  const cases: Case[] = [];
  for (const [floorIndex, themes] of FLOOR_THEMES.entries()) {
    for (const theme of themes) {
      for (let seed = 0; seed < 15; seed++) {
        const doors = placeDoors(WIDE_DOOR_SETS[(seed * 7 + floorIndex) % WIDE_DOOR_SETS.length], 26, 7);
        const c = composeRoom({ shape: '2x1', doors, theme, floorIndex, rng: createRng(seed) })!;
        cases.push({ room: { ...c, doors }, symmetry: c.symmetry, protect: c.spots.map((s) => s.cell), theme, size: 'big', where: `${theme} ${c.layout} seed ${seed}` });
      }
    }
  }
  return cases;
}

/** Every 1x1 normal idea, built straight from its archetype, in its own theme. */
function smallRooms(): Case[] {
  const cases: Case[] = [];
  const sides = ['up', 'down', 'left', 'right'] as const;
  for (const a of ARCHETYPES.filter((x) => x.kind === 'normal' && supportsShape(x, '1x1'))) {
    for (let seed = 0; seed < 8; seed++) {
      const doorSides = sides.filter((_, i) => ((seed % 15) + 1) & (1 << i)).filter((d) => a.fits([d]));
      const doors = placeDoors(doorSides.length ? [...doorSides] : ['left'], 13, 7);
      if (!a.fits(doors.map((d) => d.side))) continue;
      const b = a.build({ width: 13, height: 7, doors, rng: createRng(seed) });
      cases.push({ room: { ...b, doors }, symmetry: b.symmetry, protect: [], theme: a.theme!, size: 'small', where: `${a.id} seed ${seed}` });
    }
  }
  return cases;
}

const fill = (c: Case, seed = 1) => addFiller({ ...c, rng: createRng(seed) });

/** Cells that were floor and are now something else. */
const added = (before: Tile[][], after: Tile[][]): Cell[] =>
  after.flatMap((row, y) => row.flatMap((t, x) => (before[y][x] === 'floor' && t !== 'floor' ? [{ x, y }] : [])));

describe('addFiller', () => {
  it('never covers spawn spots, enemies, pickups or door approaches', () => {
    for (const c of [...bigRooms(), ...smallRooms()]) {
      const { tiles } = fill(c);
      const guarded = [
        ...c.protect,
        ...c.room.enemies.flatMap((e) => [e.cell, ...(e.tail ?? [])]),
        ...c.room.pickups.map((p) => p.cell),
        ...c.room.doors.flatMap(doorApproach),
      ];
      for (const g of guarded) expect(tiles[g.y][g.x], `${c.where} at ${g.x},${g.y}`).toBe(c.room.tiles[g.y][g.x]);
    }
  });

  it('keeps every room valid and seals no floor away', () => {
    for (const c of [...bigRooms(), ...smallRooms()]) {
      const { tiles, symmetry } = fill(c);
      expect(validateRoom({ ...c.room, tiles }, symmetry), c.where).toEqual([]);
      const from = c.room.doors[0].cell;
      const before = floodFill(c.room.tiles, from, isWalkable);
      const after = floodFill(tiles, from, isWalkable);
      const covered = new Set(added(c.room.tiles, tiles).map((p) => `${p.x},${p.y}`));
      for (const k of before) if (!covered.has(k)) expect(after.has(k), `${c.where} cut off ${k}`).toBe(true);
    }
  });

  it('never uses thorns, even in the bramble thicket', () => {
    for (const c of [...bigRooms(), ...smallRooms()].filter((x) => x.theme === 'bramble')) {
      const { tiles } = fill(c);
      for (const p of added(c.room.tiles, tiles)) expect(tiles[p.y][p.x], c.where).not.toBe('thorn');
    }
  });

  it('is mirrored through the room’s axes, bar the odd lone piece', () => {
    let lone = 0;
    const cases = [...bigRooms(), ...smallRooms()];
    for (const c of cases) {
      const { symmetry } = fill(c);
      const extra = (symmetry.feature ?? []).length - (c.symmetry.feature ?? []).length;
      expect(extra, c.where).toBeLessThanOrEqual(1);
      lone += extra;
    }
    expect(lone).toBeGreaterThan(0);
    expect(lone / cases.length).toBeLessThan(0.4);
  });

  it('dresses big rooms generously and 1x1 rooms lightly', () => {
    const amounts = (cases: Case[]) => cases.map((c) => added(c.room.tiles, fill(c).tiles).length);
    const big = amounts(bigRooms());
    const small = amounts(smallRooms());
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.min(...big)).toBeGreaterThanOrEqual(6);
    expect(mean(big)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...big)).toBeLessThanOrEqual(40);
    expect(mean(small)).toBeGreaterThanOrEqual(2);
    expect(mean(small)).toBeLessThanOrEqual(10);
    expect(Math.max(...small)).toBeLessThanOrEqual(14);
  });
});
