import type { Rng } from '../rng';

/**
 * What the on-hit passives do to an enemy the player's shot or sword hurts: poison that stacks
 * and ticks, lightning that jumps on to other enemies, and a chance to freeze (stun) it.
 */

export interface PoisonRules {
  damagePerTick: number;
  tickMs: number;
  /** It wears off this long after the last hit. */
  durationMs: number;
  maxStacks: number;
}

export interface Poison {
  stacks: number;
  /** When the next tick is due. */
  nextTickAt: number;
  until: number;
}

/** A poisoning hit: one more stack (up to the limit), and the poison lasts its full time again. */
export function applyPoison(poison: Poison | undefined, time: number, rules: PoisonRules): Poison {
  return {
    stacks: Math.min(rules.maxStacks, (poison?.stacks ?? 0) + 1),
    nextTickAt: poison?.nextTickAt ?? time + rules.tickMs,
    until: time + rules.durationMs,
  };
}

/**
 * The poison's damage up to `time`: each stack hurts once per tick, ticks missed in a long frame
 * included. Returns what is left of the poison, or none once it has worn off.
 */
export function poisonTick(poison: Poison, time: number, rules: PoisonRules): { damage: number; poison?: Poison } {
  let { nextTickAt } = poison;
  let damage = 0;
  while (nextTickAt <= time && nextTickAt <= poison.until) {
    damage += poison.stacks * rules.damagePerTick;
    nextTickAt += rules.tickMs;
  }
  return { damage, poison: time > poison.until ? undefined : { ...poison, nextTickAt } };
}

interface Placed<Id> {
  id: Id;
  at: { x: number; y: number };
}

/**
 * Where lightning from the enemy `hit` jumps: `jumps` times, each to the nearest enemy within
 * `range` of the last one it reached, never to one it already struck (nor back to `hit`).
 */
export function chainTargets<Id>(hit: Id, enemies: Placed<Id>[], jumps: number, range: number): Id[] {
  const struck = new Set<Id>([hit]);
  const out: Id[] = [];
  let from = enemies.find((e) => e.id === hit)?.at;
  while (from && out.length < jumps) {
    const origin: { x: number; y: number } = from;
    const dist = (e: Placed<Id>) => Math.hypot(e.at.x - origin.x, e.at.y - origin.y);
    const next = enemies.filter((e) => !struck.has(e.id) && dist(e) <= range).sort((a, b) => dist(a) - dist(b))[0];
    if (!next) break;
    struck.add(next.id);
    out.push(next.id);
    from = next.at;
  }
  return out;
}

/** Whether a hit freezes its target, at `chance`. */
export const rollsFreeze = (chance: number, rng: Rng) => rng.next() < chance;
