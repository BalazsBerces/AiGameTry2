/**
 * Knockback: an enemy the player hits is nudged back along the hit. Pure; the scene adds the
 * nudge to the enemy's own steering velocity each frame, as it does soft pushes.
 */

export interface KnockbackTuning {
  /** Push speed (px/s) at the moment of the hit. */
  speed: number;
  /** How long the push lasts, in ms. */
  ms: number;
}

export interface Knockback {
  /** `key` is hit at `time`, pushed along `dir` (any length); a push already running is replaced. */
  hit(key: object, time: number, dir: { x: number; y: number }): void;
  /** The extra velocity (px/s) `key` is pushed with at `time`. */
  velocity(key: object, time: number): { x: number; y: number };
}

export function createKnockback(tuning: KnockbackTuning): Knockback {
  // Weak, so an enemy destroyed mid-push is forgotten with it.
  const hits = new WeakMap<object, { from: number; dir: { x: number; y: number } }>();
  return {
    hit(key, time, dir) {
      const len = Math.hypot(dir.x, dir.y);
      if (len === 0) return;
      hits.set(key, { from: time, dir: { x: dir.x / len, y: dir.y / len } });
    },
    velocity(key, time) {
      const h = hits.get(key);
      const left = h ? 1 - (time - h.from) / tuning.ms : 0;
      if (!h || left <= 0) {
        hits.delete(key);
        return { x: 0, y: 0 };
      }
      return { x: h.dir.x * tuning.speed * left, y: h.dir.y * tuning.speed * left };
    },
  };
}
