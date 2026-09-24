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

/**
 * When a pattern repeating every `every` ms from `start + first` fires between `from`
 * (exclusive) and `to` (inclusive): the beats an update from `from` to `to` has to play.
 */
export function beats(start: number, first: number, every: number, from: number, to: number): number[] {
  const out: number[] = [];
  const k0 = Math.max(0, Math.ceil((from - start - first) / every));
  for (let t = start + first + k0 * every; t <= to; t += every) if (t > from) out.push(t);
  return out;
}

/** `count` bullets spread evenly across `width` radians, centred on `aim`. */
export function fan(aim: number, count: number, width: number): number[] {
  if (count === 1) return [aim];
  return Array.from({ length: count }, (_, i) => aim - width / 2 + (width * i) / (count - 1));
}
