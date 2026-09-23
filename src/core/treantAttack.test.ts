import { describe, expect, it } from 'vitest';
import type { Cell } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { planRootEruption, rootEruptionAt } from './treantAttack';

/** ASCII fixture: `.` floor, `#` stone, `r` rock, `o` hole. */
const grid = (rows: string[]): Tile[][] =>
  rows.map((row) => [...row].map((ch): Tile => (ch === '#' ? 'obstacle' : ch === 'r' ? 'rock' : ch === 'o' ? 'hole' : 'floor')));
const open = (w: number, h: number) => grid(Array.from({ length: h }, () => '.'.repeat(w)));
const dist = (a: Cell, b: Cell) => Math.hypot(a.x - b.x, a.y - b.y);
const key = (c: Cell) => `${c.x},${c.y}`;

describe('planRootEruption', () => {
  it('sends a line of roots from beside the treant straight to the player in the open', () => {
    const tiles = open(26, 14);
    const cases: [Cell, Cell][] = [
      [{ x: 4, y: 7 }, { x: 20, y: 7 }],
      [{ x: 13, y: 2 }, { x: 13, y: 11 }],
      [{ x: 3, y: 2 }, { x: 15, y: 10 }],
      [{ x: 22, y: 12 }, { x: 10, y: 3 }],
    ];
    for (const [treant, player] of cases) {
      const [line] = planRootEruption(tiles, treant, player).lines;
      expect(line.map(key), `${key(treant)} -> ${key(player)}`).toContain(key(player));
      expect(dist(line[0], treant)).toBeLessThan(2);
      // Every step up to the player gets closer to them, without gaps.
      const upToPlayer = line.slice(0, line.findIndex((c) => key(c) === key(player)) + 1);
      upToPlayer.forEach((c, i) => {
        if (i === 0) return;
        expect(dist(c, player)).toBeLessThan(dist(upToPlayer[i - 1], player));
        expect(Math.max(Math.abs(c.x - upToPlayer[i - 1].x), Math.abs(c.y - upToPlayer[i - 1].y))).toBe(1);
      });
    }
  });

  it('fans every line out toward the player, never onto the treant itself', () => {
    const tiles = open(26, 14);
    const treant = { x: 5, y: 7 };
    const player = { x: 18, y: 4 };
    const attack = planRootEruption(tiles, treant, player);
    expect(attack.lines.length).toBeGreaterThan(1);
    for (const line of attack.lines) {
      expect(line.length).toBeGreaterThan(3);
      expect(line.some((c) => key(c) === key(treant))).toBe(false);
      expect(dist(line[line.length - 1], player)).toBeLessThan(dist(treant, player));
    }
  });

  it('stops each line at the first tile roots cannot burst from', () => {
    const tiles = grid([
      '..............',
      '..............',
      '..T.....#.....',
      '........#.....',
      '..............',
    ]);
    const treant = { x: 2, y: 2 };
    for (const blocker of ['#', 'r', 'o']) {
      const t = tiles.map((row) => row.map((tile) => (tile === 'obstacle' ? grid([blocker])[0][0] : tile)));
      const attack = planRootEruption(t, treant, { x: 12, y: 2 });
      const [line] = attack.lines;
      expect(line.length).toBeGreaterThan(0);
      expect(line.every((c) => c.x < 8), `blocker ${blocker}`).toBe(true);
      for (const l of attack.lines) for (const c of l) expect(t[c.y][c.x], `blocker ${blocker}`).toBe('floor');
    }
  });

  it('does not squeeze diagonally between two stones', () => {
    const tiles = grid([
      '......',
      '..#...',
      '.#....',
      '......',
      '......',
      '......',
    ]);
    const [line] = planRootEruption(tiles, { x: 0, y: 0 }, { x: 5, y: 5 }).lines;
    expect(line.some((c) => c.x >= 2 && c.y >= 2)).toBe(false);
  });

  it('stays inside the room', () => {
    const tiles = open(13, 7);
    const attack = planRootEruption(tiles, { x: 1, y: 1 }, { x: 11, y: 5 });
    for (const line of attack.lines) {
      for (const c of line) {
        expect(c.x >= 0 && c.y >= 0 && c.x < 13 && c.y < 7).toBe(true);
      }
    }
  });
});

describe('rootEruptionAt', () => {
  const attack = planRootEruption(open(26, 14), { x: 4, y: 7 }, { x: 20, y: 9 });
  const all = attack.lines.flat().map(key);

  it('only telegraphs at first, hurting nobody', () => {
    const at0 = rootEruptionAt(attack, 0);
    expect(at0.hurting).toEqual([]);
    expect([...new Set(at0.telegraph.map(key))].sort()).toEqual([...new Set(all)].sort());
  });

  it('never lets a cell hurt before it was telegraphed for the warning time', () => {
    const shownSince = new Map<string, number>();
    for (let t = 0; t <= attack.durationMs; t += 20) {
      const now = rootEruptionAt(attack, t);
      for (const c of now.telegraph) if (!shownSince.has(key(c))) shownSince.set(key(c), t);
      for (const c of now.hurting) {
        expect(shownSince.has(key(c)), `${key(c)} at ${t}`).toBe(true);
        expect(t - shownSince.get(key(c))!, `${key(c)} at ${t}`).toBeGreaterThanOrEqual(attack.telegraphMs);
      }
    }
  });

  it('erupts every cell at some point, then ends', () => {
    const erupted = new Set<string>();
    for (let t = 0; t <= attack.durationMs; t += 10) for (const c of rootEruptionAt(attack, t).hurting) erupted.add(key(c));
    expect([...erupted].sort()).toEqual([...new Set(all)].sort());
    const after = rootEruptionAt(attack, attack.durationMs + 1);
    expect(after.hurting).toEqual([]);
    expect(after.telegraph).toEqual([]);
  });
});
