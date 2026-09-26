/**
 * Soft collisions between walkers: instead of stopping dead on each other, overlapping bodies are
 * nudged apart and keep walking, so a crowd squeezes through a gap. Pure; the scene adds the
 * pushes to each walker's steering velocity.
 */

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface SoftPushTuning {
  /** Push speed (px/s) per pixel of overlap. */
  stiffness: number;
  /** Most push speed (px/s) any one circle gets. */
  cap: number;
}

/** One velocity nudge per circle, pointing away from every circle it overlaps. */
export function softPush(circles: readonly Circle[], tuning: SoftPushTuning): { x: number; y: number }[] {
  const pushes = circles.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const overlap = a.r + b.r - dist;
      if (overlap <= 0) continue;
      // On the very same spot there is no line between them: split them along x, first one left.
      const nx = dist > 0 ? (b.x - a.x) / dist : 1;
      const ny = dist > 0 ? (b.y - a.y) / dist : 0;
      const strength = tuning.stiffness * overlap;
      pushes[i].x -= nx * strength;
      pushes[i].y -= ny * strength;
      pushes[j].x += nx * strength;
      pushes[j].y += ny * strength;
    }
  }
  return pushes.map((p) => {
    const speed = Math.hypot(p.x, p.y);
    return speed > tuning.cap ? { x: (p.x / speed) * tuning.cap, y: (p.y / speed) * tuning.cap } : p;
  });
}
