import { describe, expect, it } from 'vitest';
import { CRYSTAL_TURRET_BOUNCES, ricochet } from './ricochet';

// A stone tile at cell (5, 5): it spans x 5..6 and y 5..6 in tile units.
const STONE = { x: 5, y: 5 };

describe('ricochet', () => {
  it('reflects off a vertical face: horizontal speed flips, vertical speed is kept', () => {
    // Coming from the left, touching the stone's left face.
    const out = ricochet({ x: 4.8, y: 5.5, vx: 3, vy: 1, bouncesLeft: 1 }, 'obstacle', STONE);
    expect(out).toMatchObject({ vx: -3, vy: 1 });
    // And from the right.
    expect(ricochet({ x: 6.2, y: 5.3, vx: -2, vy: -4, bouncesLeft: 1 }, 'obstacle', STONE)).toMatchObject({ vx: 2, vy: -4 });
  });

  it('reflects off a horizontal face: vertical speed flips, horizontal speed is kept', () => {
    // Coming from above, touching the top face.
    expect(ricochet({ x: 5.5, y: 4.8, vx: 1, vy: 3, bouncesLeft: 1 }, 'obstacle', STONE)).toMatchObject({ vx: 1, vy: -3 });
    // And from below.
    expect(ricochet({ x: 5.4, y: 6.2, vx: -1, vy: -2, bouncesLeft: 1 }, 'obstacle', STONE)).toMatchObject({ vx: -1, vy: 2 });
  });

  it('sends a shot that hits a corner straight back', () => {
    expect(ricochet({ x: 4.9, y: 4.9, vx: 2, vy: 2, bouncesLeft: 1 }, 'obstacle', STONE)).toMatchObject({ vx: -2, vy: -2 });
  });

  it('keeps the speed of the shot', () => {
    const out = ricochet({ x: 4.8, y: 5.2, vx: 3, vy: 4, bouncesLeft: 1 }, 'obstacle', STONE)!;
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(5);
  });

  it('bounces a crystal-turret shot off stone exactly once', () => {
    const shot = { x: 4.8, y: 5.5, vx: 3, vy: 0, bouncesLeft: CRYSTAL_TURRET_BOUNCES };
    const first = ricochet(shot, 'obstacle', STONE);
    expect(first).toBeDefined();
    // It flies back and hits stone on the other side of the room.
    const second = ricochet({ x: 2.2, y: 5.5, ...first! }, 'obstacle', { x: 1, y: 5 });
    expect(second).toBeUndefined();
  });

  it('stops shots with no bounces left, such as the player’s, on stone', () => {
    expect(ricochet({ x: 4.8, y: 5.5, vx: 3, vy: 0, bouncesLeft: 0 }, 'obstacle', STONE)).toBeUndefined();
  });

  it('only bounces off stone, not off breakable rock', () => {
    expect(ricochet({ x: 4.8, y: 5.5, vx: 3, vy: 0, bouncesLeft: 1 }, 'rock', STONE)).toBeUndefined();
  });
});
