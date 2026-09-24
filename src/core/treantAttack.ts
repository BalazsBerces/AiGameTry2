import { cellKey, type Cell } from './floorGenerator';
import type { Rng } from './rng';
import type { Door, Tile } from './roomGenerator';
import { doorApproach } from './roomValidator';
import { isWalkable } from './tiles';

/** Root eruption timing and shape; all numbers are placeholders for playtest tuning. */
export const ROOTS = {
  /** Directions of the lines relative to the player, in radians: one straight at them, two flanking. */
  fan: [0, -0.35, 0.35],
  /** How far past the player a line keeps going, in tiles. */
  overshoot: 2,
  /** How long every cell is telegraphed before it can erupt. */
  telegraphMs: 800,
  /** Delay between neighbouring cells erupting, so the roots travel outward. */
  stepMs: 45,
  /** How long an erupted cell hurts. */
  lingerMs: 450,
};

export interface RootEruption {
  /** Cells of each line in eruption order, nearest the treant first. */
  lines: Cell[][];
  telegraphMs: number;
  stepMs: number;
  lingerMs: number;
  /** Time from the start of the attack until the last root has sunk back. */
  durationMs: number;
}

/**
 * Walks from the centre of `from` in direction `angle`, collecting each tile it enters until it
 * reaches `length` tiles or a tile roots cannot burst from (anything not walkable, or the room edge).
 */
function rootLine(tiles: Tile[][], from: Cell, angle: number, length: number): Cell[] {
  const cells: Cell[] = [];
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const open = (c: Cell) => {
    const tile = tiles[c.y]?.[c.x];
    return tile !== undefined && isWalkable(tile);
  };
  let last = from;
  for (let s = 0; s <= length; s += 0.1) {
    const c = { x: Math.floor(from.x + 0.5 + dx * s), y: Math.floor(from.y + 0.5 + dy * s) };
    if (c.x === last.x && c.y === last.y) continue;
    if (!open(c)) break;
    // A diagonal step may not slip between two blocked corners.
    if (c.x !== last.x && c.y !== last.y && !open({ x: c.x, y: last.y }) && !open({ x: last.x, y: c.y })) break;
    cells.push(c);
    last = c;
  }
  return cells;
}

/**
 * Plans a root eruption from the treant at `treant` aimed at the player at `player`: a fan of
 * lines, the first straight at the player, each stopping at stone, rock, holes or walls.
 */
export function planRootEruption(tiles: Tile[][], treant: Cell, player: Cell): RootEruption {
  const aim = Math.atan2(player.y - treant.y, player.x - treant.x);
  const length = Math.hypot(player.x - treant.x, player.y - treant.y) + ROOTS.overshoot;
  const lines = ROOTS.fan.map((offset) => rootLine(tiles, treant, aim + offset, length)).filter((l) => l.length);
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const { telegraphMs, stepMs, lingerMs } = ROOTS;
  return { lines, telegraphMs, stepMs, lingerMs, durationMs: telegraphMs + Math.max(0, longest - 1) * stepMs + lingerMs };
}

/** What the attack shows `elapsedMs` after it started: cells still warning, and cells erupting now. */
export function rootEruptionAt(attack: RootEruption, elapsedMs: number): { telegraph: Cell[]; hurting: Cell[] } {
  const telegraph: Cell[] = [];
  const hurting: Cell[] = [];
  for (const line of attack.lines) {
    line.forEach((c, i) => {
      const eruptAt = attack.telegraphMs + i * attack.stepMs;
      if (elapsedMs < eruptAt) telegraph.push(c);
      else if (elapsedMs < eruptAt + attack.lingerMs) hurting.push(c);
    });
  }
  return { telegraph, hurting };
}

/** Seed pod volleys; all numbers are placeholders for playtest tuning. */
export const SEEDS = {
  /** Pods per volley (fewer if there aren't enough spots). */
  count: 3,
  /** Pods come down this many tiles (8-way) around the player, hemming them in. */
  spread: 3,
  /** Chance a pod sprouts thorn rather than rock. */
  thornChance: 0.4,
  /** Time a pod spends in the air; its landing spot is shadowed on the ground meanwhile. */
  flightMs: 900,
  /** Pause after landing before the treant moves on. */
  settleMs: 250,
};

export type Sprout = 'rock' | 'thorn';

