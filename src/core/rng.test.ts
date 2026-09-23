import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

const draw = (rng: { next(): number }, n: number) => Array.from({ length: n }, () => rng.next());

describe('createRng', () => {
  it('drawing from a forked stream does not shift the parent stream', () => {
    const untouched = createRng(7);
    const forked = createRng(7);
    draw(forked.fork('room 3'), 50);
    expect(draw(forked, 10)).toEqual(draw(untouched, 10));
  });

  it('forks with different labels produce different streams', () => {
    const rng = createRng(7);
    expect(draw(rng.fork('floor 0'), 5)).not.toEqual(draw(rng.fork('floor 1'), 5));
  });

  it('forks with the same label are reproducible', () => {
    expect(draw(createRng(7).fork('floor 0'), 5)).toEqual(draw(createRng(7).fork('floor 0'), 5));
  });
});
