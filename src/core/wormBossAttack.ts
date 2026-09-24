import { ring } from './bulletPatterns';
import { STEP, type Cell, type Direction } from './floorGenerator';
import type { Tile } from './roomGenerator';
import type { Rng } from './rng';

/** Worm boss numbers; placeholders for playtest tuning. */
export const WORM_BOSS = {
  /** Shorter split pieces only crawl. */
  minAttackLength: 4,
  /** How far from the player (in steps) it may surface. */
  surfaceDistance: { min: 2, max: 4 },
  /** Rocks come down this many tiles around the exit. */
  rockfallRadius: 2,
  rockfallCount: 7,
  /** How long the exit is marked before it bursts out. */
  surfaceTelegraphMs: 1100,
  /** How long bursting out hurts on the exit cell. */
  eruptMs: 350,
  /** Falling rocks: marked from the moment it bursts out, then hurt for a moment as they land. */
  rockTelegraphMs: 800,
  rockHurtMs: 300,
  /** The spit wave runs down the body one segment per this long. */
  spitGapMs: 70,
  /** Each piece that can attack alternates spitting and burrowing, one attack per this long. */
  attackEveryMs: 3000,
  /** In phase two it steps this much more often (a factor on its step time). */
  phaseTwoStepFactor: 0.65,
};

/** Whether a piece of the worm boss this many segments long still burrows and spits. */
export const canAttack = (length: number) => length >= WORM_BOSS.minAttackLength;

/** Phase two: the whole worm, all its pieces together, is down to half its hit points. */
export const inPhaseTwo = (hp: number, maxHp: number) => hp <= maxHp / 2;

export interface Burrow {
  /** Where the head bursts out. */
  surface: Cell;
  /** The cells it tunnels through, from where it dived to `surface`. */
  tunnel: Cell[];
  /** Rock it breaks for good: along the tunnel and around the exit. */
  breaks: Cell[];
  /** Cells rocks fall on around the exit when it bursts out. */
  rockfall: Cell[];
}

const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
/** Ground it can dig through or come up in: floor, or rock it will break. */
const diggable = (tile: Tile | undefined) => tile === 'floor' || tile === 'rock';

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A straight-legged path from `from` to `to`, one leg along each axis, picked at random. */
function tunnelBetween(from: Cell, to: Cell, rng: Rng): Cell[] {
  const path = [{ ...from }];
  const at = { ...from };
  const legs: ('x' | 'y')[] = rng.next() < 0.5 ? ['x', 'y'] : ['y', 'x'];
  for (const axis of legs) {
    while (at[axis] !== to[axis]) {
      at[axis] += Math.sign(to[axis] - at[axis]);
      path.push({ ...at });
    }
  }
  return path;
}

/**
 * The worm dives at `head` and comes up near the player: a spot two to four steps from them,
 * on ground it can dig, off the room's edge. It breaks the rock along its tunnel and around
 * the exit, and rocks rain down on cells around the exit.
 */
export function planBurrow(tiles: Tile[][], head: Cell, player: Cell, rng: Rng): Burrow {
  const height = tiles.length;
  const width = tiles[0].length;
  const inside: Cell[] = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) if (diggable(tiles[y][x])) inside.push({ x, y });
  const { min, max } = WORM_BOSS.surfaceDistance;
  const near = inside.filter((c) => manhattan(c, player) >= min && manhattan(c, player) <= max);
  const surface = near.length
    ? rng.pick(near)
    : inside.sort((a, b) => Math.abs(manhattan(a, player) - min) - Math.abs(manhattan(b, player) - min))[0] ?? head;
  const tunnel = tunnelBetween(head, surface, rng);
  const isRock = (c: Cell) => tiles[c.y]?.[c.x] === 'rock';
  const seen = new Set<string>();
  const breaks = [...tunnel, ...inside.filter((c) => chebyshev(c, surface) <= 1)].filter((c) => {
    const k = `${c.x},${c.y}`;
    if (!isRock(c) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const ring = inside.filter((c) => {
    const d = chebyshev(c, surface);
    return d >= 1 && d <= WORM_BOSS.rockfallRadius;
  });
  const rockfall = shuffled(ring, rng).slice(0, WORM_BOSS.rockfallCount);
  return { surface, tunnel, breaks, rockfall };
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
  /** Still under the ground: it can't be hit and hurts no one by touch. */
  underground: boolean;
  /** Cells marked as about to hurt. */
  warning: Cell[];
  hurting: Cell[];
  over: boolean;
}

/** Where a burrow stands `elapsedMs` after the dive: the exit is marked, bursts, then the rocks fall. */
export function burrowAt(burrow: Burrow, elapsedMs: number): BurrowState {
  const { surfaceTelegraphMs, eruptMs, rockTelegraphMs, rockHurtMs } = WORM_BOSS;
  if (elapsedMs < surfaceTelegraphMs) return { underground: true, warning: [burrow.surface], hurting: [], over: false };
  const since = elapsedMs - surfaceTelegraphMs;
  const erupting = since < eruptMs ? [burrow.surface] : [];
  if (since < rockTelegraphMs) return { underground: false, warning: burrow.rockfall, hurting: erupting, over: false };
  if (since < rockTelegraphMs + rockHurtMs) return { underground: false, warning: [], hurting: burrow.rockfall, over: false };
  return { underground: false, warning: [], hurting: [], over: true };
}
