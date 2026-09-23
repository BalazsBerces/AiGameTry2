import { describe, expect, it } from 'vitest';
import { GHOUL, createGhoul, stepGhoul } from './ghoul';

/** The player `distance` tiles to the right of the ghoul. */
const sight = (distance: number, time = 0, canSee = true) => ({ time, toPlayer: { x: distance, y: 0 }, canSeePlayer: canSee });

describe('ghoul lunge', () => {
  it('keeps stalking while the player is out of lunge range', () => {
    const g = stepGhoul(createGhoul(), sight(GHOUL.lungeRange + 0.5));
    expect(g.mode).toBe('stalk');
  });

  it('lunges at the player once within range', () => {
    const g = stepGhoul(createGhoul(), sight(GHOUL.lungeRange - 0.5));
    expect(g.mode).toBe('lunge');
    expect(g.mode === 'lunge' && g.direction).toEqual({ x: 1, y: 0 });
  });

  it('aims the lunge straight at the player', () => {
    const g = stepGhoul(createGhoul(), { time: 0, toPlayer: { x: -0.6, y: 0.8 }, canSeePlayer: true });
    expect(g.mode === 'lunge' && g.direction.x).toBeCloseTo(-0.6);
    expect(g.mode === 'lunge' && g.direction.y).toBeCloseTo(0.8);
  });

  it('does not lunge at a player it cannot see, however close', () => {
    expect(stepGhoul(createGhoul(), sight(0.5, 0, false)).mode).toBe('stalk');
  });

  it('recovers after a lunge before it can lunge again', () => {
    let g = stepGhoul(createGhoul(), sight(1, 0));
    g = stepGhoul(g, sight(1, GHOUL.lungeMs + 1));
    expect(g.mode).toBe('recover');
    g = stepGhoul(g, sight(1, GHOUL.lungeMs + 2));
    expect(g.mode).toBe('recover');
    g = stepGhoul(g, sight(1, GHOUL.lungeMs + GHOUL.recoverMs + 2));
    expect(g.mode).not.toBe('recover');
  });
});
