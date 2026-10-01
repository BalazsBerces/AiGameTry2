import type { Motion } from './animator';
import type { GhoulState } from '../enemies/ghoul';
import type { Bat } from '../enemies/bat';
import { SLIME, type Slime } from '../enemies/slime';
import { STEP } from '../map/floorGenerator';
import type { Worm } from '../bosses/wormChain';

/** What a body reports about how it looks: a state to loop, a frame to hold, a way to face. */
export type Pose = Pick<Motion, 'loop' | 'hold' | 'aim'>;

/** How long each of the two strike frames shows while a lunge or swoop is held. */
const STRIKE_MS = 110;
const strike = (time: number) => ({ action: 'attack' as const, frame: 1 + (Math.floor(time / STRIKE_MS) % 2) });

/**
 * The ghoul's pose from its state: the wind-up held (eyes flared, the tell) for the whole tell,
 * the lunge held while it lunges, both facing the lunge; a winded stoop while it recovers.
 */
export function ghoulPose(state: GhoulState, time: number): Pose {
  switch (state.mode) {
    case 'windUp':
      return { hold: { action: 'attack', frame: 0 }, aim: state.direction };
    case 'lunge':
      return { hold: strike(time), aim: state.direction };
    case 'recover':
      return { loop: 'recover' };
    case 'stalk':
      return {};
  }
}

/**
 * The bat's pose from its state and where it is (in tiles): wings spread wide, hanging still,
 * through the tell, then the swoop held while it swoops, both facing where it dives.
 */
export function batPose(bat: Bat, at: { x: number; y: number }, time: number): Pose {
  switch (bat.mode) {
    case 'telegraph':
      return { hold: { action: 'attack', frame: 0 }, aim: { x: bat.target.x - at.x, y: bat.target.y - at.y } };
    case 'swoop':
      return { hold: strike(time), aim: { x: bat.target.x - at.x, y: bat.target.y - at.y } };
    case 'flutter':
      return {};
  }
}

/**
 * The slime's pose from its state and where it is (in tiles): squashing down deeper through the
 * tell, then stretching through the jump frame by frame (take-off, rise, top, drop), both facing
 * where it jumps; a splat where it lands, settling back up. Resting it breathes, even when shoved.
 */
export function slimePose(slime: Slime, at: { x: number; y: number }, time: number): Pose {
  const rules = SLIME.tiers[slime.tier];
  /** How far through a phase ending at `end`, `ms` long, it is: the frame of `count` to show. */
  const step = (end: number, ms: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor((1 - (end - time) / ms) * count)));
  switch (slime.mode) {
    case 'squash':
      return { hold: { action: 'attack', frame: step(slime.hopAt, rules.squashMs, 3) }, aim: { x: slime.target.x - at.x, y: slime.target.y - at.y } };
    case 'hop':
      return { hold: { action: 'move', frame: step(slime.landAt, slime.landAt - slime.takeoffAt, 4) }, aim: { x: slime.to.x - slime.from.x, y: slime.to.y - slime.from.y } };
    case 'land':
      return { hold: { action: 'land', frame: step(slime.restAt, rules.landMs, 2) } };
    case 'rest':
      return { loop: 'idle' };
  }
}

/** How long before a shot the geode starts to crack open, and how long its core flares after. */
export const GEODE_CHARGE_MS = 520;
const GEODE_FIRE_MS = 220;

/** What a geode's pose reads off its firing timer: when the next shot is due (0 before it has one) and when it last fired. */
export interface GeodeTimer {
  nextShotAt: number;
  firedAt?: number;
}

/**
 * The geode's pose from its firing timer: shut between shots; cracking, then split open to show
 * its crystal core as the shot charges (and held open while it waits for a clear line); its core
 * flaring as it fires.
 */
export function geodePose({ nextShotAt, firedAt }: GeodeTimer, time: number): Pose {
  if (firedAt !== undefined && time - firedAt < GEODE_FIRE_MS) return { hold: { action: 'attack', frame: 2 } };
  if (nextShotAt === 0 || time < nextShotAt - GEODE_CHARGE_MS) return {};
  return { hold: { action: 'attack', frame: time < nextShotAt - GEODE_CHARGE_MS / 2 ? 0 : 1 } };
}

/** The pieces a worm is drawn in: its head, its body segments and its tail. */
export type WormPiece = 'wormHead' | 'wormBody' | 'wormTail';

/** How long each frame of a worm's crawl shows. */
export const WORM_CRAWL_FRAME_MS = 110;

/**
 * The pose of a worm's `index`th segment: its head first (a lone segment is all head), its tail
 * last, body pieces between; the crawl rippling from the head down to the tail, each segment a
 * frame behind the one in front. The head points the way the worm is heading; the rest face the
 * way they glide, so the body bends round each turn as it gets there.
 */
export function wormPose(worm: Worm, index: number, time: number): Pose & { piece: WormPiece } {
  const last = worm.segments.length - 1;
  const piece = index === 0 ? 'wormHead' : index === last ? 'wormTail' : 'wormBody';
  const frame = (((Math.floor(time / WORM_CRAWL_FRAME_MS) - index) % 4) + 4) % 4;
  const hold = { action: 'move' as const, frame };
  return index === 0 ? { piece, hold, aim: { ...STEP[worm.heading] } } : { piece, hold };
}
