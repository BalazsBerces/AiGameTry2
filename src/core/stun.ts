/**
 * The stun every enemy shares: a stunned enemy stands still and does nothing until it wears
 * off. A boar stuns itself charging into stone; a glowshroom's burst stuns everything near it.
 */
export interface Stunnable {
  /** Time (ms) the current stun wears off; not stunned if left out or already past. */
  stunnedUntil?: number;
}

/** Stuns `target` for `durationMs` from `time`; a longer stun already running is kept. */
export function stun(target: Stunnable, time: number, durationMs: number) {
  target.stunnedUntil = Math.max(target.stunnedUntil ?? -Infinity, time + durationMs);
}

export const isStunned = (target: Stunnable, time: number) => time < (target.stunnedUntil ?? -Infinity);
