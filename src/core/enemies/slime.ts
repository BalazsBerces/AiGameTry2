import type { Rng } from '../rng';

/**
 * The caves' splitting slime. It rests, squashes down (the tell, holding still) while fixing on
 * where the player stands, then jumps straight at that spot and sits a moment where it lands.
 * The jump is airborne, over rocks and pits alike, but it only ever comes down on free floor:
 * the farthest spot along its line, up to its hop distance, that it can land on. With none, it
 * doesn't jump and aims afresh. Killed, it splits into two of the next tier down, popped out to
 * either side; the smallest just bursts. Smaller slimes hop more often. Positions in tiles, times in ms.
 */
export type SlimeTier = 'big' | 'medium' | 'small';

export interface SlimeTierRules {
  hp: number;
  /** Rest between landing's pause and the next squash (and, up to as long again, before the first). */
  restMs: number;
  squashMs: number;
  hopMs: number;
  hopDistance: number;
  landMs: number;
}

/** Placeholder numbers for playtest tuning. */
export const SLIME = {
  tiers: {
    big: { hp: 3, restMs: 400, squashMs: 380, hopMs: 650, hopDistance: 3.3, landMs: 200 },
    medium: { hp: 2, restMs: 260, squashMs: 320, hopMs: 560, hopDistance: 3.6, landMs: 150 },
    small: { hp: 1, restMs: 250, squashMs: 280, hopMs: 520, hopDistance: 3.1, landMs: 120 },
  } satisfies Record<SlimeTier, SlimeTierRules>,
  /** The shortest jump worth making: a landing spot nearer than this doesn't count. */
  minHop: 0.5,
  /** How much free floor a landing spot needs round it, so the body doesn't come down half on a rock. */
  landClearance: 0.3,
  /** With nowhere to land along its line, it rests this long and aims again. */
  reaimMs: 150,
  /** What each tier splits into when killed. */
  splitsInto: { big: 'medium', medium: 'small', small: undefined } as Record<SlimeTier, SlimeTier | undefined>,
  /** How far to either side of the death point the two children pop out. */
  splitOffset: 0.4,
};

type Point = { x: number; y: number };

export type Slime =
  | { tier: SlimeTier; mode: 'rest'; squashAt: number }
  | { tier: SlimeTier; mode: 'squash'; target: Point; hopAt: number }
  | { tier: SlimeTier; mode: 'hop'; from: Point; to: Point; takeoffAt: number; landAt: number }
  | { tier: SlimeTier; mode: 'land'; restAt: number };

export interface SlimeSenses {
  time: number;
  /** The slime's position. */
  at: Point;
  player: Point;
  /** Whether a point is free floor it can come down on (not rock, pit, thorns or outside the room). */
  canLandAt(p: Point): boolean;
  /** Whether it can fly over a point: not a room wall. Everywhere if left out. */
  canCross?(p: Point): boolean;
  /** Its hop distance is multiplied by this (a champion's speed); 1 if left out. */
  reach?: number;
}

export interface SlimeStep {
  slime: Slime;
  /** How to move this frame (still unless hopping). */
  velocity: Point;
  /** How far through its jump it is, 0 at take-off to 1 at landing, for drawing the arc; none on the ground. */
  airborne?: number;
}

const STILL = { x: 0, y: 0 };

export const createSlime = (tier: SlimeTier, time: number, rng: Rng): Slime => ({
  tier,
  mode: 'rest',
  squashAt: time + SLIME.tiers[tier].restMs * (1 + rng.next()),
});

/** One frame of the slime. Pure given the rng. */
export function updateSlime(slime: Slime, { time, at, player, canLandAt, canCross = () => true, reach = 1 }: SlimeSenses, rng: Rng): SlimeStep {
  const rules = SLIME.tiers[slime.tier];
  const { tier } = slime;
  switch (slime.mode) {
    case 'rest':
      if (time < slime.squashAt) return { slime, velocity: STILL };
      return { slime: { tier, mode: 'squash', target: { ...player }, hopAt: time + rules.squashMs }, velocity: STILL };
    case 'squash': {
      if (time < slime.hopAt) return { slime, velocity: STILL };
      const dx = slime.target.x - at.x;
      const dy = slime.target.y - at.y;
      const d = Math.hypot(dx, dy);
      // Straight on the spot it fixed on; if it sits right on it, any way at all.
      const angle = d > 0 ? Math.atan2(dy, dx) : rng.next() * Math.PI * 2;
      const to = landingAlong(at, { x: Math.cos(angle), y: Math.sin(angle) }, rules.hopDistance * reach, canLandAt, canCross);
      if (!to) return { slime: { tier, mode: 'rest', squashAt: time + SLIME.reaimMs }, velocity: STILL };
      return hopping({ tier, mode: 'hop', from: { ...at }, to, takeoffAt: time, landAt: time + rules.hopMs }, time);
    }
    case 'hop':
      if (time < slime.landAt) return hopping(slime, time);
      return { slime: { tier, mode: 'land', restAt: time + rules.landMs }, velocity: STILL };
    case 'land':
      if (time < slime.restAt) return { slime, velocity: STILL };
      return { slime: { tier, mode: 'rest', squashAt: time + rules.restMs }, velocity: STILL };
  }
}

/** How finely the line is searched for a landing spot, in tiles. */
const LANDING_STEP = 0.05;

/**
 * The farthest spot along `heading` from `at`, no farther than `reach` nor past anything it can't
 * cross, with free floor under it and round it; none if the whole line is blocked.
 */
function landingAlong(
  at: Point,
  heading: Point,
  reach: number,
  canLandAt: (p: Point) => boolean,
  canCross: (p: Point) => boolean,
): Point | undefined {
  const r = SLIME.landClearance;
  const clear = (p: Point) =>
    [p, { x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }, { x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }].every(canLandAt);
  let landing: Point | undefined;
  for (let s = LANDING_STEP; s <= reach + 1e-9; s += LANDING_STEP) {
    const p = { x: at.x + heading.x * s, y: at.y + heading.y * s };
    if (!canCross(p)) break;
    if (s >= SLIME.minHop && clear(p)) landing = p;
  }
  return landing;
}

function hopping(slime: Extract<Slime, { mode: 'hop' }>, time: number): SlimeStep {
  const ms = slime.landAt - slime.takeoffAt;
  const velocity = { x: (slime.to.x - slime.from.x) / (ms / 1000), y: (slime.to.y - slime.from.y) / (ms / 1000) };
  return { slime, velocity, airborne: Math.min(1, (time - slime.takeoffAt) / ms) };
}

export interface SlimeBody {
  tier: SlimeTier;
  champion: boolean;
  /** Crowned because its parent was a champion: it doesn't pass the crown on. */
  inherited?: boolean;
}

export interface SlimeChild extends Required<SlimeBody> {
  hp: number;
  at: Point;
}

/**
 * The two slimes a killed one splits into, one to either side of where it died; none from the
 * smallest. A champion's own children are champions too, but theirs are not.
 */
export function splitSlime(parent: SlimeBody, at: Point): SlimeChild[] {
  const tier = SLIME.splitsInto[parent.tier];
  if (!tier) return [];
  const champion = parent.champion && !parent.inherited;
  return [-1, 1].map((side) => ({
    tier,
    hp: SLIME.tiers[tier].hp,
    champion,
    inherited: champion,
    at: { x: at.x + side * SLIME.splitOffset, y: at.y },
  }));
}
