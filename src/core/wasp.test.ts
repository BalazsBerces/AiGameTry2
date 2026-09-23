import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { createWaspFlight, steerWasp } from './wasp';

const FRAME_MS = 16;
const SPEED = 200;

/** Flies a wasp at a fixed target for `frames` frames; returns every position and heading. */
function fly(seed: number, frames: number, from = { x: 0, y: 0 }, target = { x: 2000, y: 600 }) {
  const rng = createRng(seed);
  let flight = createWaspFlight(rng);
  let at = { ...from };
  const path = [at];
  const headings: { x: number; y: number }[] = [];
  for (let i = 0; i < frames; i++) {
    const step = steerWasp(flight, at, target, FRAME_MS, rng);
    flight = step.flight;
    headings.push(step.heading);
    at = { x: at.x + step.heading.x * SPEED * (FRAME_MS / 1000), y: at.y + step.heading.y * SPEED * (FRAME_MS / 1000) };
    path.push(at);
  }
  return { path, headings, target };
}

describe('steerWasp', () => {
  it('is the same flight for the same rng', () => {
    expect(fly(3, 200)).toEqual(fly(3, 200));
  });

  it('gives a unit heading, so the wasp always flies at full speed', () => {
    for (const h of fly(5, 300).headings) expect(Math.hypot(h.x, h.y)).toBeCloseTo(1, 6);
  });

  it('closes on its target every frame while it is still far away', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { path, target } = fly(seed, 300);
      const dist = path.map((p) => Math.hypot(target.x - p.x, target.y - p.y));
      for (let i = 1; i < dist.length; i++) expect(dist[i], `seed ${seed} frame ${i}`).toBeLessThan(dist[i - 1]);
    }
  });

  it('reaches a target and keeps buzzing around it rather than drifting away', () => {
    const target = { x: 300, y: 100 };
    const { path } = fly(11, 600, { x: 0, y: 0 }, target);
    const late = path.slice(300).map((p) => Math.hypot(target.x - p.x, target.y - p.y));
    expect(Math.max(...late)).toBeLessThan(60);
  });

  it('flies erratically: its heading swings well to both sides of the straight line', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { path, headings, target } = fly(seed, 300);
      const offsets = headings.map((h, i) => {
        const direct = Math.atan2(target.y - path[i].y, target.x - path[i].x);
        return Math.atan2(Math.sin(Math.atan2(h.y, h.x) - direct), Math.cos(Math.atan2(h.y, h.x) - direct));
      });
      expect(Math.max(...offsets), `seed ${seed}`).toBeGreaterThan(0.3);
      expect(Math.min(...offsets), `seed ${seed}`).toBeLessThan(-0.3);
    }
  });

  it('sends wasps of one swarm on different paths', () => {
    const paths = [1, 2, 3, 4].map((seed) => JSON.stringify(fly(seed, 100).path));
    expect(new Set(paths).size).toBe(4);
  });
});
