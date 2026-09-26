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

/** How long each kind of hit freezes the game, in ms. */
export const HIT_STOP = { hit: 35, kill: 60, bomb: 80 };

export function createHitStop(): HitStop {
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
