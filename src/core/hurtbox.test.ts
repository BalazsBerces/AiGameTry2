import { describe, expect, it } from 'vitest';
import { hurtboxMeetsBox, hurtboxMeetsCircle } from './hurtbox';

describe('player hurtbox', () => {
  const player = { x: 100, y: 100 };

  it('is hit by a round thing only when they overlap', () => {
    expect(hurtboxMeetsCircle(player, 8, { x: 113, y: 100 }, 6)).toBe(true);
    expect(hurtboxMeetsCircle(player, 8, { x: 115, y: 100 }, 6)).toBe(false);
  });

  it('slips between two streams of shots from neighbouring tiles', () => {
    // Shots 6px round, from tile centres 48px apart; the player midway between them.
    const tile = 48;
    for (const dx of [-tile / 2, tile / 2]) {
      expect(hurtboxMeetsCircle(player, 9, { x: player.x + dx, y: player.y }, 6)).toBe(false);
    }
  });

  it('is hit by a box only when they overlap, corners included', () => {
    // A box 20px square, its left edge 10px from the player's centre: 2px clear.
    const box = { x: 110, y: 90, width: 20, height: 20 };
    expect(hurtboxMeetsBox(player, 8, box)).toBe(false);
    expect(hurtboxMeetsBox({ x: 103, y: 100 }, 8, box)).toBe(true);
    // Near its corner: ~8.5px away misses, ~7.1px away hits.
    expect(hurtboxMeetsBox(player, 8, { ...box, x: 106, y: 106 })).toBe(false);
    expect(hurtboxMeetsBox(player, 8, { ...box, x: 105, y: 105 })).toBe(true);
    // Inside it counts too.
    expect(hurtboxMeetsBox({ x: 120, y: 100 }, 8, box)).toBe(true);
  });
});
