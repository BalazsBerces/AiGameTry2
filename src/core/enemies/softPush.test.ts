import { describe, expect, it } from 'vitest';
import { softPush } from './softPush';

const TUNE = { stiffness: 10, cap: 1000 };

describe('softPush', () => {
  it('pushes two overlapping circles apart along the line between their centres', () => {
    // Radius 10 each, 15 apart: 5px of overlap, so each is pushed 10 x 5 = 50 px/s away from the other.
    const pushes = softPush([{ x: 0, y: 0, r: 10 }, { x: 15, y: 0, r: 10 }], TUNE);
    expect(pushes).toEqual([{ x: -50, y: 0 }, { x: 50, y: 0 }]);
  });

  it('leaves circles that only touch or stand apart alone', () => {
    const pushes = softPush([{ x: 0, y: 0, r: 10 }, { x: 20, y: 0, r: 10 }, { x: 100, y: 100, r: 10 }], TUNE);
    expect(pushes.map((p) => Math.hypot(p.x, p.y))).toEqual([0, 0, 0]);
  });

  it('pushes harder the deeper the overlap, up to the cap', () => {
    // 8px of overlap: 80 px/s, under a cap of 100.
    expect(softPush([{ x: 0, y: 0, r: 10 }, { x: 0, y: 12, r: 10 }], { stiffness: 10, cap: 100 })).toEqual([
      { x: 0, y: -80 },
      { x: 0, y: 80 },
    ]);
    // 15px of overlap would be 150 px/s: held to the cap.
    expect(softPush([{ x: 0, y: 0, r: 10 }, { x: 0, y: 5, r: 10 }], { stiffness: 10, cap: 100 })).toEqual([
      { x: 0, y: -100 },
      { x: 0, y: 100 },
    ]);
  });

  it('separates two circles on the very same spot, the same way every time', () => {
    // Fully overlapped (20px): 200 px/s, the first pushed left and the second right.
    const pushes = softPush([{ x: 5, y: 5, r: 10 }, { x: 5, y: 5, r: 10 }], TUNE);
    expect(pushes).toEqual([{ x: -200, y: 0 }, { x: 200, y: 0 }]);
  });
});