export interface SeedPod {
  cell: Cell;
  sprout: Sprout;
}

export interface SeedVolley {
  pods: SeedPod[];
  flightMs: number;
  /** Time from the throw until the treant is ready for its next attack. */
  durationMs: number;
}

/**
 * Plans a volley of seed pods lobbed around the player. A pod only comes down on floor with
 * walkable ground on all 8 sides (counting the volley's earlier pods), never on the player's
 * tile, beside the treant, or on a door's approach. The ring of open ground around each sprout
 * means it can never cut any walkable tile, door or the treant off from the rest of the room.
 */
export function planSeedVolley(tiles: Tile[][], doors: Door[], treant: Cell, player: Cell, rng: Rng): SeedVolley {
  const planned = tiles.map((row) => [...row]);
  const approaches = new Set(doors.flatMap(doorApproach).map(cellKey));
  const walkableAt = (c: Cell) => {
    const tile = planned[c.y]?.[c.x];
    return tile !== undefined && isWalkable(tile);
  };
  const openAround = (c: Cell) => [-1, 0, 1].every((dx) => [-1, 0, 1].every((dy) => walkableAt({ x: c.x + dx, y: c.y + dy })));
  const landable = (c: Cell) =>
    planned[c.y]?.[c.x] === 'floor' &&
    !(c.x === player.x && c.y === player.y) &&
    Math.max(Math.abs(c.x - treant.x), Math.abs(c.y - treant.y)) > 1 &&
    !approaches.has(cellKey(c)) &&
    openAround(c);

  const candidates: Cell[] = [];
  for (let dy = -SEEDS.spread; dy <= SEEDS.spread; dy++) {
    for (let dx = -SEEDS.spread; dx <= SEEDS.spread; dx++) candidates.push({ x: player.x + dx, y: player.y + dy });
  }
  const pods: SeedPod[] = [];
  while (pods.length < SEEDS.count && candidates.length) {
    const cell = candidates.splice(rng.int(0, candidates.length - 1), 1)[0];
    if (!landable(cell)) continue;
    const sprout: Sprout = rng.next() < SEEDS.thornChance ? 'thorn' : 'rock';
    planned[cell.y][cell.x] = sprout;
    pods.push({ cell, sprout });
  }
  return { pods, flightMs: SEEDS.flightMs, durationMs: SEEDS.flightMs + SEEDS.settleMs };
}

/** The last stand's branch ring; all numbers are placeholders for playtest tuning. */
export const RING = {
  /** Gaps in the branches, evenly spaced round the Treant... */
  gaps: 3,
  /** ...each this wide... */
  gapDeg: 35,
  /** ...shown this long before the branches hurt... */
  warnMs: 1500,
  /** ...then turning clockwise at this speed, rising to the next as its last hit points drain. */
  startDegPerSec: 25,
  endDegPerSec: 40,
};

/**
 * Huge branches over the whole room round the Treant but for a few narrow gaps, which turn
 * clockwise for as long as it lives. Advanced frame by frame (`advanceRing`), adding up its
 * speed over time, so a change of speed never makes the gaps jump.
 */
export interface BranchRing {
  centre: Point;
  start: number;
  /** Angle of the first gap's middle when it appeared, in radians (screen angles: clockwise grows). */
  offset: number;
  /** How far it has turned since, in radians. */
  turned: number;
  /** Up to when it has been turned. */
  lastTime: number;
}

const DEG = Math.PI / 180;

/** A ring round `centre`, a gap on the player so the last stand opens fairly. */
export function planBranchRing(centre: Point, player: Point, time: number): BranchRing {
  return { centre, start: time, offset: Math.atan2(player.y - centre.y, player.x - centre.x), turned: 0, lastTime: time };
}

/**
 * Turns the ring on to `time` (not while it is still a warning). `drained` is how far through its
 * last-stand hit points the Treant is, 0 to 1: the further, the faster it turns.
 */
export function advanceRing(ring: BranchRing, time: number, drained: number): BranchRing {
  const from = Math.max(ring.lastTime, ring.start + RING.warnMs);
  if (time <= from) return { ...ring, lastTime: Math.max(ring.lastTime, time) };
  const share = Math.min(1, Math.max(0, drained));
  const degPerSec = RING.startDegPerSec + (RING.endDegPerSec - RING.startDegPerSec) * share;
  return { ...ring, turned: ring.turned + (degPerSec * DEG * (time - from)) / 1000, lastTime: time };
}

