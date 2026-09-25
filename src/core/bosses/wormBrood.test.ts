import { describe, expect, it } from 'vitest';
import type { Cell } from '../map/floorGenerator';
import { createRng } from '../rng';
import type { Tile } from '../rooms/roomGenerator';
import { doorApproach } from '../rooms/roomValidator';
import { createWorld } from '../map/world';
import { broodTick, eggStage, planEggLob, WORM_BROOD, type BroodPiece } from './wormBrood';

/** The whole worm, before its split, out of the walls, with no brood about. */
const thrower = (over: Partial<BroodPiece> = {}): BroodPiece => ({ split: false, aboveGround: true, brood: 0, ...over });

/** Ticks the worm every 100ms from 0 to `untilMs`; returns each lob as [when, how many eggs]. */
function lobs(untilMs: number, piece: (now: number) => BroodPiece) {
  const thrown: [number, number][] = [];
  let nextLobAt: number | undefined;
  for (let now = 0; now <= untilMs; now += 100) {
    const tick = broodTick(nextLobAt, now, piece(now));
    nextLobAt = tick.nextLobAt;
    if (tick.eggs) thrown.push([now, tick.eggs]);
  }
  return thrown;
}

describe('worm boss eggs', () => {
  it('lobs two eggs four seconds into the fight, then every twelve seconds, before it splits', () => {
    expect(lobs(40500, () => thrower())).toEqual([
      [4000, 2],
      [16000, 2],
      [28000, 2],
      [40000, 2],
    ]);
  });

  it('lobs no more once it has split', () => {
    expect(lobs(40500, () => thrower({ split: true }))).toEqual([]);
    expect(lobs(40500, (now) => thrower({ split: now >= 7000 }))).toEqual([[4000, 2]]);
  });

  it('holds a lob that falls due while it rampages or is in the walls until it is back out', () => {
    expect(lobs(30500, (now) => thrower({ aboveGround: now < 3000 || now >= 6000 }))).toEqual([
      [6000, 2],
      [18000, 2],
      [30000, 2],
    ]);
  });

  it('keeps no more than two eggs and hatchlings about: one when one is left, none while two are', () => {
    expect(lobs(28500, () => thrower({ brood: 1 }))).toEqual([
      [4000, 1],
      [16000, 1],
      [28000, 1],
    ]);
    expect(lobs(28500, () => thrower({ brood: 2 }))).toEqual([]);
  });

  it('lobs as soon as the brood is down again after holding at the cap', () => {
    expect(lobs(21500, (now) => thrower({ brood: now < 9000 ? 2 : 0 }))).toEqual([
      [9000, 2],
      [21000, 2],
    ]);
  });
});

describe('worm boss egg lob landing', () => {
  const key = (c: Cell) => `${c.x},${c.y}`;
  /** The worm boss's arena on floor 2 of a run, with the worm's body as it lies at the start. */
  const arena = (seed: number) => {
    const room = [...createWorld(seed).rooms.values()].find((r) => r.floorRoom.kind === 'boss' && r.floorIndex === 1)!;
    const worm = room.layout.enemies[0];
    return { tiles: room.layout.tiles, doors: room.layout.doors, body: [worm.cell, ...(worm.tail ?? [])] };
  };
  const floorCells = (tiles: Tile[][]) => tiles.flatMap((row, y) => row.map((tile, x) => ({ x, y, tile }))).filter((c) => c.tile === 'floor');

  const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  it('lobs each egg from a segment of the worm to open floor 2 to 3 tiles from it, never beside the worm, on the player or on a door approach', () => {
    let landed = 0;
    const throwers = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const { tiles, doors, body } = arena(seed);
      const rng = createRng(seed);
      const approaches = new Set(doors.flatMap(doorApproach).map(key));
      const worm = new Set(body.map(key));
      for (const player of floorCells(tiles).filter((_, i) => i % 7 === 0)) {
        const eggs = planEggLob(tiles, doors, body, player, [], 2, rng);
        expect(eggs.length).toBeLessThanOrEqual(2);
        landed += eggs.length;
        expect(new Set(eggs.map(({ cell }) => key(cell))).size).toBe(eggs.length);
        for (const { from, cell } of eggs) {
          throwers.add(key(from));
          expect(worm.has(key(from))).toBe(true);
          expect(tiles[cell.y][cell.x], `seed ${seed} ${key(cell)}`).toBe('floor');
          expect(chebyshev(cell, from)).toBeGreaterThanOrEqual(2);
          expect(chebyshev(cell, from)).toBeLessThanOrEqual(3);
          expect(key(cell)).not.toBe(key(player));
          expect(Math.min(...body.map((b) => chebyshev(cell, b))), `seed ${seed} ${key(cell)}`).toBeGreaterThanOrEqual(2);
          expect(approaches.has(key(cell)), `seed ${seed} ${key(cell)}`).toBe(false);
        }
      }
    }
    expect(landed).toBeGreaterThan(0);
    // Any segment may throw, not just the head.
    expect(throwers.size).toBeGreaterThan(10);
  });

  it('pays the player no mind: where the eggs can land does not depend on where they stand', () => {
    const { tiles, doors, body } = arena(3);
    const spots = (player: Cell) => {
      const rng = createRng(9);
      return new Set(Array.from({ length: 200 }, () => planEggLob(tiles, doors, body, player, [], 2, rng)).flat().map(({ cell }) => key(cell)));
    };
    const far = spots({ x: 0, y: 0 });
    const corner = { x: tiles[0].length - 1, y: tiles.length - 1 };
    expect([...spots(corner)].every((c) => far.has(c) || c === key({ x: 0, y: 0 }))).toBe(true);
  });

  it('lobs fewer when there is no open floor left around the worm, each egg on a cell of its own, never on one taken', () => {
    // `.` floor, `r` rock: the worm lies on 1,1 and 2,1; 4,1 is 2-3 tiles away, 5,1 too but an egg is already there.
    const tiles: Tile[][] = ['rrrrrrrr', 'r......r', 'rrrrrrrr'].map((row) => [...row].map((ch): Tile => (ch === 'r' ? 'rock' : 'floor')));
    const eggs = planEggLob(tiles, [], [{ x: 1, y: 1 }, { x: 2, y: 1 }], { x: 6, y: 1 }, [{ x: 5, y: 1 }], 2, createRng(1));
    expect(eggs.map(({ cell }) => cell)).toEqual([{ x: 4, y: 1 }]);
  });
});

describe('worm boss egg hatching', () => {
  const { hatchMs, wobbleMs } = WORM_BROOD;

  it('rests, wobbles for its last stretch, then hatches', () => {
    expect(eggStage(1000, 1000)).toBe('resting');
    expect(eggStage(1000, 1000 + hatchMs - wobbleMs - 1)).toBe('resting');
    expect(eggStage(1000, 1000 + hatchMs - wobbleMs)).toBe('wobbling');
    expect(eggStage(1000, 1000 + hatchMs - 1)).toBe('wobbling');
    expect(eggStage(1000, 1000 + hatchMs)).toBe('hatched');
  });
});
