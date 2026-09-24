/**
 * Bullet patterns for the bosses, as the angles (radians, 0 = right, clockwise on screen) to
 * fire along; speed and spawning stay with the caller.
 */

/** `count` bullets spread evenly around the full circle, the first at `rotation`. */
export function ring(count: number, rotation = 0): number[] {
  return Array.from({ length: count }, (_, i) => rotation + (2 * Math.PI * i) / count);
}

/** A ring of `arms` that has turned `degPerSec` for every second of `timeMs`: fire it repeatedly for a spiral. */
export function spiral(arms: number, timeMs: number, degPerSec: number): number[] {
  return ring(arms, (((degPerSec * timeMs) / 1000) * Math.PI) / 180);
}

/** `count` bullets spread evenly across `width` radians, centred on `aim`. */
export function fan(aim: number, count: number, width: number): number[] {
  if (count === 1) return [aim];
  return Array.from({ length: count }, (_, i) => aim - width / 2 + (width * i) / (count - 1));
}
