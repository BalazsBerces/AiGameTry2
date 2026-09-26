import { describe, expect, it } from 'vitest';
import { STANDING, footDepth } from './depth';

describe('draw order by foot', () => {
  it('draws whatever stands lower on screen over what stands behind it', () => {
    expect(footDepth(300, 0)).toBeGreaterThan(footDepth(299.5, 0));
    expect(footDepth(301, 5)).toBeGreaterThan(footDepth(300, 9));
  });

  it('breaks a tie on the same foot line the same way every time, by serial', () => {
    expect(footDepth(300, 2)).toBeGreaterThan(footDepth(300, 1));
    expect(footDepth(300, 2)).toBe(footDepth(300, 2));
  });

  it('keeps everything standing inside its band, however far down the map', () => {
    for (const y of [0, 432, 8640, 40000]) {
      for (const serial of [0, 999_999]) {
        const d = footDepth(y, serial);
        expect(d).toBeGreaterThanOrEqual(STANDING.from);
        expect(d).toBeLessThan(STANDING.to);
      }
    }
  });
});