/** The middles of the ring's gaps now, in radians (not wrapped). */
export const ringGaps = (ring: BranchRing): number[] =>
  Array.from({ length: RING.gaps }, (_, i) => ring.offset + ring.turned + (i * 2 * Math.PI) / RING.gaps);

export const ringWarning = (ring: BranchRing, time: number) => time - ring.start < RING.warnMs;

/** True if the branches hurt a player at `point`: anywhere outside the gaps, however far, once past the warning. */
export function ringHits(ring: BranchRing, time: number, point: Point): boolean {
  if (ringWarning(ring, time)) return false;
  const angle = Math.atan2(point.y - ring.centre.y, point.x - ring.centre.x);
  const half = (RING.gapDeg / 2) * DEG;
  return ringGaps(ring).every((gap) => Math.abs(Math.atan2(Math.sin(angle - gap), Math.cos(angle - gap))) > half);
}

/**
 * Where the Treant bursts up for its last stand: the cell nearest the room's middle with floor
 * all round it (the 3x3 its body covers), or undefined if there is no such spot.
 */
export function burstSpot(tiles: Tile[][]): Cell | undefined {
  const middle = { x: (tiles[0].length - 1) / 2, y: (tiles.length - 1) / 2 };
  const open = (c: Cell) => [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => tiles[c.y + dy]?.[c.x + dx] === 'floor'));
  let best: Cell | undefined;
  let bestDistance = Infinity;
  tiles.forEach((row, y) =>
    row.forEach((_, x) => {
      const d = Math.hypot(x - middle.x, y - middle.y);
      if (d < bestDistance && open({ x, y })) [best, bestDistance] = [{ x, y }, d];
    }),
  );
  return best;
}

/** Branch sweep reach and timing; all numbers are placeholders for playtest tuning. */
export const SWEEP = {
  /** Reach from the treant's centre, in tiles; the player closer than this provokes a sweep. */
  range: 2.4,
  /** Width of the swept arc, centred on where the player stood when the sweep began. */
  arcDeg: 150,
  /** How long the arc is shown before the branches come round. */
  telegraphMs: 600,
  /** How long the swing lasts, hurting whoever is inside the arc. */
  swingMs: 220,
  /** Pause after a sweep before the treant can sweep again. */
  cooldownMs: 900,
};

/** A point in tile units (10.5 is the centre of tile 10). */
export interface Point {
  x: number;
  y: number;
}

export interface BranchSweep {
  from: Point;
  /** Direction of the arc's centre, in radians. */
  aim: number;
  halfArc: number;
  range: number;
  telegraphMs: number;
  /** Time from the start until the swing is over. */
  durationMs: number;
}

/** True when the player is close enough for the treant to sweep its branches at them. */
export const inSweepRange = (treant: Point, player: Point) => Math.hypot(player.x - treant.x, player.y - treant.y) < SWEEP.range;

/** A branch sweep from the treant, its arc centred on the player. */
export function planBranchSweep(treant: Point, player: Point): BranchSweep {
  return {
    from: treant,
    aim: Math.atan2(player.y - treant.y, player.x - treant.x),
    halfArc: (SWEEP.arcDeg / 2) * (Math.PI / 180),
    range: SWEEP.range,
    telegraphMs: SWEEP.telegraphMs,
    durationMs: SWEEP.telegraphMs + SWEEP.swingMs,
  };
}

export type SweepPhase = 'telegraph' | 'swing' | 'over';

export function branchSweepPhase(sweep: BranchSweep, elapsedMs: number): SweepPhase {
  if (elapsedMs < sweep.telegraphMs) return 'telegraph';
  return elapsedMs <= sweep.durationMs ? 'swing' : 'over';
}

/** True if the sweep hurts a player at `player` `elapsedMs` in: only while swinging, and only inside its arc. */
export function branchSweepHits(sweep: BranchSweep, elapsedMs: number, player: Point): boolean {
  if (branchSweepPhase(sweep, elapsedMs) !== 'swing') return false;
  const dx = player.x - sweep.from.x;
  const dy = player.y - sweep.from.y;
  if (Math.hypot(dx, dy) > sweep.range) return false;
  const off = Math.atan2(dy, dx) - sweep.aim;
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= sweep.halfArc;
}
