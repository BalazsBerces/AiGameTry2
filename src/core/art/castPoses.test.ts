import { describe, expect, it } from 'vitest';
import { batPose, ghoulPose } from './castPoses';

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
