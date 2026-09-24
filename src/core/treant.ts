import type { Cell } from './floorGenerator';
import type { Rng } from './rng';
import type { Door, Tile } from './roomGenerator';
import {
  branchSweepPhase,
  inSweepRange,
  planBranchSweep,
  planRootEruption,
  planSeedVolley,
  SWEEP,
  type BranchSweep,
  type Point,
  type RootEruption,
  type SeedPod,
  type SeedVolley,
} from './treantAttack';

/** Treant fight rhythm; placeholders for playtest tuning. */
export const TREANT = {
  /** Pause after each root eruption or seed volley before the next. */
  restMs: 700,
  /**
   * Its own sprouts whose middle is this near its centre, in tiles, are crushed back into floor:
   * just past where its body (about a tile in radius) comes up against a tile.
   */
  crushReach: 1.6,
};

export type TreantAttack =
  | { kind: 'roots'; plan: RootEruption; start: number }
  | { kind: 'seeds'; plan: SeedVolley; start: number; landed: boolean };

/**
 * The floor-1 boss's decisions (the entity in game/entities/treant draws them): it walks at the
 * player, standing still for its root eruptions but not while its seed pods fly; the two take turns.
 * Whenever the player comes close it also sweeps its branches, standing still for that too. It
 * remembers where its pods came down and crushes those sprouts, and only those, as it walks into them.
 */
export interface Treant {
  attack?: TreantAttack;
  nextAttackAt: number;
  throwSeedsNext: boolean;
  sweep?: { plan: BranchSweep; start: number };
  nextSweepAt: number;
  /** Where its pods came down; forgotten once crushed or if the tile is no longer that sprout. */
  sprouts: SeedPod[];
}

export interface TreantInput {
  time: number;
  /** Its centre, in tile units (10.5 is the middle of tile 10). */
  at: Point;
  player: Point;
  tiles: Tile[][];
  doors: Door[];
  hp: number;
  maxHp: number;
  rng: Rng;
}

/** One-off things for the scene to carry out. */
export type TreantEvent = { kind: 'podsLand'; pods: SeedPod[] } | { kind: 'crush'; cell: Cell };

export interface TreantStep {
  treant: Treant;
  /** Unit direction to walk this frame, or undefined to stand still. */
  walk?: Point;
  events: TreantEvent[];
}

export const createTreant = (time: number): Treant => ({ nextAttackAt: time, throwSeedsNext: false, nextSweepAt: time, sprouts: [] });

const cellOf = (p: Point): Cell => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

export function updateTreant(treant: Treant, input: TreantInput): TreantStep {
  const { time } = input;
  const events: TreantEvent[] = [];
  let { attack, nextAttackAt, throwSeedsNext, sweep, nextSweepAt } = treant;
  // Pods that landed last frame have sprouted by now (or burst on the player, and are forgotten).
  const sprouts = treant.sprouts.filter(({ cell, sprout }) => {
    if (input.tiles[cell.y]?.[cell.x] !== sprout) return false;
    if (Math.hypot(cell.x + 0.5 - input.at.x, cell.y + 0.5 - input.at.y) >= TREANT.crushReach) return true;
    events.push({ kind: 'crush', cell });
    return false;
  });
  if (sweep && branchSweepPhase(sweep.plan, time - sweep.start) === 'over') {
    sweep = undefined;
    nextSweepAt = time + SWEEP.cooldownMs;
  }
  if (!sweep && time >= nextSweepAt && inSweepRange(input.at, input.player)) {
    sweep = { plan: planBranchSweep(input.at, input.player), start: time };
  }
  if (attack?.kind === 'seeds' && !attack.landed && time - attack.start >= attack.plan.flightMs) {
    events.push({ kind: 'podsLand', pods: attack.plan.pods });
    sprouts.push(...attack.plan.pods);
    attack = { ...attack, landed: true };
  }
  if (attack && time - attack.start > attack.plan.durationMs) {
    attack = undefined;
    nextAttackAt = time + TREANT.restMs;
  }
  if (!attack && time >= nextAttackAt) {
    const self = cellOf(input.at);
    const player = cellOf(input.player);
    attack = throwSeedsNext
      ? { kind: 'seeds', plan: planSeedVolley(input.tiles, input.doors, self, player, input.rng), start: time, landed: false }
      : { kind: 'roots', plan: planRootEruption(input.tiles, self, player), start: time };
    throwSeedsNext = !throwSeedsNext;
  }
  const next = { ...treant, attack, nextAttackAt, throwSeedsNext, sweep, nextSweepAt, sprouts };
  if (attack?.kind === 'roots' || sweep) return { treant: next, events };
  const dx = input.player.x - input.at.x;
  const dy = input.player.y - input.at.y;
  const d = Math.hypot(dx, dy);
  return { treant: next, walk: d > 0 ? { x: dx / d, y: dy / d } : undefined, events };
}
