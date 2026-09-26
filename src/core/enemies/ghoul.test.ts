import { describe, expect, it } from 'vitest';
import { GHOUL, createGhoul, stepGhoul } from './ghoul';

/** The player `distance` tiles to the right of the ghoul. */
const sight = (distance: number, time = 0, canSee = true) => ({ time, toPlayer: { x: distance, y: 0 }, canSeePlayer: canSee });

describe('ghoul lunge', () => {
  it('keeps stalking while the player is out of lunge range', () => {
    const g = stepGhoul(createGhoul(), sight(GHOUL.lungeRange + 0.5));
    expect(g.mode).toBe('stalk');
  });

  it('winds up instead of lunging the moment the player comes within range', () => {
    const g = stepGhoul(createGhoul(), sight(GHOUL.lungeRange - 0.5));
    expect(g.mode).toBe('windUp');
  });

  it('lunges at the player once the wind-up is over', () => {
    let g = stepGhoul(createGhoul(), sight(GHOUL.lungeRange - 0.5, 0));
    g = stepGhoul(g, sight(GHOUL.lungeRange - 0.5, GHOUL.windUpMs - 1));
    expect(g.mode).toBe('windUp');
    g = stepGhoul(g, sight(GHOUL.lungeRange - 0.5, GHOUL.windUpMs));
    expect(g.mode).toBe('lunge');
    expect(g.mode === 'lunge' && g.direction).toEqual({ x: 1, y: 0 });
  });

  it('lunges where the player stood when the wind-up began, so stepping aside dodges it', () => {
    let g = stepGhoul(createGhoul(), { time: 0, toPlayer: { x: -0.6, y: 0.8 }, canSeePlayer: true });
    g = stepGhoul(g, { time: GHOUL.windUpMs / 2, toPlayer: { x: 1, y: 0 }, canSeePlayer: true });
    g = stepGhoul(g, { time: GHOUL.windUpMs, toPlayer: { x: 0, y: -1 }, canSeePlayer: true });
    expect(g.mode).toBe('lunge');
    expect(g.mode === 'lunge' && g.direction.x).toBeCloseTo(-0.6);
    expect(g.mode === 'lunge' && g.direction.y).toBeCloseTo(0.8);
  });

  it('commits to the lunge even if the player backs out of range or out of sight mid wind-up', () => {
    let g = stepGhoul(createGhoul(), sight(1, 0));
    g = stepGhoul(g, sight(GHOUL.lungeRange + 5, GHOUL.windUpMs / 2, false));
    expect(g.mode).toBe('windUp');
    g = stepGhoul(g, sight(GHOUL.lungeRange + 5, GHOUL.windUpMs, false));
    expect(g.mode).toBe('lunge');
  });

  it('does not lunge at a player it cannot see, however close', () => {
    expect(stepGhoul(createGhoul(), sight(0.5, 0, false)).mode).toBe('stalk');
  });

  it('recovers after a lunge before it can lunge again', () => {
    const lungeEnds = GHOUL.windUpMs + GHOUL.lungeMs;
    let g = stepGhoul(createGhoul(), sight(1, 0));
    g = stepGhoul(g, sight(1, GHOUL.windUpMs));
    g = stepGhoul(g, sight(1, lungeEnds));
    expect(g.mode).toBe('recover');
    g = stepGhoul(g, sight(1, lungeEnds + 1));
    expect(g.mode).toBe('recover');
    g = stepGhoul(g, sight(1, lungeEnds + GHOUL.recoverMs));
    expect(g.mode).not.toBe('recover');
  });
});
