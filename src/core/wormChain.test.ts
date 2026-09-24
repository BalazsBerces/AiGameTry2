import { describe, expect, it } from 'vitest';
import { nextStepDue } from './wormChain';

describe('worm step timing', () => {
  it('keeps a steady beat when frames arrive on time', () => {
    expect(nextStepDue(1000, 1005, 300)).toBe(1300);
  });

  it('takes one step after a long pause and then waits a full step, instead of rushing to catch up', () => {
    const due = nextStepDue(1000, 31000, 300);
    expect(due).toBe(31300);
    // The next frame is not due another step.
    expect(31016 < due).toBe(true);
  });
});
import { createRng } from './rng';
import { createWorm, killBossSegment, killSegment, stepWorm } from './wormChain';

/** A 5-segment worm heading right, head at x=4, tail at x=0. */
const worm = () =>
  createWorm(
    [4, 3, 2, 1, 0].map((x) => ({ x, y: 0 })),
    'right',
  );

describe('stepWorm', () => {
  // 9x5 arena; a pillar in the middle.
  const blocked = (c: { x: number; y: number }) => c.x < 0 || c.y < 0 || c.x > 8 || c.y > 4 || (c.x === 4 && c.y === 2);

  it('moves the head one cardinal cell and drags the body along', () => {
    const before = worm();
    const after = stepWorm(before, createRng(1), (c) => c.x > 20);
    const [hx, hy] = [after.segments[0].x - before.segments[0].x, after.segments[0].y - before.segments[0].y];
    expect(Math.abs(hx) + Math.abs(hy)).toBe(1);
    expect(after.segments.slice(1)).toEqual(before.segments.slice(0, -1));
  });

  it('stays contiguous, never overlaps itself and never enters blocked cells', () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);
      let w = worm();
      for (let i = 0; i < 200; i++) {
        w = stepWorm(w, rng, blocked);
        const keys = w.segments.map((s) => `${s.x},${s.y}`);
        expect(new Set(keys).size, `seed ${seed} step ${i}`).toBe(w.segments.length);
        for (const s of w.segments) expect(blocked(s), `seed ${seed} step ${i}`).toBe(false);
        for (let k = 1; k < w.segments.length; k++) {
          const d = Math.abs(w.segments[k].x - w.segments[k - 1].x) + Math.abs(w.segments[k].y - w.segments[k - 1].y);
          expect(d, `seed ${seed} step ${i}`).toBe(1);
        }
      }
    }
  });

  it('turns now and then even when nothing is in the way', () => {
    const rng = createRng(3);
    let w = createWorm([{ x: 0, y: 0 }], 'right');
    const headings = new Set<string>();
    for (let i = 0; i < 100; i++) {
      w = stepWorm(w, rng, () => false);
      headings.add(w.heading);
    }
    expect(headings.size).toBeGreaterThan(1);
  });
});

describe('killSegment', () => {
  it('killing a middle segment splits the worm in two', () => {
    const pieces = killSegment(worm(), 2);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].segments).toEqual([{ x: 4, y: 0 }, { x: 3, y: 0 }]);
    expect(pieces[1].segments.map((s) => s.x).sort()).toEqual([0, 1]);
  });

  it('the split-off tail gets its head at the cut, facing the gap', () => {
    const [, tail] = killSegment(worm(), 2);
    expect(tail.segments[0]).toEqual({ x: 1, y: 0 });
    expect(tail.heading).toBe('right');
  });

  it('a split-off tail of a bent worm faces along its own body', () => {
    // Head at (1,0) moving right; body bends down: (0,0), (0,1), (0,2).
    const bent = createWorm([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }], 'right');
    const [, tail] = killSegment(bent, 1);
    expect(tail.segments[0]).toEqual({ x: 0, y: 1 });
    expect(tail.heading).toBe('up');
  });

  it('killing the head shortens the worm from the front', () => {
    const pieces = killSegment(worm(), 0);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].segments[0]).toEqual({ x: 3, y: 0 });
    expect(pieces[0].segments).toHaveLength(4);
  });

  it('killing the tail shortens the worm from the back', () => {
    const pieces = killSegment(worm(), 4);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].segments).toEqual([4, 3, 2, 1].map((x) => ({ x, y: 0 })));
  });

  it('killing the last segment leaves no worm', () => {
    expect(killSegment(createWorm([{ x: 0, y: 0 }], 'up'), 0)).toEqual([]);
  });
});

describe('killBossSegment', () => {
  /** A 20-segment boss lying along a snake of rows, head at the top left. */
  const boss = () =>
    createWorm(
      Array.from({ length: 20 }, (_, i) => ({ x: Math.floor(i / 5) % 2 ? 4 - (i % 5) : i % 5, y: Math.floor(i / 5) })),
      'left',
    );

  it('cuts the whole boss into two halves of equal length, wherever the first kill lands', () => {
    for (let index = 0; index < 20; index++) {
      const pieces = killBossSegment(boss(), index, false);
      expect(pieces, `index ${index}`).toHaveLength(2);
      const [a, b] = pieces.map((p) => p.worm.segments.length);
      expect(a + b, `index ${index}`).toBe(19);
      expect(Math.abs(a - b), `index ${index}`).toBeLessThanOrEqual(1);
    }
  });

  it('closes up over the kill: the segments behind move up a cell, telling where each piece came from', () => {
    const w = boss();
    const pieces = killBossSegment(w, 3, false);
    expect(pieces.flatMap((p) => p.from)).toEqual([0, 1, 2, ...Array.from({ length: 16 }, (_, i) => i + 4)]);
    expect(pieces.flatMap((p) => p.worm.segments)).toEqual(w.segments.slice(0, -1));
  });

  it('once split, a kill only shortens the piece, closing it up', () => {
    const w = boss();
    for (const index of [0, 7, 19]) {
      const pieces = killBossSegment(w, index, true);
      expect(pieces, `index ${index}`).toHaveLength(1);
      expect(pieces[0].from, `index ${index}`).toEqual(Array.from({ length: 20 }, (_, i) => i).filter((i) => i !== index));
    }
  });

  it('a killed head is replaced by the segment behind it, keeping its heading', () => {
    const [piece] = killBossSegment(worm(), 0, true);
    expect(piece.worm.segments).toEqual([4, 3, 2, 1].map((x) => ({ x, y: 0 })));
    expect(piece.worm.heading).toBe('right');
  });

  it('leaves the second half facing along its own body, after the first', () => {
    const [, back] = killBossSegment(boss(), 0, false);
    // Its head, segment 10 of what is left, lies at (0,2) with the body running right of it.
    expect(back.worm.segments[0]).toEqual({ x: 0, y: 2 });
    expect(back.worm.heading).toBe('left');
  });

  it('never leaves more than two pieces however it is cut down', () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = createRng(seed);
      let pieces = [boss()];
      let split = false;
      while (pieces.length) {
        const target = rng.int(0, pieces.length - 1);
        const hit = pieces[target];
        const after = killBossSegment(hit, rng.int(0, hit.segments.length - 1), split).map((p) => p.worm);
        split = true;
        pieces = [...pieces.slice(0, target), ...after, ...pieces.slice(target + 1)];
        expect(pieces.length, `seed ${seed}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('killing the last segment leaves nothing', () => {
    expect(killBossSegment(createWorm([{ x: 0, y: 0 }], 'up'), 0, true)).toEqual([]);
  });
});
