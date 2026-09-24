import type { Cell } from './floorGenerator';
import { stepDownhill } from './grid';

/**
 * Forest cast rules: the goblin (floor 1's walker) and the seed-spitter (its turret). Pure, so
 * behaviour is tested without Phaser; the entities in src/game only apply what these return.
 */

/**
 * `hide`: hurt, keeping away from the player until a partner turns up. `seek`: hurt, walking to
 * its hurt partner. Once they meet, one `mend`s (is healed) while the other stands and `heal`s it,
 * then they swap. `retreat`: the last goblin's one flight.
 */
export type GoblinMode = 'chase' | 'retreat' | 'hide' | 'seek' | 'heal' | 'mend';

export interface Goblin {
  mode: GoblinMode;
  /** When a retreat ends and the goblin comes back. */
  retreatUntil: number;
  /** A goblin regroups once; after coming back it fights to the end. */
  regrouped: boolean;
  /** The id of the hurt goblin it has paired up with, while seeking. */
  partner?: number;
  /** Where that partner is: the cell to walk to. */
  meetAt?: Cell;
  /** While being healed: when it last got HP back. */
  healedAt?: number;
}

/** How long a hurt goblin keeps away before coming back (placeholder). */
export const GOBLIN_RETREAT_MS = 2500;

export const createGoblin = (): Goblin => ({ mode: 'chase', retreatUntil: 0, regrouped: false });

/** The last goblin's retreat: starts when HP drops below half, and ends for good once the time is up. */
function updateGoblin(g: Goblin, hp: number, maxHp: number, time: number): Goblin {
  if (g.mode === 'retreat') return time >= g.retreatUntil ? { ...g, mode: 'chase', regrouped: true } : g;
  if (!g.regrouped && hp < maxHp / 2) return { ...g, mode: 'retreat', retreatUntil: time + GOBLIN_RETREAT_MS };
  return g;
}

/** One goblin as the pack rules see it. */
export interface PackMember {
  id: number;
  hp: number;
  maxHp: number;
  /** The tile it stands on. */
  cell: Cell;
  goblin: Goblin;
}

/** What the pack knows about the room this frame. */
export interface PackWorld {
  time: number;
  /** Steps to walk from one cell to another round the terrain (Infinity if there's no way). */
  walkBetween(a: Cell, b: Cell): number;
  /** Share of its max HP a goblin being healed gets back per second. */
  healRate: number;
}

/** A goblin's new state, and the HP it gets back this frame. */
export interface PackDecision {
  goblin: Goblin;
  heal: number;
}

/**
 * The whole room's goblins decide together, once a frame: each one's new state, in the same order.
 * Hurt goblins pair up and walk to each other; one left without a partner hides while others are
 * alive, and the last one left flees once, then fights to the death.
 */
export function updateGoblinPack(pack: readonly PackMember[], world: PackWorld): PackDecision[] {
  if (pack.length === 1) return [{ goblin: updateGoblin(pack[0].goblin, pack[0].hp, pack[0].maxHp, world.time), heal: 0 }];
  const partnerOf = new Map<number, PackMember>();
  // A pair stays together until both are back to full.
  const byId = new Map(pack.map((m) => [m.id, m]));
  for (const m of pack) {
    const partner = m.goblin.partner === undefined ? undefined : byId.get(m.goblin.partner);
    if (partner?.goblin.partner === m.id && (m.hp < m.maxHp || partner.hp < partner.maxHp)) partnerOf.set(m.id, partner);
  }
  // Then the closest two hurt goblins (on foot) pair, then the closest two of the rest, and so on.
  const hurt = pack.filter((m) => m.hp < m.maxHp / 2 && !partnerOf.has(m.id));
  const pairs = hurt
    .flatMap((a, i) => hurt.slice(i + 1).map((b) => ({ a, b, steps: world.walkBetween(a.cell, b.cell) })))
    .filter((p) => Number.isFinite(p.steps))
    .sort((p, q) => p.steps - q.steps);
  for (const { a, b } of pairs) {
    if (partnerOf.has(a.id) || partnerOf.has(b.id)) continue;
    partnerOf.set(a.id, b);
    partnerOf.set(b.id, a);
  }
  return pack.map((m): PackDecision => {
    const { partner: _, meetAt: __, healedAt: ___, ...rest } = m.goblin;
    const partner = partnerOf.get(m.id);
    if (partner) {
      const met = Math.abs(m.cell.x - partner.cell.x) + Math.abs(m.cell.y - partner.cell.y) <= 1;
      // A turn lasts until the one being healed is full. A new turn goes to the more hurt one (equally
      // hurt, the lower id); one already at full never mends.
      const turn = (g: PackMember) => g.goblin.mode === 'mend' && g.hp < g.maxHp;
      const mends = turn(m) || (!turn(partner) && m.hp < m.maxHp &&
        (partner.hp >= partner.maxHp || m.hp < partner.hp || (m.hp === partner.hp && m.id < partner.id)));
      const mode = !met ? 'seek' : mends ? 'mend' : 'heal';
      const goblin: Goblin = { ...rest, mode, partner: partner.id, meetAt: partner.cell };
      if (mode !== 'mend') return { goblin, heal: 0 };
      // HP comes back steadily from the frame it started being healed.
      const since = m.goblin.mode === 'mend' && m.goblin.healedAt !== undefined ? m.goblin.healedAt : world.time;
      const heal = Math.min(m.maxHp - m.hp, (world.healRate * m.maxHp * (world.time - since)) / 1000);
      return { goblin: { ...goblin, healedAt: world.time }, heal };
    }
    return { goblin: { ...rest, mode: m.hp < m.maxHp / 2 ? 'hide' : 'chase' }, heal: 0 };
  });
}

const NEIGHBORS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * The next cell to head for on the walk-distance field to the player: downhill when chasing,
 * uphill (to a reachable cell) when retreating. Undefined when there's nowhere better to go.
 */
export function goblinStep(g: Goblin, walkDistance: number[][], here: Cell): Cell | undefined {
  if (g.mode === 'chase') return stepDownhill(walkDistance, here);
  let best: Cell | undefined;
  let bestDist = walkDistance[here.y]?.[here.x] ?? -Infinity;
  for (const n of NEIGHBORS) {
    const next = { x: here.x + n.x, y: here.y + n.y };
    const d = walkDistance[next.y]?.[next.x] ?? Infinity;
    if (Number.isFinite(d) && d > bestDist) {
      best = next;
      bestDist = d;
    }
  }
  return best;
}

/** Angle between the seed-spitter's middle shot and each side shot (placeholder). */
export const SEED_SPREAD = Math.PI / 9;

/**
 * The seed-spitter's volley: three shot velocities at `speed`, the first straight along `aim`,
 * then one turned by `-spread` and one by `+spread`.
 */
export function spreadShots(aim: { x: number; y: number }, speed: number, spread = SEED_SPREAD): { x: number; y: number }[] {
  const base = Math.atan2(aim.y, aim.x);
  return [0, -spread, spread].map((turn) => ({ x: Math.cos(base + turn) * speed, y: Math.sin(base + turn) * speed }));
}
