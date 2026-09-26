import { describe, expect, it } from 'vitest';
import { createHitStop } from './hitStop';

describe('hit-stop', () => {
  it('runs game time with real time while nothing has hit', () => {
    const stop = createHitStop();
    expect(stop.step(0)).toEqual({ frozen: false, gameTime: 0 });
    expect(stop.step(500)).toEqual({ frozen: false, gameTime: 500 });
  });

  it('freezes for the length asked, then game time carries on from where it stopped', () => {
    const stop = createHitStop();
    stop.step(1000);
    stop.request(1000, 50);
    expect(stop.step(1010)).toEqual({ frozen: true, gameTime: 1000 });
    expect(stop.step(1049)).toEqual({ frozen: true, gameTime: 1000 });
    expect(stop.step(1050)).toEqual({ frozen: false, gameTime: 1000 });
    expect(stop.step(1100)).toEqual({ frozen: false, gameTime: 1050 });
  });

  it('merges a volley of hits into one freeze as long as the longest of them', () => {
    const stop = createHitStop();
    stop.step(0);
    for (const ms of [40, 60, 40, 40]) stop.request(0, ms);
    expect(stop.step(59).frozen).toBe(true);
    expect(stop.step(60)).toEqual({ frozen: false, gameTime: 0 });
  });

  it('never freezes longer than the longest single request, however late in the freeze more come', () => {
    const stop = createHitStop(0);
    stop.step(0);
    stop.request(0, 60);
    stop.request(30, 60);
    stop.request(55, 40);
    expect(stop.step(60).frozen).toBe(false);
    stop.request(61, 30);
    expect(stop.step(91)).toEqual({ frozen: false, gameTime: 1 });
  });

  it('rests after a freeze before another may start, so a string of hits does not stutter', () => {
    const stop = createHitStop(200);
    stop.step(0);
    stop.request(0, 50);
    expect(stop.step(60).frozen).toBe(false);
    stop.request(100, 50);
    expect(stop.step(110).frozen).toBe(false);
    stop.request(250, 50);
    expect(stop.step(260).frozen).toBe(true);
  });
});
