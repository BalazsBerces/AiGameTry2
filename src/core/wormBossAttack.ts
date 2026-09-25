import { ring } from './bulletPatterns';
import { DIRECTIONS, STEP, type Cell, type Direction } from './floorGenerator';
import type { Door, Tile } from './roomGenerator';
import { isWalkable } from './tiles';
import { createWorm, stepWorm, type Worm } from './wormChain';
import type { Rng } from './rng';

/** Worm boss numbers; placeholders for playtest tuning. */
export const WORM_BOSS = {
  /** Shorter split pieces only crawl. */
  minAttackLength: 4,
  /** It can't split until it has lost this share of its hit points. */
  splitAfterShare: 0.2,
  /**
   * Rocks shaken loose as a lunge tunnels into a wall, on one cooldown shared by every piece: this
   * many, within this many tiles of the player, each marked by its shadow for `rockShadowMs`.
   */
  rockfallCooldownMs: 6000,
  rockfallCount: 3,
  rockfallRadius: 3,
  rockShadowMs: 1000,
  /**
   * Every piece rampages together, first this long into the fight and then this long after each
   * rampage ends: it charges up, then lunges this many times, pausing between lunges, and lies
   * dazed at the end.
   */
  rampageEveryMs: 12000,
  rampageChargeMs: 1200,
  rampageLunges: 5,
  lungeStepMs: 55,
  /** The warning crack flows out along a lunge's path one cell per this long, from the start of the pause before it. */
  crackStepMs: 25,
  lungePauseMs: 300,
  rampageDazeMs: 1000,
  /** A lunge into rock takes this share of its hit points. */
  lungeRockShare: 0.5,
  /** The spit wave runs down the body one segment per this long. */
  spitGapMs: 70,
  /** In phase two it steps this much more often (a factor on its step time). */
  phaseTwoStepFactor: 0.65,
};

/** Whether a piece of the worm boss this many segments long still burrows and spits. */
export const canAttack = (length: number) => length >= WORM_BOSS.minAttackLength;

/**
 * Whether a blow to segment `index` of the whole worm boss (`length` long, down to `hp` of its
 * `maxHp`) splits it: only once it has lost its share of hit points, and only in its middle,
 * never at its head or tail. Until then no segment breaks; every hit just drains its hit points.
 */
export const splitsAt = (hp: number, maxHp: number, index: number, length: number) =>
  maxHp - hp >= maxHp * WORM_BOSS.splitAfterShare && index > 0 && index < length - 1;

/** The hit points it has left, shared between its two halves by their length. */
export const halfPools = (hp: number, lengths: number[]) => lengths.map((n) => (hp * n) / lengths.reduce((a, b) => a + b, 0));

/** A hit on a half of the split boss: it drains the half's pool, and the half is done for once it is empty. */
export function absorbHit(pool: number, damage: number): { pool: number; breaks: boolean } {
  const left = Math.max(0, pool - damage);
  return { pool: left, breaks: left === 0 };
}

/** Phase two: the whole worm, all its pieces together, is down to half its hit points. */
export const inPhaseTwo = (hp: number, maxHp: number) => hp <= maxHp / 2;

/** The next cell from `c` along `heading`. */
const ahead = (c: Cell, heading: Direction): Cell => ({ x: c.x + STEP[heading].x, y: c.y + STEP[heading].y });
const outside = (tiles: Tile[][], c: Cell) => c.y < 0 || c.x < 0 || c.y >= tiles.length || c.x >= tiles[0].length;

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

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

/**
 * Where rocks fall: one on the player and the rest on open floor around them, never on `avoid`
 * (the worm's own cells) or on a door's cell.
 */
export function planRockfall(tiles: Tile[][], player: Cell, avoid: Cell[], doors: Door[], rng: Rng): Cell[] {
  const same = (a: Cell) => (b: Cell) => a.x === b.x && a.y === b.y;
  const open = (c: Cell) => tiles[c.y]?.[c.x] === 'floor' && !avoid.some(same(c)) && !doors.some((d) => same(c)(d.cell));
  const { rockfallRadius: r, rockfallCount } = WORM_BOSS;
  const around: Cell[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const c = { x: player.x + dx, y: player.y + dy };
      if ((dx || dy) && open(c)) around.push(c);
    }
  }
  const cells = open(player) ? [player] : [];
  while (cells.length < rockfallCount && around.length) cells.push(around.splice(rng.int(0, around.length - 1), 1)[0]);
  return cells;
}

