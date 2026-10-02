import type { Motion } from './animator';
import type { GhoulState } from '../enemies/ghoul';
import type { Bat } from '../enemies/bat';
import { SLIME, type Slime } from '../enemies/slime';
import { GEODE, type Geode, type GeodeRules } from '../enemies/geode';
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

/** How long the geode's core flares after a shot. */
const GEODE_FIRE_MS = 220;

/**
 * The geode's pose from its state (none yet before its first update): plain rock while shut;
 * cracking, then split open to show its crystal core, through the opening delay; split open
 * while it stays open; its core flaring just after each shot.
 */
export function geodePose(geode: Geode | undefined, time: number, rules: GeodeRules = GEODE): Pose {
  if (!geode?.open) return {};
  if (geode.firedAt !== undefined && time - geode.firedAt < GEODE_FIRE_MS) return { hold: { action: 'attack', frame: 2 } };
  return { hold: { action: 'attack', frame: time - geode.openedAt < rules.openDelayMs / 2 ? 0 : 1 } };
}

/** The pieces a worm is drawn in: its head, its body segments and its tail; a hatchling's pale ones. */
export type WormPiece = 'wormHead' | 'wormBody' | 'wormTail' | 'hatchlingHead' | 'hatchlingBody' | 'hatchlingTail';

/** How long each frame of a worm's crawl shows. */
export const WORM_CRAWL_FRAME_MS = 110;
/** How long a worm's plate is, in cells: longer than one, so neighbours overlap at every bend. */
export const WORM_PLATE_CELLS = 1.25;

/** Where a worm's segments are gliding from (one cell each, head first), and how far through the step they are (0–1). */
export interface WormGlide {
  from: readonly Cell[];
  progress: number;
}

/** Where a segment's plate lies on the worm's spine: `offset` (in cells) from its shape's centre, `angle` (radians) the way the spine runs there. */
export interface Spine {
  offset: { x: number; y: number };
  angle: number;
}

type Vec = { x: number; y: number };
/** The step from `a` to `b`, if they are neighbours. */
const stepBetween = (a: Cell | undefined, b: Cell | undefined): Vec | undefined =>
  a && b && Math.abs(b.x - a.x) + Math.abs(b.y - a.y) === 1 ? { x: b.x - a.x, y: b.y - a.y } : undefined;
const scaled = (v: Vec, k: number) => ({ x: v.x * k, y: v.y * k });

/**
 * The spine through one cell, from the edge it comes in by (`t` -0.5) through the middle (0) to
 * the edge it leaves by (0.5), relative to the cell's centre: straight on, or a quarter circle
 * round the inside corner where it turns (`din` in, `dout` out). The head has nothing ahead of it
 * to round a corner with, nor the tail anything behind: they keep to their straight glide through
 * a corner cell's half and turn smoothly on the way.
 */
function spineThrough(din: Vec | undefined, dout: Vec | undefined, t: number, end: { head: boolean; tail: boolean }): { at: Vec; dir: Vec } | undefined {
  if (!din || !dout || din.x * dout.x + din.y * dout.y !== 0) {
    const d = dout ?? din;
    return d && { at: scaled(d, t), dir: d };
  }
  const turned = (share: number) => {
    const a = share * (Math.PI / 2);
    return { x: Math.cos(a) * din.x + Math.sin(a) * dout.x, y: Math.cos(a) * din.y + Math.sin(a) * dout.y };
  };
  // The head and tail glide straight on and turn on the way, easing in and out of it.
  const ease = (w: number) => w * w * (3 - 2 * w);
  if (end.head && t >= 0) return { at: scaled(dout, t), dir: turned(ease(2 * t)) };
  if (end.tail && t <= 0) return { at: scaled(din, t), dir: turned(ease(2 * t + 1)) };
  // Round the corner between the edges' midpoints, half a cell from the inside corner.
  const a = (t + 0.5) * (Math.PI / 2);
  const rim = { x: Math.sin(a) * din.x - Math.cos(a) * dout.x, y: Math.sin(a) * din.y - Math.cos(a) * dout.y };
  return { at: { x: (dout.x - din.x + rim.x) / 2, y: (dout.y - din.y + rim.y) / 2 }, dir: turned(t + 0.5) };
}

