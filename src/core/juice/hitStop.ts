/**
 * Hit-stop: a hit freezes the game for a few frames so it lands with weight. The game runs on
 * its own clock that stands still while frozen and carries on afterwards without a jump, so
 * telegraphs, cooldowns and every other timer lose nothing to a freeze. Freezes asked for while
 * one is running merge into it: however many hits land, the freeze lasts as long as the
 * longest of them, from when it began.
 */

export interface HitStop {
  /** Asks for a freeze of `ms`, at real time `time`. */
  request(time: number, ms: number): void;
  /** At real time `time`: whether the game is frozen, and the game clock's time. */
  step(time: number): { frozen: boolean; gameTime: number };
}

/**
 * How long each kind of hit freezes the game, in ms. Hits and kills don't freeze: at the rate
 * they come in, freezing on each read as the game stuttering, and a kill's freeze held its
 * paper scraps still just as they burst.
 */
export const HIT_STOP = { bomb: 80 };

/** After a freeze, how long (ms of real time) before another may start, so kills in a swarm don't chain into a stutter. */
export const HIT_STOP_REST = 250;

export function createHitStop(rest = HIT_STOP_REST): HitStop {
  /** Real time the game clock has lost to finished freezes. */
  let lost = 0;
  let start = 0;
  let end = -Infinity;
  let longest = 0;
  /** The running freeze has not yet been added to `lost`. */
  let open = false;
  return {
    request(time, ms) {
      if (time < end) {
        longest = Math.max(longest, ms);
        end = start + longest;
        return;
      }
      if (time < end + rest) return;
      [start, longest, end, open] = [time, ms, time + ms, true];
    },
    step(time) {
      if (time < end) return { frozen: true, gameTime: start - lost };
      if (open) {
        lost += end - start;
        open = false;
      }
      return { frozen: false, gameTime: time - lost };
    },
  };
}
