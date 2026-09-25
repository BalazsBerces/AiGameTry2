/**
 * The player's hurtbox: a circle smaller than their sprite, so what grazes the ball's edge
 * misses. Walls still stop the whole ball; only what hurts checks this.
 */
interface Point {
  x: number;
  y: number;
}

/** Whether the hurtbox (centre `at`, `radius`) overlaps a circle: a shot, a round enemy. */
export function hurtboxMeetsCircle(at: Point, radius: number, centre: Point, r: number): boolean {
  return Math.hypot(at.x - centre.x, at.y - centre.y) < radius + r;
}

/** Whether the hurtbox (centre `at`, `radius`) overlaps a box (top-left `x`, `y`): a square enemy. */
export function hurtboxMeetsBox(at: Point, radius: number, box: Point & { width: number; height: number }): boolean {
  const nearest = {
    x: Math.max(box.x, Math.min(at.x, box.x + box.width)),
    y: Math.max(box.y, Math.min(at.y, box.y + box.height)),
  };
  return Math.hypot(at.x - nearest.x, at.y - nearest.y) < radius;
}