/**
 * Where a worm's `index`th segment lies on its one continuous spine, gliding as `glide` says (or
 * lying still on its cell if it doesn't): its shape glides straight from cell to cell, cutting
 * across corners, while its plate curves round them, turning smoothly as it goes.
 */
export function wormSpine(worm: Worm, index: number, glide?: WormGlide): Spine {
  const segs = worm.segments;
  const b = segs[index];
  const a = glide?.from[index] ?? b;
  const k = Math.min(1, Math.max(0, glide?.progress ?? 1));
  const end = { head: index === 0, tail: index === segs.length - 1 };
  const heading = STEP[worm.heading];
  const ahead = index > 0 ? stepBetween(b, segs[index - 1]) : undefined;
  const fallback = end.head ? heading : ahead ?? stepBetween(segs[index + 1], b) ?? heading;
  const still = a.x === b.x && a.y === b.y;
  const move = stepBetween(a, b);
  const angleOf = (d: Vec) => Math.atan2(d.y, d.x);
  if (!still && !move) return { offset: { x: 0, y: 0 }, angle: angleOf({ x: b.x - a.x, y: b.y - a.y }) };
  // Leaving the cell it glides from for the first half of the step, coming into the next for the second.
  // `ideal` is where its shape is, from the middle of that cell.
  const piece = still
    ? { ideal: { x: 0, y: 0 }, line: spineThrough(stepBetween(segs[index + 1], b), ahead, 0, end) }
    : k < 0.5
      ? { ideal: scaled(move!, k), line: spineThrough(stepBetween(glide!.from[index + 1], a), move, k, end) }
      : { ideal: scaled(move!, k - 1), line: spineThrough(move, ahead, k - 1, end) };
  // Only a segment lying still with no neighbour on another cell (a coiled hatchling) has no spine through it.
  const line = piece.line ?? { at: { x: 0, y: 0 }, dir: fallback };
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return { offset: { x: clean(line.at.x - piece.ideal.x), y: clean(line.at.y - piece.ideal.y) }, angle: angleOf(line.dir) };
}

/**
 * The pose of a worm's `index`th segment: its head first (a lone segment is all head), its tail
 * last, body pieces between; the crawl rippling from the head down to the tail, each segment a
 * frame behind the one in front; its plate on the worm's spine (`wormSpine`), turned the way the
 * spine runs there. A `hatchling` (hatched from the worm boss's egg) wears its pale pieces.
 */
