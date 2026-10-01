/**
 * The caves' turret: a geode that is always either shut (plain rock, harmless, and nothing can
 * hurt it) or open (split on its crystal core, firing, and open to hits). It opens when the
 * player comes near and in sight, waits a moment, fires a short burst, stays open a moment
 * more, then shuts and rests. Those waits are the player's windows to punish it.
 */
export interface GeodeRules {
  /** Opens when the player is at most this many tiles away (and in sight). */
  wakeRange: number;
  /** How long it stays shut, at least, after shutting. */
  restMs: number;
  /** Pause between opening and the first shot (its tell, and a punish window). */
  openDelayMs: number;
  /** Shots per burst. */
  burstSize: number;
  /** Time between shots within a burst. */
  shotGapMs: number;
  /** How long it stays open after its last shot (the second punish window). */
  tailMs: number;
  /** On room entry, a random wait in this range before it may first open, so a group doesn't open in sync. */
  staggerMs: { min: number; max: number };
}

/** Placeholder numbers for playtest tuning. */
export const GEODE: GeodeRules = {
  wakeRange: 4,
  restMs: 2000,
  openDelayMs: 700,
  burstSize: 2,
  shotGapMs: 500,
  tailMs: 500,
  staggerMs: { min: 300, max: 800 },
};

export type Geode =
  | {
      open: false;
      /** The earliest it may open. */
      openableAt: number;
      firedAt?: number;
    }
  | {
      open: true;
      openedAt: number;
      /** When the next shot is due, or once the burst is spent, when it shuts. */
      dueAt: number;
      /** Shots still to come in this burst (a skipped one counts as spent). */
      shotsLeft: number;
      /** When it last fired, for the flare of its core. */
      firedAt?: number;
    };

/** A shut geode that may first open at `firstOpenAt` (the caller adds the room-entry stagger). */
export function createGeode(firstOpenAt: number): Geode {
  return { open: false, openableAt: firstOpenAt };
}

/**
 * Advances the geode to `time` (ms) with the player `distance` tiles away, in its sight or not.
 * Returns its new state and how many shots it fires this update (more than one only after a
 * long frame). Once open it runs its cycle to the end, whatever the player does; a shot that
 * falls due while it can't see the player is skipped, not held.
 */
export function updateGeode(
  geode: Geode,
  distance: number,
  canSee: boolean,
  time: number,
  rules: GeodeRules = GEODE,
): { geode: Geode; shots: number } {
  let g = geode;
  if (!g.open) {
    if (time < g.openableAt || distance > rules.wakeRange || !canSee) return { geode: g, shots: 0 };
    g = { open: true, openedAt: time, dueAt: time + rules.openDelayMs, shotsLeft: rules.burstSize, firedAt: g.firedAt };
  }
  let { dueAt, shotsLeft, firedAt } = g;
  let shots = 0;
  while (time >= dueAt) {
    if (shotsLeft === 0) return { geode: { open: false, openableAt: dueAt + rules.restMs, firedAt }, shots };
    if (canSee) {
      shots++;
      firedAt = time;
    }
    shotsLeft--;
    dueAt += shotsLeft > 0 ? rules.shotGapMs : rules.tailMs;
  }
  return { geode: { open: true, openedAt: g.openedAt, dueAt, shotsLeft, firedAt }, shots };
}
