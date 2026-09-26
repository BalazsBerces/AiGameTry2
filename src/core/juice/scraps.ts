import { createRng } from '../rng';

/** One torn scrap of paper flying off a burst. */
export interface Scrap {
  x: number;
  y: number;
  /** px/s. */
  vx: number;
  vy: number;
  /** Degrees/s. */
  spin: number;
  /** Starting angle, degrees. */
  angle: number;
  /** Across, px. */
  size: number;
  color: number;
  /** Which of the torn shapes it is cut as (0-2). */
  shape: number;
  lifeMs: number;
}

/**
 * The kinds of burst: an enemy torn apart, a shot's flecks where it hits, a bomb's confetti.
 * `speed` is px/s, `size` px, `life` ms, each a [min, max] range.
 */
export const BURSTS = {
  death: { count: 16, speed: [70, 220], size: [5, 11], life: [500, 850] },
  impact: { count: 4, speed: [40, 110], size: [2, 4], life: [200, 350] },
  confetti: { count: 28, speed: [90, 320], size: [3, 7], life: [600, 1000] },
} as const;

export type BurstKind = keyof typeof BURSTS;

export interface Scraps {
  /** A burst of `kind` at `at` in `palette`'s colours. */
  burst(kind: BurstKind, at: { x: number; y: number }, palette: readonly number[]): Scrap[];
}

/**
 * Paper scrap bursts, drawn from their own random stream: visual randomness never touches the
 * run's seeded stream, so a seeded run plays out the same whatever bursts.
 */
export function createScraps(seed: number): Scraps {
  const rng = createRng(seed).fork('scraps');
  const between = ([lo, hi]: readonly [number, number]) => lo + rng.next() * (hi - lo);
  return {
    burst(kind, at, palette) {
      const rules = BURSTS[kind];
      return Array.from({ length: rules.count }, (_, i) => {
        // Spread evenly round the circle, each nudged, so a burst never clumps to one side.
        const a = ((i + rng.next() * 0.8) / rules.count) * Math.PI * 2;
        const speed = between(rules.speed);
        return {
          x: at.x,
          y: at.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          spin: between([-540, 540]),
          angle: rng.next() * 360,
          size: between(rules.size),
          color: palette[rng.int(0, palette.length - 1)],
          shape: rng.int(0, 2),
          lifeMs: between(rules.life),
        };
      });
    },
  };
}
