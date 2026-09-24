import { ring } from './bulletPatterns';
import { STEP, type Cell, type Direction } from './floorGenerator';
import type { Door, Tile } from './roomGenerator';
import type { Worm } from './wormChain';
import type { Rng } from './rng';

/** Worm boss numbers; placeholders for playtest tuning. */
export const WORM_BOSS = {
  /** Shorter split pieces only crawl. */
  minAttackLength: 4,
  /** After it bursts out, this long before it may dive into a wall again. */
  burrowCooldownMs: 4000,
  /** From the last segment going under to bursting back out. */
  undergroundMs: 1500,
  /** The last stretch underground, while the exit lane is marked. */
  exitWarningMs: 1000,
  /** How long bursting out hurts along the lane. */
  burstMs: 350,
  /** While a piece is underground the screen shakes lightly: asked for this long, every frame, at this strength. */
  rumbleMs: 120,
  rumbleIntensity: 0.003,
  /** How many cells in front of the exit are marked and hurt as it bursts out. */
  laneLength: 3,
  /** The spit wave runs down the body one segment per this long. */
  spitGapMs: 70,
  /** In phase two it steps this much more often (a factor on its step time). */
  phaseTwoStepFactor: 0.65,
};

/** Whether a piece of the worm boss this many segments long still burrows and spits. */
export const canAttack = (length: number) => length >= WORM_BOSS.minAttackLength;

/** Phase two: the whole worm, all its pieces together, is down to half its hit points. */
export const inPhaseTwo = (hp: number, maxHp: number) => hp <= maxHp / 2;

/** Ground it can burst out through: floor, or rock it will smash. */
const diggable = (tile: Tile | undefined) => tile === 'floor' || tile === 'rock';
/** The next cell from `c` along `heading`. */
const ahead = (c: Cell, heading: Direction): Cell => ({ x: c.x + STEP[heading].x, y: c.y + STEP[heading].y });
const outside = (tiles: Tile[][], c: Cell) => c.y < 0 || c.x < 0 || c.y >= tiles.length || c.x >= tiles[0].length;

/**
 * The outer-wall cell the worm dives into on its next step, if it does: its head runs straight
 * at one of the room's four outer walls (not a doorway), the burrow cooldown is up, and the piece
 * is long enough to attack. Otherwise it crawls on and turns at the wall as usual.
 */
export function diveCell(worm: Worm, tiles: Tile[][], doors: Door[], now: number, readyAt: number): Cell | undefined {
  if (now < readyAt || !canAttack(worm.segments.length)) return undefined;
  const head = worm.segments[0];
  const wall = ahead(head, worm.heading);
  if (!outside(tiles, wall)) return undefined;
  if (doors.some((d) => d.side === worm.heading && d.cell.x === head.x && d.cell.y === head.y)) return undefined;
  return wall;
}

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export interface BurrowExit {
  /** The outer-wall cell it bursts out of. */
  exit: Cell;
  /** The way into the room from the exit. */
  heading: Direction;
  /** The cells in front of the exit, nearest first: marked, then hurt as it bursts through. */
  lane: Cell[];
  /** Rock in the lane, smashed as it bursts out. */
  breaks: Cell[];
}

/** How often a burrow comes back out of one of its old holes, when any can still be used. */
const HOLE_REUSE_CHANCE = 0.5;

/**
 * Where a burrowing worm comes back out: a spot on any of the room's outer walls whose lane runs
 * over floor or rock (never stone or a hole), away from the doorways. Half the time that is one
 * of its old `holes` (outer-wall cells), otherwise a random spot, which makes a new hole.
 */
export function planExit(tiles: Tile[][], doors: Door[], holes: Cell[], rng: Rng): BurrowExit {
  const height = tiles.length;
  const width = tiles[0].length;
  const edges: { cell: Cell; side: Direction }[] = [];
  for (let x = 0; x < width; x++) edges.push({ cell: { x, y: 0 }, side: 'up' }, { cell: { x, y: height - 1 }, side: 'down' });
  for (let y = 0; y < height; y++) edges.push({ cell: { x: 0, y }, side: 'left' }, { cell: { x: width - 1, y }, side: 'right' });
  const exits = edges.flatMap(({ cell, side }): BurrowExit[] => {
    if (doors.some((d) => d.side === side && d.cell.x === cell.x && d.cell.y === cell.y)) return [];
    const heading = OPPOSITE[side];
    const lane = Array.from({ length: WORM_BOSS.laneLength }, (_, i) => ({
      x: cell.x + STEP[heading].x * i,
      y: cell.y + STEP[heading].y * i,
    }));
    if (!lane.every((c) => diggable(tiles[c.y]?.[c.x]))) return [];
    return [{ exit: ahead(cell, side), heading, lane, breaks: lane.filter((c) => tiles[c.y][c.x] === 'rock') }];
  });
  const old = exits.filter((e) => holes.some((h) => h.x === e.exit.x && h.y === e.exit.y));
  return rng.pick(old.length && rng.next() < HOLE_REUSE_CHANCE ? old : exits);
}

export interface SpitShot {
  /** Index of the segment that fires, head first. */
  segment: number;
  /** When it fires, from the start of the wave. */
  atMs: number;
  angles: number[];
}

/**
 * A wave of spit running down the body: each segment in turn, head first, fires out of both
 * flanks, square to the way the body lies there (the heading where segments still share a cell).
 */
export function spitWave(segments: Cell[], heading: Direction): SpitShot[] {
  const differs = (a: Cell | undefined, b: Cell) => a !== undefined && (a.x !== b.x || a.y !== b.y);
  return segments.map((c, i) => {
    const neighbour = [segments[i - 1], segments[i + 1]].find((n) => differs(n, c));
    const along = neighbour ? Math.atan2(neighbour.y - c.y, neighbour.x - c.x) : Math.atan2(STEP[heading].y, STEP[heading].x);
    return { segment: i, atMs: i * WORM_BOSS.spitGapMs, angles: ring(2, along + Math.PI / 2) };
  });
}

export interface BurrowState {
  phase: 'rumbling' | 'warning' | 'bursting' | 'over';
  /** Cells marked as about to hurt. */
  marked: Cell[];
  hurting: Cell[];
  /** The exit wall spot, cracking while its lane is marked. */
  crack?: Cell;
}

/**
 * Where a burrow stands `elapsedMs` after the last segment went under: it rumbles, then the exit
 * lane is marked, then it bursts out and the lane hurts for a moment.
 */
export function burrowAt(plan: BurrowExit, elapsedMs: number): BurrowState {
  const { undergroundMs, exitWarningMs, burstMs } = WORM_BOSS;
  if (elapsedMs < undergroundMs - exitWarningMs) return { phase: 'rumbling', marked: [], hurting: [] };
  if (elapsedMs < undergroundMs) return { phase: 'warning', marked: plan.lane, hurting: [], crack: plan.exit };
  if (elapsedMs < undergroundMs + burstMs) return { phase: 'bursting', marked: [], hurting: plan.lane };
  return { phase: 'over', marked: [], hurting: [] };
}
