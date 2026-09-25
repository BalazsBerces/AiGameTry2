import type { Cell } from './floorGenerator';
import { planLandings } from './lobLanding';
import type { Rng } from './rng';
import type { Door, Tile } from './roomGenerator';

/** The worm boss's phase-one eggs; placeholders for playtest tuning. */
export const WORM_BROOD = {
  /** Before it splits, it lobs this many eggs this long into the fight, then this often... */
  firstLobMs: 4000,
  lobEveryMs: 12000,
  eggsPerLob: 2,
  /** ...each from one of its segments, coming down this far (in tiles, 8-way) from it, after flying this long. */
  lobMinSpread: 2,
  lobSpread: 3,
  flightMs: 900,
  /** An egg hatches this long after it lands, wobbling for the last `wobbleMs`. */
  hatchMs: 4000,
  wobbleMs: 1000,
  /** Eggs (in the air too) and living hatchlings together. */
  cap: 2,
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
 * first `firstLobMs` in (the timer is off, `undefined`, once it has split), only as many as
 * the cap has room for. A lob falling due while it is in the walls or rampaging, or at the cap,
 * is held until it is back out and there's room.
 */
export function broodTick(nextLobAt: number | undefined, now: number, piece: BroodPiece): { eggs: number; nextLobAt: number | undefined } {
  if (piece.split) return { eggs: 0, nextLobAt: undefined };
  if (nextLobAt === undefined) return { eggs: 0, nextLobAt: now + WORM_BROOD.firstLobMs };
  const room = WORM_BROOD.cap - piece.brood;
  if (now < nextLobAt || !piece.aboveGround || room <= 0) return { eggs: 0, nextLobAt };
  return { eggs: Math.min(WORM_BROOD.eggsPerLob, room), nextLobAt: now + WORM_BROOD.lobEveryMs };
}

/**
 * A lob of `count` eggs, each thrown from a random segment of the worm's `body` (core/lobLanding)
 * to open floor `lobMinSpread`-`lobSpread` tiles from it, never that near any other segment, the
 * player's tile or `taken` (eggs already down or on their way). A segment with nowhere to throw
 * to passes to another. An egg may land in a narrow way: it is shot open or hatches soon, so it
 * never cuts anything off for good.
 */
export function planEggLob(tiles: Tile[][], doors: Door[], body: Cell[], player: Cell, taken: Cell[], count: number, rng: Rng): { from: Cell; cell: Cell }[] {
  const same = (a: Cell) => (b: Cell) => a.x === b.x && a.y === b.y;
  const nearWorm = (c: Cell) => body.some((b) => Math.max(Math.abs(c.x - b.x), Math.abs(c.y - b.y)) < WORM_BROOD.lobMinSpread);
  const eggs: { from: Cell; cell: Cell }[] = [];
  for (let i = 0; i < count; i++) {
    const throwers = [...body];
    while (throwers.length) {
      const from = throwers.splice(rng.int(0, throwers.length - 1), 1)[0];
      const [landing] = planLandings(tiles, doors, from, rng, {
        spread: WORM_BROOD.lobSpread,
        minSpread: WORM_BROOD.lobMinSpread,
        count: 1,
        keepOff: (c) => nearWorm(c) || same(player)(c) || taken.some(same(c)) || eggs.some((e) => same(c)(e.cell)),
        lands: () => 'rock',
        openAround: false,
      });
      if (!landing) continue;
      eggs.push({ from, cell: landing.cell });
      break;
    }
  }
  return eggs;
}

/** Where an egg laid at `laidAt` stands at `now`. */
export function eggStage(laidAt: number, now: number): 'resting' | 'wobbling' | 'hatched' {
  const age = now - laidAt;
  if (age >= WORM_BROOD.hatchMs) return 'hatched';
  return age >= WORM_BROOD.hatchMs - WORM_BROOD.wobbleMs ? 'wobbling' : 'resting';
}
