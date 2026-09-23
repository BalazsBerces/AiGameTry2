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
