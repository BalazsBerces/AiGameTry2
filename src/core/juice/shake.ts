/**
 * Screen shake: each event shakes the view by its own amount (px), easing to nothing over its
 * length; events running at once add up, but the total never passes the cap, so shake can
 * never make dodging harder than it should be.
 */

export interface Shake {
  /** A shake of `amount` px starting at `time`, easing out over `ms`. */
  add(time: number, amount: number, ms: number): void;
  /** How far (px) the view shakes at `time`. */
  amount(time: number): number;
}

/** The most the view ever shakes, whatever is going on (px). */
export const SHAKE_CAP = 7;

export function createShake(cap = SHAKE_CAP): Shake {
  let events: { from: number; amount: number; ms: number }[] = [];
  return {
    add(time, amount, ms) {
      events.push({ from: time, amount, ms });
    },
    amount(time) {
      events = events.filter((e) => time < e.from + e.ms);
      const total = events.reduce((sum, e) => sum + e.amount * Math.max(0, 1 - (time - e.from) / e.ms), 0);
      return Math.min(cap, total);
    },
  };
}
