import { canAttack } from './wormBossAttack';

/** The worm boss's phase-two eggs; placeholders for playtest tuning. */
export const WORM_BROOD = {
  /** Each piece that can lay drops an egg from its tail this often. */
  layEveryMs: 4000,
  /** An egg hatches this long after it is laid, wobbling for the last `wobbleMs`. */
  hatchMs: 4000,
  wobbleMs: 1000,
  /** Eggs and living hatchlings together, across both pieces. */
  cap: 3,
  /** About two player shots. */
  eggHp: 2,
  /** A hatchling is a regular worm this many segments long. */
  hatchlingLength: 5,
};

export interface BroodPiece {
  length: number;
  aboveGround: boolean;
  /** The whole worm is down to half its hit points. */
  phaseTwo: boolean;
  /** Eggs plus living hatchlings, from every piece. */
  brood: number;
}

/**
 * A piece's egg timer, ticked every frame: in phase two, and long enough to attack, it lays an
 * egg every interval, the first a full interval in (the timer is off, `undefined`, whenever it
 * can't). An egg falling due while it is under the ground, or at the cap, is held until it is
 * back out and there's room.
 */
export function broodTick(nextLayAt: number | undefined, now: number, piece: BroodPiece): { lay: boolean; nextLayAt: number | undefined } {
  if (!piece.phaseTwo || !canAttack(piece.length)) return { lay: false, nextLayAt: undefined };
  if (nextLayAt === undefined) return { lay: false, nextLayAt: now + WORM_BROOD.layEveryMs };
  if (now < nextLayAt || !piece.aboveGround || piece.brood >= WORM_BROOD.cap) return { lay: false, nextLayAt };
  return { lay: true, nextLayAt: now + WORM_BROOD.layEveryMs };
}

/** Where an egg laid at `laidAt` stands at `now`. */
export function eggStage(laidAt: number, now: number): 'resting' | 'wobbling' | 'hatched' {
  const age = now - laidAt;
  if (age >= WORM_BROOD.hatchMs) return 'hatched';
  return age >= WORM_BROOD.hatchMs - WORM_BROOD.wobbleMs ? 'wobbling' : 'resting';
}
