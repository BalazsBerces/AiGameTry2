import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeById, assignArchetypes, supportsShape } from './archetypes';
import { generateFloor, type FloorLayout } from './floorGenerator';
import { createRng } from './rng';
import { assignRoomThemes, roomThemesFor, type ThemeRoom } from './roomThemes';

/** A real floor's rooms and who each one opens onto. */
function floorGraph(seed: number, floorIndex: number): { floor: FloorLayout; rooms: ThemeRoom[] } {
  const floor = generateFloor({ occupied: new Set(), start: { x: 0, y: 0 }, floorIndex, rng: createRng(seed) });
  const rooms = floor.rooms.map((r) => ({
    id: r.id,
    neighbors: floor.connections.flatMap(([a, b]) => (a === r.id ? [b] : b === r.id ? [a] : [])),
  }));
  return { floor, rooms };
}

const FLOOR_THEMES = [
  ['grove', 'marsh', 'bramble'],
  ['grotto', 'hollow', 'rift'],
  ['crypt', 'cellblock', 'machineHall'],
];

describe('1x1 room ideas', () => {
  it("are each tagged with one of their floor's sub-themes", () => {
    const ideas = ARCHETYPES.filter((a) => a.kind === 'normal' && supportsShape(a, '1x1'));
    expect(ideas.length).toBeGreaterThan(20);
    for (const a of ideas) expect(FLOOR_THEMES[a.floor]).toContain(a.theme);
  });

  it('put the thorn maze in the bramble thicket', () => {
    expect(archetypeById('thornMaze')?.theme).toBe('bramble');
  });
});

describe('assignArchetypes for themed rooms', () => {
  const room = (id: number, theme: string) => ({ id: `r${id}`, kind: 'normal' as const, doors: ['up', 'down', 'left', 'right'] as const, theme });

  it("builds a themed room from one of its theme's ideas", () => {
    for (let seed = 0; seed < 50; seed++) {
      const rooms = [0, 1, 2, 3].map((i) => room(i, 'marsh'));
      const picked = assignArchetypes(rooms, 0, createRng(seed));
      for (const r of rooms) expect(archetypeById(picked.get(r.id)!)?.theme).toBe('marsh');
    }
  });

  it("falls back to other ideas once the theme's own are used up", () => {
    const rooms = Array.from({ length: 8 }, (_, i) => room(i, 'bramble'));
    const picked = assignArchetypes(rooms, 0, createRng(1));
    expect(picked.size).toBe(8);
  });
});

describe('assignRoomThemes', () => {
  it("gives every room one of its floor's three sub-themes", () => {
    for (const floorIndex of [0, 1, 2]) {
      expect(roomThemesFor(floorIndex).map((t) => t.id).sort()).toEqual([...FLOOR_THEMES[floorIndex]].sort());
      for (let seed = 0; seed < 20; seed++) {
        const { rooms } = floorGraph(seed, floorIndex);
        const themes = assignRoomThemes(rooms, floorIndex, createRng(seed));
        for (const room of rooms) expect(FLOOR_THEMES[floorIndex]).toContain(themes.get(room.id));
      }
    }
  });

  it('uses all three sub-themes on every floor', () => {
    for (let seed = 0; seed < 300; seed++) {
      const floorIndex = seed % 3;
      const { rooms } = floorGraph(seed, floorIndex);
      const used = new Set(assignRoomThemes(rooms, floorIndex, createRng(seed)).values());
      expect([...used].sort()).toEqual([...FLOOR_THEMES[floorIndex]].sort());
    }
  });

  it('makes neighbouring rooms share a theme far more often than chance', () => {
    let pairs = 0;
    let shared = 0;
    for (let seed = 0; seed < 200; seed++) {
      const floorIndex = seed % 3;
      const { floor, rooms } = floorGraph(seed, floorIndex);
      const themes = assignRoomThemes(rooms, floorIndex, createRng(seed));
      for (const [a, b] of floor.connections) {
        pairs++;
        if (themes.get(a) === themes.get(b)) shared++;
      }
    }
    // Three themes picked independently would match a third of the time.
    expect(shared / pairs).toBeGreaterThan(0.55);
  });

  it('gives the same themes for the same seed', () => {
    const { rooms } = floorGraph(7, 1);
    expect(assignRoomThemes(rooms, 1, createRng(7))).toEqual(assignRoomThemes(rooms, 1, createRng(7)));
  });

  it('keeps fixed themes and fills the missing ones in from the free rooms', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { rooms } = floorGraph(seed, 0);
      // All but four rooms pinned to the grove.
      const fixed = rooms.map((r, i) => (i < rooms.length - 4 ? { ...r, fixed: 'grove' } : r));
      const themes = assignRoomThemes(fixed, 0, createRng(seed));
      for (const r of fixed) if (r.fixed) expect(themes.get(r.id)).toBe('grove');
      expect(new Set(themes.values())).toEqual(new Set(FLOOR_THEMES[0]));
    }
  });
});
