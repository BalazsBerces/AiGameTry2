import { describe, expect, it } from 'vitest';
import type { Cell } from './floorGenerator';
import { createRng } from './rng';
import type { Tile } from './roomGenerator';
import { doorApproach } from './roomValidator';
import { createWorld } from './world';
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
  it('lobs two eggs every five seconds before it splits, the first a full interval in', () => {
    expect(lobs(15500, () => thrower())).toEqual([
      [5000, 2],
      [10000, 2],
      [15000, 2],
    ]);
  });

  it('lobs no more once it has split', () => {
    expect(lobs(15500, () => thrower({ split: true }))).toEqual([]);
    expect(lobs(15500, (now) => thrower({ split: now >= 7000 }))).toEqual([[5000, 2]]);
  });

  it('holds a lob that falls due while it rampages or is in the walls until it is back out', () => {
    expect(lobs(12500, (now) => thrower({ aboveGround: now < 4000 || now >= 7000 }))).toEqual([
      [7000, 2],
      [12000, 2],
    ]);
  });

  it('lobs only as many as there is room for under the cap of eggs and hatchlings', () => {
    const { cap } = WORM_BROOD;
    expect(cap).toBe(4);
    expect(lobs(10500, () => thrower({ brood: 3 }))).toEqual([
      [5000, 1],
      [10000, 1],
    ]);
  });

  it('holds its lob while the cap is full, and lobs as soon as one is gone', () => {
    expect(lobs(12500, () => thrower({ brood: 4 }))).toEqual([]);
    expect(lobs(12500, (now) => thrower({ brood: now < 6000 ? 4 : 2 }))).toEqual([
      [6000, 2],
      [11000, 2],
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

  it('lands eggs on open floor near the player, never on them, the worm or a door approach', () => {
    let landed = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { tiles, doors, body } = arena(seed);
      const rng = createRng(seed);
      const approaches = new Set(doors.flatMap(doorApproach).map(key));
      const worm = new Set(body.map(key));
      for (const player of floorCells(tiles).filter((_, i) => i % 7 === 0)) {
        const eggs = planEggLob(tiles, doors, player, body, 2, rng);
        expect(eggs.length).toBeLessThanOrEqual(2);
        landed += eggs.length;
        expect(new Set(eggs.map(key)).size).toBe(eggs.length);
        for (const c of eggs) {
          expect(tiles[c.y][c.x], `seed ${seed} ${key(c)}`).toBe('floor');
          expect(Math.max(Math.abs(c.x - player.x), Math.abs(c.y - player.y))).toBeLessThanOrEqual(WORM_BROOD.lobSpread);
          expect(key(c)).not.toBe(key(player));
          expect(worm.has(key(c)), `seed ${seed} ${key(c)}`).toBe(false);
          expect(approaches.has(key(c)), `seed ${seed} ${key(c)}`).toBe(false);
        }
      }
    }
    expect(landed).toBeGreaterThan(0);
  });

  it('lobs fewer when there is no more open floor near the player, each egg on a cell of its own', () => {
    // `.` floor, `r` rock: the player at 2,1 has one free cell beside it, 3,1; the worm lies on 1,1.
    const tiles: Tile[][] = ['rrrrrrr', 'r...rrr', 'rrrrrrr'].map((row) => [...row].map((ch): Tile => (ch === 'r' ? 'rock' : 'floor')));
    expect(planEggLob(tiles, [], { x: 2, y: 1 }, [{ x: 1, y: 1 }], 2, createRng(1))).toEqual([{ x: 3, y: 1 }]);
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