/** A falling rock `elapsedMs` after it was shaken loose: its shadow grows (0 to 1) until it lands. */
export function rockfallAt(elapsedMs: number): { shadow: number; landed: boolean } {
  return { shadow: Math.min(1, elapsedMs / WORM_BOSS.rockShadowMs), landed: elapsedMs >= WORM_BOSS.rockShadowMs };
}

export interface Lunge {
  heading: Direction;
  /** The cells the head races through, nearest first (through the walls too, if it tunnels). */
  path: Cell[];
  /** Rocks on the path it bursts straight through, smashing them: the first on each side of the walls. */
  bursts: Cell[];
  /** It tunnels into the outer wall at `entry` and out of another wall at `exit`, racing on along `heading`. */
  wrap?: { entry: Cell; exit: Cell; heading: Direction };
  /** What it runs into at the end, inside the room (rock takes a blow); none at the outer wall. */
  stop?: Cell;
}

/** A straight run from `from` over floor, bursting through the first rock; `end` is what stops it. */
function straightRun(tiles: Tile[][], from: Cell, heading: Direction) {
  const path: Cell[] = [];
  let burst: Cell | undefined;
  let at = from;
  for (;;) {
    const tile = tiles[at.y]?.[at.x];
    if (tile === 'rock' && !burst) burst = at;
    else if (tile !== 'floor') break;
    path.push(at);
    at = ahead(at, heading);
  }
  return { path, burst, end: at };
}

const isDoorway = (doors: Door[], cell: Cell, side: Direction) =>
  doors.some((d) => d.side === side && d.cell.x === cell.x && d.cell.y === cell.y);

/**
 * Where a lunge that tunnelled into the `entered` wall comes out: a random spot on one of the
 * other three outer walls, never a doorway, with floor or rock to race on into.
 */
function randomExit(tiles: Tile[][], doors: Door[], entered: Direction, rng: Rng): { exit: Cell; heading: Direction } | undefined {
  const height = tiles.length;
  const width = tiles[0].length;
  const edge = (side: Direction): Cell[] =>
    side === 'up' || side === 'down'
      ? Array.from({ length: width }, (_, x) => ({ x, y: side === 'up' ? 0 : height - 1 }))
      : Array.from({ length: height }, (_, y) => ({ x: side === 'left' ? 0 : width - 1, y }));
  const exits = DIRECTIONS.filter((side) => side !== entered).flatMap((side) =>
    edge(side)
      .filter((c) => !isDoorway(doors, c, side) && (tiles[c.y][c.x] === 'floor' || tiles[c.y][c.x] === 'rock'))
      .map((c) => ({ exit: ahead(c, side), heading: OPPOSITE[side] })),
  );
  return exits.length ? rng.pick(exits) : undefined;
}

/**
 * One lunge of a rampage: straight along one of the four lines from the head (never back into
 * its own neck), over open floor, bursting through the first rock in its way, until it runs into
 * anything else. It takes the line that brings it closest to the player, the longer run on a
 * tie; none if every line is blocked at once.
 */
export function planLunge(tiles: Tile[][], doors: Door[], worm: Worm, player: Cell, rng: Rng): Lunge | undefined {
  const [head, neck] = worm.segments;
  const manhattan = (a: Cell) => Math.abs(a.x - player.x) + Math.abs(a.y - player.y);
  const lunges = DIRECTIONS.flatMap((heading) => {
    const first = ahead(head, heading);
    if (neck && first.x === neck.x && first.y === neck.y) return [];
    const lunge = lungeFrom(tiles, doors, head, heading, rng);
    const inRoom = lunge.path.filter((c) => !outside(tiles, c));
    return inRoom.length ? [{ lunge, closest: Math.min(...inRoom.map(manhattan)) }] : [];
  });
  return lunges.sort((a, b) => a.closest - b.closest || b.lunge.path.length - a.lunge.path.length)[0]?.lunge;
}

