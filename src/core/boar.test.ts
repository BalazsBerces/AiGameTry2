import { describe, expect, it } from 'vitest';
import { BOAR, createBoar, updateBoar, type Boar, type BoarSenses } from './boar';
import type { Cell } from './floorGenerator';
import type { Tile } from './roomGenerator';

const TILE: Record<string, Tile> = { '.': 'floor', B: 'floor', '#': 'obstacle', r: 'rock', o: 'hole', t: 'thorn' };

/** An ASCII room: `B` is the boar on floor, `#` stone, `r` rock, `o` a hole, `t` a thorn bush. */
function room(rows: string[]) {
  const tiles = rows.map((row) => [...row].map((ch) => TILE[ch]));
  const y = rows.findIndex((row) => row.includes('B'));
  return { tiles, boar: { x: rows[y].indexOf('B'), y } };
}

const senses = (tiles: Tile[][], at: Cell, time: number, toPlayer = { x: 3, y: 0 }, more: Partial<BoarSenses> = {}): BoarSenses => ({
  time,
  at,
  toPlayer,
  canSeePlayer: true,
  tiles,
  ...more,
});

/** Lets a fresh boar spot the player and finish winding up: it is dashing at the returned time. */
function charge(rows: string[], toPlayer = { x: 3, y: 0 }) {
  const { tiles, boar: at } = room(rows);
  let boar: Boar = createBoar(0);
  boar = updateBoar(boar, senses(tiles, at, BOAR.idleMs, toPlayer)).boar;
  const time = BOAR.idleMs + BOAR.windUpMs;
  boar = updateBoar(boar, senses(tiles, at, time, toPlayer)).boar;
  return { tiles, at, boar, time };
}

describe('boar charge', () => {
  it('winds up before it dashes, and only once it has rested', () => {
    const { tiles, boar: at } = room(['B.....']);
    let boar = createBoar(0);
    boar = updateBoar(boar, senses(tiles, at, BOAR.idleMs - 1)).boar;
    expect(boar.mode).toBe('idle');
    boar = updateBoar(boar, senses(tiles, at, BOAR.idleMs)).boar;
    expect(boar.mode).toBe('windUp');
    boar = updateBoar(boar, senses(tiles, at, BOAR.idleMs + BOAR.windUpMs - 1)).boar;
    expect(boar.mode).toBe('windUp');
    boar = updateBoar(boar, senses(tiles, at, BOAR.idleMs + BOAR.windUpMs)).boar;
    expect(boar.mode).toBe('dash');
  });

  it('does not wind up at a player it cannot see, or who is not lined up with it', () => {
    const { tiles, boar: at } = room(['B.....', '......', '......']);
    const hidden = updateBoar(createBoar(0), senses(tiles, at, BOAR.idleMs, { x: 3, y: 0 }, { canSeePlayer: false }));
    expect(hidden.boar.mode).toBe('idle');
    const diagonal = updateBoar(createBoar(0), senses(tiles, at, BOAR.idleMs, { x: 2, y: 2 }));
    expect(diagonal.boar.mode).toBe('idle');
  });

  it('dashes straight along the axis the player is on', () => {
    const down = charge(['B', '.', '.', '.', '#'], { x: 0.3, y: 3 });
    expect(down.boar.mode === 'dash' && down.boar.direction).toEqual({ x: 0, y: 1 });
    const left = charge(['..B'], { x: -2, y: 0 });
    expect(left.boar.mode === 'dash' && left.boar.direction).toEqual({ x: -1, y: 0 });
  });

  it('stops at the first blocking tile in its path', () => {
    expect(charge(['B...#..#']).boar).toMatchObject({ mode: 'dash', stop: { x: 3, y: 0 } });
    expect(charge(['B.o...']).boar).toMatchObject({ mode: 'dash', stop: { x: 1, y: 0 } });
    expect(charge(['B.....']).boar).toMatchObject({ mode: 'dash', stop: { x: 5, y: 0 } });
    expect(charge(['B#....']).boar).toMatchObject({ mode: 'dash', stop: { x: 0, y: 0 } });
  });

  it('is stunned for a while when it runs into stone, then goes back to idle', () => {
    const { tiles, boar, time } = charge(['B...#']);
    const stop = { x: 3, y: 0 };
    const hit = updateBoar(boar, senses(tiles, stop, time + 100, undefined, { arrived: true }));
    expect(hit.boar.mode).toBe('stunned');
    expect(hit.stunMs).toBeGreaterThan(0);
    expect(hit.smashed).toBeUndefined();
    const still = updateBoar(hit.boar, senses(tiles, stop, time + 100 + hit.stunMs! - 1));
    expect(still.boar.mode).toBe('stunned');
    const after = updateBoar(hit.boar, senses(tiles, stop, time + 100 + hit.stunMs!));
    expect(after.boar.mode).toBe('idle');
  });

  it('is stunned by rock too, and smashes it', () => {
    const { tiles, boar, time } = charge(['B..r.']);
    const hit = updateBoar(boar, senses(tiles, { x: 2, y: 0 }, time + 100, undefined, { arrived: true }));
    expect(hit.boar.mode).toBe('stunned');
    expect(hit.stunMs).toBeGreaterThan(0);
    expect(hit.smashed).toEqual({ x: 3, y: 0 });
  });

  it('is stunned by the room wall at the end of its run', () => {
    const { tiles, boar, time } = charge(['B...']);
    const hit = updateBoar(boar, senses(tiles, { x: 3, y: 0 }, time + 100, undefined, { arrived: true }));
    expect(hit.boar.mode).toBe('stunned');
    expect(hit.smashed).toBeUndefined();
  });

  it('pulls up short of a hole or thorn bush without being stunned', () => {
    for (const rows of [['B..o.'], ['B..t.']]) {
      const { tiles, boar, time } = charge(rows);
      const hit = updateBoar(boar, senses(tiles, { x: 2, y: 0 }, time + 100, undefined, { arrived: true }));
      expect(hit.boar.mode, rows[0]).toBe('idle');
      expect(hit.stunMs, rows[0]).toBeUndefined();
      expect(hit.smashed, rows[0]).toBeUndefined();
    }
  });

  it('keeps dashing until it arrives', () => {
    const { tiles, boar, time } = charge(['B...#']);
    const running = updateBoar(boar, senses(tiles, { x: 1, y: 0 }, time + 100));
    expect(running.boar.mode).toBe('dash');
  });

  it('gives up a dash that something holds up for too long, unstunned', () => {
    const { tiles, boar, time } = charge(['B...#']);
    const stuck = updateBoar(boar, senses(tiles, { x: 1, y: 0 }, time + BOAR.maxDashMs));
    expect(stuck.boar.mode).toBe('idle');
    expect(stuck.stunMs).toBeUndefined();
  });

  it('rests before it can charge again', () => {
    const { tiles, boar, time } = charge(['B..o.']);
    const done = updateBoar(boar, senses(tiles, { x: 2, y: 0 }, time + 100, undefined, { arrived: true })).boar;
    expect(updateBoar(done, senses(tiles, { x: 2, y: 0 }, time + 101, { x: -2, y: 0 })).boar.mode).toBe('idle');
    expect(updateBoar(done, senses(tiles, { x: 2, y: 0 }, time + 100 + BOAR.idleMs, { x: -2, y: 0 })).boar.mode).toBe('windUp');
  });
});
