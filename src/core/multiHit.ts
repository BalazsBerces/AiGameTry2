/**
 * One attack touching many parts of one body (a piercing shot down the worm boss, a sword arc
 * across it): the parts share a hit group, and the attack's hits on a group fall off.
 */

/** Each later touch of a group in the same attack deals this share of the one before. */
export const FALLOFF = 0.5;

/** One attack's tally: the damage each touch on a group deals. */
export interface Falloff {
  /** Full damage on the group's first touch, `FALLOFF` of the last after that; always full with no group. */
  damage(group: object | undefined, full: number): number;
}

export function createFalloff(): Falloff {
  const touches = new Map<object, number>();
  return {
    damage(group, full) {
      if (!group) return full;
      const before = touches.get(group) ?? 0;
      touches.set(group, before + 1);
      return full * FALLOFF ** before;
    },
  };
}

/** A repeating damage source (an orbital orb): lets each group (or lone part) be hurt at most once per interval. */
export interface HitGate {
  /** True, and the group is shut out for `everyMs` from `now`, if it may be hurt now. */
  pass(group: object, now: number, everyMs: number): boolean;
}

export function createHitGate(): HitGate {
  const openAt = new WeakMap<object, number>();
  return {
    pass(group, now, everyMs) {
      if (now < (openAt.get(group) ?? -Infinity)) return false;
      openAt.set(group, now + everyMs);
      return true;
    },
  };
}
