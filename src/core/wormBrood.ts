/** The worm boss's phase-one eggs; placeholders for playtest tuning. */
export const WORM_BROOD = {
  /** Before it splits, it lobs this many eggs out of its head this often. */
  lobEveryMs: 5000,
  eggsPerLob: 2,
  /** An egg hatches this long after it lands, wobbling for the last `wobbleMs`. */
  hatchMs: 4000,
  wobbleMs: 1000,
  /** Eggs (in the air too) and living hatchlings together. */
  cap: 4,
  /** About two player shots. */
  eggHp: 2,
  /** A hatchling is a regular worm this many segments long. */
  hatchlingLength: 4,
};

export interface BroodPiece {
  /** The worm has split: it makes no more eggs. */
  split: boolean;
  aboveGround: boolean;
  /** Eggs plus living hatchlings. */
  brood: number;
}

/**
 * The worm's egg timer, ticked every frame: before its split it lobs `eggs` every interval, the
 * first a full interval in (the timer is off, `undefined`, once it has split), only as many as
 * the cap has room for. A lob falling due while it is in the walls or rampaging, or at the cap,
 * is held until it is back out and there's room.
 */
export function broodTick(nextLobAt: number | undefined, now: number, piece: BroodPiece): { eggs: number; nextLobAt: number | undefined } {
  if (piece.split) return { eggs: 0, nextLobAt: undefined };
  if (nextLobAt === undefined) return { eggs: 0, nextLobAt: now + WORM_BROOD.lobEveryMs };
  const room = WORM_BROOD.cap - piece.brood;
  if (now < nextLobAt || !piece.aboveGround || room <= 0) return { eggs: 0, nextLobAt };
  return { eggs: Math.min(WORM_BROOD.eggsPerLob, room), nextLobAt: now + WORM_BROOD.lobEveryMs };
}

/** Where an egg laid at `laidAt` stands at `now`. */
export function eggStage(laidAt: number, now: number): 'resting' | 'wobbling' | 'hatched' {
  const age = now - laidAt;
  if (age >= WORM_BROOD.hatchMs) return 'hatched';
  return age >= WORM_BROOD.hatchMs - WORM_BROOD.wobbleMs ? 'wobbling' : 'resting';
}
