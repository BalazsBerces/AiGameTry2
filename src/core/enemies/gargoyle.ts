/**
 * The dungeon's turret: a stone gargoyle that sits dormant until the player comes within
 * range, then wakes for good and fires bursts of shots on a fixed schedule.
 */
export interface GargoyleRules {
  /** Wakes when the player is at most this many tiles away. */
  wakeRange: number;
  /** Pause between waking and the first burst (its tell). */
  wakeDelayMs: number;
  /** Shots per burst. */
  burstSize: number;
  /** Time between shots within a burst. */
  shotGapMs: number;
  /** Pause from the last shot of a burst to the first of the next. */
  burstGapMs: number;
}

/** Placeholder numbers for playtest tuning. */
export const GARGOYLE: GargoyleRules = { wakeRange: 4, wakeDelayMs: 600, burstSize: 3, shotGapMs: 160, burstGapMs: 1800 };

export interface Gargoyle {
  awake: boolean;
  /** When the next shot is due (meaningless while dormant). */
  nextShotAt: number;
  /** Shots still to fire in the current burst. */
  burstLeft: number;
}

export function createGargoyle(): Gargoyle {
  return { awake: false, nextShotAt: 0, burstLeft: 0 };
}

/**
 * Advances the gargoyle to `time` (ms) with the player `distance` tiles away. Returns its new
 * state and how many shots it fires this update (more than one only after a long frame).
 */
export function updateGargoyle(
  gargoyle: Gargoyle,
  distance: number,
  time: number,
  rules: GargoyleRules = GARGOYLE,
): { gargoyle: Gargoyle; shots: number } {
  if (!gargoyle.awake) {
    if (distance > rules.wakeRange) return { gargoyle, shots: 0 };
    return { gargoyle: { awake: true, nextShotAt: time + rules.wakeDelayMs, burstLeft: rules.burstSize }, shots: 0 };
  }
  let { nextShotAt, burstLeft } = gargoyle;
  let shots = 0;
  while (time >= nextShotAt) {
    shots++;
    burstLeft--;
    if (burstLeft > 0) {
      nextShotAt += rules.shotGapMs;
    } else {
      burstLeft = rules.burstSize;
      nextShotAt += rules.burstGapMs;
    }
  }
  return { gargoyle: { awake: true, nextShotAt, burstLeft }, shots };
}