/**
 * The lunge from `head` along `heading`: over floor, bursting through the first rock, until it
 * runs into anything. Running into an outer wall (not a doorway) it tunnels through, once: out of
 * a random spot on another wall, and on into the room from there.
 */
export function lungeFrom(tiles: Tile[][], doors: Door[], head: Cell, heading: Direction, rng: Rng): Lunge {
  const before = straightRun(tiles, ahead(head, heading), heading);
  let path = before.path;
  const bursts = before.burst ? [before.burst] : [];
  let end = before.end;
  let wrap: Lunge['wrap'];
  const out = outside(tiles, end) && !isDoorway(doors, ahead(end, OPPOSITE[heading]), heading) ? randomExit(tiles, doors, heading, rng) : undefined;
  if (out) {
    const after = straightRun(tiles, ahead(out.exit, out.heading), out.heading);
    wrap = { entry: end, exit: out.exit, heading: out.heading };
    path = [...path, end, out.exit, ...after.path];
    if (after.burst) bursts.push(after.burst);
    end = after.end;
  }
  return { heading, path, bursts, wrap, stop: outside(tiles, end) ? undefined : end };
}

/**
 * A boxed-in worm boss breaks out instead of turning back: with nowhere to crawl, the rock next
 * to its head that it smashes (straight ahead first). None while it has a way to go.
 */
export function breakOut(worm: Worm, tiles: Tile[][]): Cell | undefined {
  const head = worm.segments[0];
  // The tail's cell is free by the time the head moves, as in stepWorm.
  const body = worm.segments.slice(0, -1);
  const around = [worm.heading, ...DIRECTIONS.filter((d) => d !== worm.heading)]
    .map((d) => ahead(head, d))
    .filter((c) => !body.some((b) => b.x === c.x && b.y === c.y));
  const tile = (c: Cell) => tiles[c.y]?.[c.x];
  if (around.some((c) => tile(c) !== undefined && isWalkable(tile(c)!))) return undefined;
  return around.find((c) => tile(c) === 'rock');
}

/**
 * The boss's crawl step: like any worm's, except that it never turns back while part of it is
 * still in a wall hole (its head would dive back into the hole, and it could flip there for
 * good). Boxed in then, it crawls over its own body instead.
 */
export function bossCrawl(worm: Worm, tiles: Tile[][], rng: Rng, turnChance?: number): Worm {
  const walkable = (c: Cell) => {
    const tile = tiles[c.y]?.[c.x];
    return tile !== undefined && isWalkable(tile);
  };
  const next = stepWorm(worm, rng, (c) => !walkable(c), turnChance);
  const [head, neck] = worm.segments;
  const turnedBack = next.segments[1] && (next.segments[1].x !== head.x || next.segments[1].y !== head.y);
  if (!turnedBack || !worm.segments.some((c) => outside(tiles, c))) return next;
  const over = [worm.heading, ...DIRECTIONS.filter((d) => d !== worm.heading)].find((d) => {
    const c = ahead(head, d);
    return walkable(c) && !(neck && c.x === neck.x && c.y === neck.y);
  });
  return over ? createWorm([ahead(head, over), ...worm.segments.slice(0, -1)], over) : next;
}

/**
 * How far a lunge's warning crack has flowed out of the head `elapsedMs` after it started (as the
 * pause before the lunge began): the cells it has crossed whole, and the one it is part way
 * through (`share`). It flows on at a steady pace through the lunge, ahead of the worm.
 */
export function lungeCracks(lunge: Lunge, elapsedMs: number): { whole: Cell[]; tip?: { cell: Cell; share: number } } {
  const reach = Math.min(lunge.path.length, Math.max(0, elapsedMs / WORM_BOSS.crackStepMs));
  const whole = lunge.path.slice(0, Math.floor(reach));
  const cell = lunge.path[whole.length];
  return { whole, tip: cell && { cell, share: reach - whole.length } };
}