export function wormPose(worm: Worm, index: number, time: number, glide?: WormGlide, hatchling = false): Pose & Spine & { piece: WormPiece } {
  const last = worm.segments.length - 1;
  const piece = `${hatchling ? 'hatchling' : 'worm'}${index === 0 ? 'Head' : index === last ? 'Tail' : 'Body'}` as const;
  const frame = (((Math.floor(time / WORM_CRAWL_FRAME_MS) - index) % 4) + 4) % 4;
  return { piece, hold: { action: 'move' as const, frame }, ...wormSpine(worm, index, glide) };
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
/** How long a segment's plates part as it lobs an egg: the egg heaving out between them, then gone. */
export const LOB_HEAVE_MS = 300;
/** How long before it pops a dying segment's seams blaze, light splintering through its plates. */
export const POP_WARN_MS = 250;

/** How far a piece of the worm boss's art reaches from its plate's centre, in cells: half its canvas's length. */
export const WORM_BOSS_REACH = 1.5;

/**
 * How much of a plate shows as it burrows: cut at the edge of the hole's mouth, `at` (in cells)
 * from its shape's centre, `into` pointing into the wall, showing only what is on the room side;
 * or none of it, all inside the wall. A plate with no clip is all in the room.
 */
export type WallClip = { at: Vec; into: Vec } | 'hidden';

/**
 * Where the wall cuts the worm's `index`th segment's plate (lying `spine` from its shape's
 * centre), if it does: at the mouth of a hole its body runs through near it, wherever its spine
 * crosses from a cell in the room to one in the wall. All of it is hidden once it is out of
 * reach of the mouth inside the wall, or racing through the rock from one hole to the other.
 */
function wallClip(worm: Worm, index: number, glide: WormGlide | undefined, room: { w: number; h: number }, spine: Spine): WallClip | undefined {
  const inWall = (c: Cell) => c.x < 0 || c.y < 0 || c.x >= room.w || c.y >= room.h;
  const segs = worm.segments;
  const b = segs[index];
  const a = glide?.from[index] ?? b;
  const k = Math.min(1, Math.max(0, glide?.progress ?? 1));
  const still = a.x === b.x && a.y === b.y;
  if (!still && !stepBetween(a, b)) return inWall(a) && inWall(b) ? 'hidden' : undefined;
  const centre = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  const plate = { x: centre.x + spine.offset.x, y: centre.y + spine.offset.y };
  // The spine runs head to tail through its cells, and on to the cell its tail glides from.
  const chain = glide ? [...segs, glide.from[segs.length - 1]] : segs;
  const mouths = [-2, -1, 0, 1, 2].flatMap((j) => {
    const [p, q] = [chain[index + j], chain[index + j + 1]];
    if (!stepBetween(p, q) || inWall(p) === inWall(q)) return [];
    const [open, wall] = inWall(q) ? [p, q] : [q, p];
    const at = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const into = { x: wall.x - open.x, y: wall.y - open.y };
    return [{ at, into, depth: (plate.x - at.x) * into.x + (plate.y - at.y) * into.y, far: Math.hypot(plate.x - at.x, plate.y - at.y) }];
  });
  const mouth = mouths.sort((m, n) => m.far - n.far)[0];
  if (!mouth) return inWall(a) && inWall(b) ? 'hidden' : undefined;
  if (mouth.depth >= WORM_BOSS_REACH) return 'hidden';
  if (mouth.depth <= -WORM_BOSS_REACH) return undefined;
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return { at: { x: clean(mouth.at.x - centre.x), y: clean(mouth.at.y - centre.y) }, into: mouth.into };
}

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
  /** Where its segments are gliding from, and how far through the step; none while it lies still. */
  glide?: WormGlide;
}

/**
 * The pose of the worm boss's `index`th segment, each lasting exactly as long as the phase of the
 * fight it acts out: dying, each segment's seams blaze just before it pops on the death chain;
 * through the stop at its split it roars, its torn end jagged broken glass leaking light; holding
 * still while its twin blows apart; roaring through its last stand's roar, mandibles splayed and
 * its whole body blazing; its maw pulsing through a spit wave as each segment's seams flare in
 * turn; its mandibles spread wide and seams brightening while it charges up and between lunges,
 * snapped shut as it lunges, its body taut; a segment's plates parting as an egg heaves out of it.
 * Otherwise it crawls like any worm. Whatever it does, its plate lies on its spine
 * like any worm's (`wormSpine`), and burrowing it slides into the rock, cut off at the hole's
 * mouth, and out of the far wall the same way (`clip`).
 */
export function wormBossPose(look: WormBossLook, index: number, time: number): Pose & Spine & { piece: WormBossPiece; clip?: WallClip } {
  const { worm, room, moment } = look;
  const last = worm.segments.length - 1;
  const piece = index === 0 ? 'wormBossHead' : index === last ? 'wormBossTail' : 'wormBossBody';
  const spine = wormSpine(worm, index, look.glide);
  const clip = wallClip(worm, index, look.glide, room, spine);
  const pose = (hold?: Pose['hold']) => ({ piece, ...(hold ? { hold } : {}), ...spine, ...(clip ? { clip } : {}) }) as Pose & Spine & { piece: WormBossPiece; clip?: WallClip };
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
  if (look.rampage === 'lunging') return pose({ action: 'lunge', frame: (((Math.floor(time / WORM_CRAWL_FRAME_MS) - index) % 2) + 2) % 2 });
  const { heave } = look;
  if (heave && heave.segments.includes(index) && time - heave.start < LOB_HEAVE_MS) {
    return pose({ action: 'lob', frame: time - heave.start < LOB_HEAVE_MS / 2 ? 0 : 1 });
  }
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
