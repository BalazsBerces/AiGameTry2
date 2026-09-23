export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Independent child stream; drawing from it never shifts this stream. */
  fork(label: string): Rng;
}

function hashString(text: string, seed: number): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const origin = seed >>> 0;
  let state = origin;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    fork: (label) => createRng(hashString(label, origin)),
  };
}
