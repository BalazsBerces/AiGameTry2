import { describe, expect, it } from 'vitest';
import { GEODE_CHARGE_MS, batPose, geodePose, ghoulPose, slimePose } from './castPoses';

describe("the ghoul's poses", () => {
  it('stalks on its walk, with nothing to hold', () => {
    expect(ghoulPose({ mode: 'stalk' }, 0)).toEqual({});
  });

  it('holds the wind-up (eyes flared) for the whole tell, facing where it will lunge', () => {
    const direction = { x: -1, y: 0 };
    expect(ghoulPose({ mode: 'windUp', direction, until: 300 }, 0)).toEqual({ hold: { action: 'attack', frame: 0 }, aim: direction });
    expect(ghoulPose({ mode: 'windUp', direction, until: 300 }, 290)).toEqual({ hold: { action: 'attack', frame: 0 }, aim: direction });
  });

  it('holds the lunge, reaching out, for as long as it lunges', () => {
    const lunge = { mode: 'lunge' as const, direction: { x: 0, y: 1 }, until: 500 };
    for (const time of [0, 120, 240, 360]) {
      const pose = ghoulPose(lunge, time);
      expect(pose.hold?.action).toBe('attack');
      expect([1, 2]).toContain(pose.hold?.frame);
      expect(pose.aim).toEqual(lunge.direction);
    }
  });

  it('loops its recover pose while it catches its breath', () => {
    expect(ghoulPose({ mode: 'recover', until: 900 }, 100)).toEqual({ loop: 'recover' });
  });
});

describe("the bat's poses", () => {
  const at = { x: 3, y: 3 };

  it('flutters with nothing to hold', () => {
    expect(batPose({ mode: 'flutter', roost: at, spot: at, readyAt: 0 }, at, 0)).toEqual({});
  });

  it('hangs with its wings spread wide through the tell, facing where it will swoop', () => {
    expect(batPose({ mode: 'telegraph', target: { x: 1, y: 3 }, swoopAt: 450 }, at, 0)).toEqual({ hold: { action: 'attack', frame: 0 }, aim: { x: -2, y: 0 } });
  });

  it('holds the swoop, wings beating back, for as long as it swoops', () => {
    const swoop = { mode: 'swoop' as const, target: { x: 6, y: 3 }, giveUpAt: 900 };
    const frames = new Set([0, 60, 120, 180].map((time) => batPose(swoop, at, time).hold?.frame));
    expect([...frames].sort()).toEqual([1, 2]);
    expect(batPose(swoop, at, 0).hold?.action).toBe('attack');
  });
});

describe("the slime's poses", () => {
  const at = { x: 3, y: 3 };

  it('breathes at rest, even when shoved', () => {
    expect(slimePose({ tier: 'big', mode: 'rest', squashAt: 500 }, at, 0)).toEqual({ loop: 'idle' });
  });

  it('squashes down deeper through its tell, facing where it will jump', () => {
    const squash = { tier: 'big' as const, mode: 'squash' as const, target: { x: 1, y: 3 }, hopAt: 380 };
    const frames = [0, 130, 260, 379].map((time) => slimePose(squash, at, time));
    expect(frames.map((p) => p.hold)).toEqual([0, 1, 2, 2].map((frame) => ({ action: 'attack', frame })));
    for (const pose of frames) expect(pose.aim).toEqual({ x: -2, y: 0 });
  });

  it('stretches through its jump, frame by frame from take-off to the drop, facing where it lands', () => {
    const hop = { tier: 'small' as const, mode: 'hop' as const, from: at, to: { x: 5, y: 4 }, takeoffAt: 1000, landAt: 1400 };
    const frames = [1000, 1100, 1200, 1300, 1399].map((time) => slimePose(hop, at, time));
    expect(frames.map((p) => p.hold)).toEqual([0, 1, 2, 3, 3].map((frame) => ({ action: 'move', frame })));
    for (const pose of frames) expect(pose.aim).toEqual({ x: 2, y: 1 });
  });

  it('splats where it lands, then settles', () => {
    expect(slimePose({ tier: 'medium', mode: 'land', restAt: 1150 }, at, 1000)).toEqual({ hold: { action: 'land', frame: 0 } });
    expect(slimePose({ tier: 'medium', mode: 'land', restAt: 1150 }, at, 1100)).toEqual({ hold: { action: 'land', frame: 1 } });
  });
});

describe("the geode's poses", () => {
  it('sits shut between shots, and before it has a first shot lined up', () => {
    expect(geodePose({ nextShotAt: 0 }, 100)).toEqual({});
    expect(geodePose({ nextShotAt: 3000, firedAt: 1300 }, 2000)).toEqual({});
  });

  it('cracks, then splits open, as the shot charges', () => {
    expect(geodePose({ nextShotAt: 3000 }, 3000 - GEODE_CHARGE_MS + 10)).toEqual({ hold: { action: 'attack', frame: 0 } });
    expect(geodePose({ nextShotAt: 3000 }, 2990)).toEqual({ hold: { action: 'attack', frame: 1 } });
  });

  it('stays split open while it waits for a clear line on the player', () => {
    expect(geodePose({ nextShotAt: 3000 }, 5000)).toEqual({ hold: { action: 'attack', frame: 1 } });
  });

  it('flares its core as it fires', () => {
    expect(geodePose({ nextShotAt: 4700, firedAt: 3000 }, 3050)).toEqual({ hold: { action: 'attack', frame: 2 } });
  });
});
