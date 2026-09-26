import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { BURSTS, createScraps } from './scraps';

const at = { x: 100, y: 200 };
const palette = [0xa8c236, 0x6a4a2a];

describe('paper scrap bursts', () => {
  it('bursts the same way every time for the same seed', () => {
    expect(createScraps(9).burst('death', at, palette)).toEqual(createScraps(9).burst('death', at, palette));
    expect(createScraps(9).burst('death', at, palette)).not.toEqual(createScraps(10).burst('death', at, palette));
  });

  it('makes each kind of burst its own size, all scraps starting where it happened in the palette given', () => {
    const scraps = createScraps(1);
    for (const kind of ['death', 'impact', 'confetti'] as const) {
      const burst = scraps.burst(kind, at, palette);
      expect(burst).toHaveLength(BURSTS[kind].count);
      for (const s of burst) {
        expect({ x: s.x, y: s.y }).toEqual(at);
        expect(palette).toContain(s.color);
        const speed = Math.hypot(s.vx, s.vy);
        expect(speed).toBeGreaterThanOrEqual(BURSTS[kind].speed[0] - 1e-9);
        expect(speed).toBeLessThanOrEqual(BURSTS[kind].speed[1] + 1e-9);
        expect(s.lifeMs).toBeGreaterThan(0);
      }
    }
  });

  it('never draws from the run\'s own random stream, so a seeded run plays out the same', () => {
    const quiet = createRng(42);
    const busy = createRng(42);
    const scraps = createScraps(42);
    const a = [quiet.next(), quiet.next(), quiet.next()];
    const b = [busy.next(), (scraps.burst('confetti', at, palette), busy.next()), (scraps.burst('death', at, palette), busy.next())];
    expect(b).toEqual(a);
  });
});
