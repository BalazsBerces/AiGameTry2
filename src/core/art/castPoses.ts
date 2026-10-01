import type { Motion } from './animator';
import type { GhoulState } from '../enemies/ghoul';
import type { Bat } from '../enemies/bat';
import { SLIME, type Slime } from '../enemies/slime';
import { STEP, type Cell } from '../map/floorGenerator';
import type { Worm } from '../bosses/wormChain';
import { deathChain, isRoaring, type BossMoment, type SpitShot } from '../bosses/wormBossAttack';
import { WORM_BROOD } from '../bosses/wormBrood';

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

/** The pieces the worm boss is drawn in: the worm's, grown huge. */
export type WormBossPiece = 'wormBossHead' | 'wormBossBody' | 'wormBossTail';

/** How long each beat of its roar shows (maw splayed, then settling), and of its maw pulsing through a spit wave. */
const ROAR_BEAT_MS = 150;
const MAW_PULSE_MS = 90;
/** How long a segment flares as its spit leaves it. */
const SPIT_FLARE_MS = 100;
/** How long each shudder of its charge-up shows. */
const CHARGE_SHUDDER_MS = 70;
/** How long its torn end twitches each way through the split. */
const SPLIT_TWITCH_MS = 90;
/** How long a segment heaves as it lobs an egg: heaving up, then letting go. */
export const LOB_HEAVE_MS = 300;
/** How long before it pops a dying segment's crystals blaze, splintering through its plates. */
export const POP_WARN_MS = 250;

/** What the worm boss's paper puppet reads off one of its pieces (a whole worm, or a half of it). */
export interface WormBossLook {
  worm: Worm;
  /** The room's size in cells: segments outside it are in the walls. */
  room: { w: number; h: number };
  /** The moments it holds still for: its split, its twin's death, its roar. */
  moment?: BossMoment;
  /** Its end torn open at the split. */
  rawEnd?: 'head' | 'tail';
  /** Where it is in a rampage, if it is in one. */
  rampage?: 'charging' | 'lunging' | 'pausing' | 'over';
  /** Its last spit wave running down its body: shown until the last segment's flare is done. */
  spit?: { start: number; shots: readonly SpitShot[] };
  /** The segments it last lobbed eggs from, and when. */
  heave?: { segments: readonly number[]; start: number };
  /** When it died, blowing apart. */
  dying?: { at: number };
}

/**
 * The pose of the worm boss's `index`th segment, each lasting exactly as long as the phase of the
 * fight it acts out: dying, it cracks and each segment's crystals blaze just before it pops on the
 * death chain; through the stop at its split it roars, its torn end showing a raw crystal core;
 * holding still while its twin blows apart; roaring through its last stand's roar, maw splayed
 * and crystals flaring; its maw pulsing through a spit wave as each segment flares in turn; its
 * head tucked and shards forward while it charges up and between lunges; a segment heaving as it
 * lobs an egg; burrowing into the walls and out of them. Otherwise it crawls like any worm.
 */
export function wormBossPose(look: WormBossLook, index: number, time: number): Pose & { piece: WormBossPiece } {
  const { worm, room, moment } = look;
  const last = worm.segments.length - 1;
  const piece = index === 0 ? 'wormBossHead' : index === last ? 'wormBossTail' : 'wormBossBody';
  const aim = index === 0 ? { aim: { ...STEP[worm.heading] } } : {};
  const pose = (hold?: Pose['hold']) => ({ piece, ...(hold ? { hold } : {}), ...aim }) as Pose & { piece: WormBossPiece };
  const beat = (ms: number) => Math.floor(time / ms) % 2;
  if (look.dying) {
    const pop = deathChain(worm.segments.length).pops.find((p) => p.segment === index)!;
    return pose({ action: 'die', frame: time - look.dying.at >= pop.atMs - POP_WARN_MS ? 1 : 0 });
  }
  const roar = { action: 'attack' as const, frame: 1 + beat(ROAR_BEAT_MS) };
  if (moment?.phase === 'splitStop' && time < moment.until) {
    const torn = look.rawEnd === 'head' ? index === 0 : look.rawEnd === 'tail' && index === last;
    return pose(torn ? { action: 'split', frame: beat(SPLIT_TWITCH_MS) } : roar);
  }
  if (moment?.phase === 'deathHold' && time < moment.until) return pose();
  if (isRoaring(moment, time)) return pose(roar);
  const { spit } = look;
  // The wave lasts until the last segment's flare is done.
  if (spit && time - spit.start < Math.max(...spit.shots.map((s) => s.atMs)) + SPIT_FLARE_MS) {
    if (index === 0) return pose({ action: 'spit', frame: beat(MAW_PULSE_MS) });
    const shot = spit.shots.find((s) => s.segment === index);
    const since = shot ? time - spit.start - shot.atMs : -1;
    return pose({ action: 'spit', frame: since >= 0 && since < SPIT_FLARE_MS ? 1 : 0 });
  }
  if (look.rampage === 'charging' || look.rampage === 'pausing') return pose({ action: 'charge', frame: beat(CHARGE_SHUDDER_MS) });
  const { heave } = look;
  if (heave && heave.segments.includes(index) && time - heave.start < LOB_HEAVE_MS) {
    return pose({ action: 'lob', frame: time - heave.start < LOB_HEAVE_MS / 2 ? 0 : 1 });
  }
  const inWall = (c: Cell | undefined) => !!c && (c.x < 0 || c.y < 0 || c.x >= room.w || c.y >= room.h);
  if (inWall(worm.segments[index])) return pose({ action: 'burrow', frame: 0 });
  if (inWall(worm.segments[index + 1])) return pose({ action: 'burrow', frame: 1 });
  return pose(wormPose(worm, index, time).hold);
}

/**
 * A worm boss's egg laid at `laidAt`: resting until it starts to wobble, then cracking ever wider
 * frame by frame through the wobble until it hatches.
 */
export function eggPose(laidAt: number, time: number): Pose {
  const into = time - laidAt - (WORM_BROOD.hatchMs - WORM_BROOD.wobbleMs);
  if (into < 0) return {};
  return { hold: { action: 'attack', frame: Math.min(2, Math.floor((into / WORM_BROOD.wobbleMs) * 3)) } };
}
