import { DIRECTIONS, STEP, type Cell, type Direction } from './floorGenerator';
import type { Rng } from './rng';

export interface Worm {
  /** Grid cells, head first. */
  segments: Cell[];
  heading: Direction;
}

export function createWorm(segments: Cell[], heading: Direction): Worm {
  return { segments: segments.map((c) => ({ ...c })), heading };
}

/** Chance per step to turn left/right even when the way ahead is clear. */
export const WORM_TURN_CHANCE = 0.2;

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * Advances the worm one cell. It keeps going straight, turns randomly now and then, turns
 * when blocked, and reverses (tail becomes head) when boxed in. Never reverses otherwise.
 */
export function stepWorm(worm: Worm, rng: Rng, blocked: (c: Cell) => boolean, turnChance = WORM_TURN_CHANCE): Worm {
  const head = worm.segments[0];
  // The tail cell is vacated during the move, so the head may enter it.
  const body = new Set(worm.segments.slice(0, -1).map((c) => `${c.x},${c.y}`));
  const free = (d: Direction) => {
    const next = { x: head.x + STEP[d].x, y: head.y + STEP[d].y };
    return !blocked(next) && !body.has(`${next.x},${next.y}`);
  };
  const turns = DIRECTIONS.filter((d) => d !== worm.heading && d !== OPPOSITE[worm.heading] && free(d));
  let heading: Direction | undefined;
  if (free(worm.heading) && (turns.length === 0 || rng.next() >= turnChance)) heading = worm.heading;
  else if (turns.length) heading = rng.pick(turns);
  if (!heading) {
    const reversed = [...worm.segments].reverse();
    return createWorm(reversed, bodyHeading(reversed, OPPOSITE[worm.heading]));
  }
  const next = { x: head.x + STEP[heading].x, y: head.y + STEP[heading].y };
  return createWorm([next, ...worm.segments.slice(0, -1)], heading);
}

/** The direction from the second segment to the head, or `fallback` for a lone segment. */
function bodyHeading(segments: Cell[], fallback: Direction): Direction {
  if (segments.length < 2) return fallback;
  const dx = segments[0].x - segments[1].x;
  const dy = segments[0].y - segments[1].y;
  return (DIRECTIONS.find((d) => STEP[d].x === dx && STEP[d].y === dy) ?? fallback);
}

/** Kills one segment. Returns the worms that remain: zero, one (shortened) or two (split). */
export function killSegment(worm: Worm, index: number): Worm[] {
  const front = worm.segments.slice(0, index);
  const back = worm.segments.slice(index + 1);
  const pieces: Worm[] = [];
  if (front.length) pieces.push(createWorm(front, worm.heading));
  if (back.length) pieces.push(createWorm(back, bodyHeading(back, worm.heading)));
  return pieces;
}
