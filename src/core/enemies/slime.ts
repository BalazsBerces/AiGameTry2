import type { Rng } from '../rng';

/**
 * The caves' splitting slime. It rests, squashes down (the tell, holding still) while fixing on
 * where the player stands, then hops a fixed distance straight at that spot and sits a moment
 * where it lands. Killed, it splits into two of the next tier down, popped out to either side;
 * the smallest just bursts. Smaller slimes hop more often. Positions in tiles, times in ms.
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
    big: { hp: 3, restMs: 700, squashMs: 450, hopMs: 360, hopDistance: 1.6, landMs: 300 },
    medium: { hp: 2, restMs: 450, squashMs: 380, hopMs: 300, hopDistance: 1.8, landMs: 220 },
    small: { hp: 1, restMs: 250, squashMs: 320, hopMs: 250, hopDistance: 2, landMs: 150 },
  } satisfies Record<SlimeTier, SlimeTierRules>,
  /** What each tier splits into when killed. */
  splitsInto: { big: 'medium', medium: 'small', small: undefined } as Record<SlimeTier, SlimeTier | undefined>,
  /** How far to either side of the death point the two children pop out. */
  splitOffset: 0.4,
};

type Point = { x: number; y: number };

export type Slime =
  | { tier: SlimeTier; mode: 'rest'; squashAt: number }
  | { tier: SlimeTier; mode: 'squash'; target: Point; hopAt: number }
  | { tier: SlimeTier; mode: 'hop'; heading: Point; landAt: number }
  | { tier: SlimeTier; mode: 'land'; restAt: number };

export interface SlimeSenses {
  time: number;
  /** The slime's position. */
  at: Point;
  player: Point;
}

export interface SlimeStep {
  slime: Slime;
  /** How to move this frame (still unless hopping). */
  velocity: Point;
}

const STILL = { x: 0, y: 0 };

export const createSlime = (tier: SlimeTier, time: number, rng: Rng): Slime => ({
  tier,
  mode: 'rest',
  squashAt: time + SLIME.tiers[tier].restMs * (1 + rng.next()),
});

/** One frame of the slime. Pure given the rng. */
export function updateSlime(slime: Slime, { time, at, player }: SlimeSenses, rng: Rng): SlimeStep {
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
      const heading = { x: Math.cos(angle), y: Math.sin(angle) };
      return hopping({ tier, mode: 'hop', heading, landAt: time + rules.hopMs });
    }
    case 'hop':
      if (time < slime.landAt) return hopping(slime);
      return { slime: { tier, mode: 'land', restAt: time + rules.landMs }, velocity: STILL };
    case 'land':
      if (time < slime.restAt) return { slime, velocity: STILL };
      return { slime: { tier, mode: 'rest', squashAt: time + rules.restMs }, velocity: STILL };
  }
}

function hopping(slime: Extract<Slime, { mode: 'hop' }>): SlimeStep {
  const rules = SLIME.tiers[slime.tier];
  const speed = rules.hopDistance / (rules.hopMs / 1000);
  return { slime, velocity: { x: slime.heading.x * speed, y: slime.heading.y * speed } };
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
