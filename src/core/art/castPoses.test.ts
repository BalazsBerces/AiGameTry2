import { describe, expect, it } from 'vitest';
import {
  GEODE_CHARGE_MS,
  LOB_HEAVE_MS,
  POP_WARN_MS,
  WORM_CRAWL_FRAME_MS,
  batPose,
  eggPose,
  geodePose,
  ghoulPose,
  slimePose,
  wormBossPose,
  wormPose,
  type WormBossLook,
} from './castPoses';
import { createWorm } from '../bosses/wormChain';
import { WORM_BOSS, deathChain, spitWave, splitStop } from '../bosses/wormBossAttack';
import { WORM_BROOD } from '../bosses/wormBrood';

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

describe("the worm's poses", () => {
  // Head at 5,2 heading down; the body turns the corner above it and runs off left to the tail.
  const worm = createWorm([{ x: 5, y: 2 }, { x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }], 'down');

  it('wears its head first, its tail last and body pieces between', () => {
    expect([0, 1, 2, 3].map((i) => wormPose(worm, i, 0).piece)).toEqual(['wormHead', 'wormBody', 'wormBody', 'wormTail']);
  });

  it('is all head when only one segment is left', () => {
    expect(wormPose(createWorm([{ x: 2, y: 2 }], 'left'), 0, 0).piece).toBe('wormHead');
  });

  it('points its head the way it is heading; the rest face the way they glide', () => {
    expect(wormPose(worm, 0, 0).aim).toEqual({ x: 0, y: 1 });
    for (const i of [1, 2, 3]) expect(wormPose(worm, i, 0).aim, `segment ${i}`).toBeUndefined();
  });

  it('crawls in a ripple that runs from its head down to its tail, a frame behind segment by segment', () => {
    const frame = (i: number, tick: number) => wormPose(worm, i, tick * WORM_CRAWL_FRAME_MS).hold;
    expect([0, 1, 2, 3].map((i) => frame(i, 0))).toEqual([0, 3, 2, 1].map((f) => ({ action: 'move', frame: f })));
    for (const tick of [0, 1, 2, 5]) for (const i of [1, 2, 3]) expect(frame(i, tick + 1)).toEqual(frame(i - 1, tick));
  });
});

describe("the worm boss's poses", () => {
  // Head at 5,2 heading down, the body running off left along row 1 to its tail; the room is 10 by 8.
  const worm = createWorm([{ x: 5, y: 2 }, { x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }], 'down');
  const room = { w: 10, h: 8 };
  const look = (more: Partial<WormBossLook> = {}): WormBossLook => ({ worm, room, ...more });
  const ALL = [0, 1, 2, 3, 4];
  const holds = (l: WormBossLook, time: number) => ALL.map((i) => wormBossPose(l, i, time).hold);

  it('is the worm grown huge: its head first, its tail last, its crawl rippling down from the head', () => {
    expect(ALL.map((i) => wormBossPose(look(), i, 0).piece)).toEqual(['wormBossHead', 'wormBossBody', 'wormBossBody', 'wormBossBody', 'wormBossTail']);
    for (const time of [0, WORM_CRAWL_FRAME_MS, 5 * WORM_CRAWL_FRAME_MS]) {
      for (const i of ALL) expect(wormBossPose(look(), i, time).hold, `${i} at ${time}`).toEqual(wormPose(worm, i, time).hold);
    }
  });

  it('points its head the way it heads, whatever it is doing', () => {
    expect(wormBossPose(look(), 0, 0).aim).toEqual({ x: 0, y: 1 });
    expect(wormBossPose(look({ moment: { phase: 'roaring', until: 500 } }), 0, 0).aim).toEqual({ x: 0, y: 1 });
    expect(wormBossPose(look(), 2, 0).aim).toBeUndefined();
  });

  it('rears up and roars, maw splayed and crystals flaring, for exactly as long as the roar', () => {
    const roaring = look({ moment: { phase: 'roaring', until: 2000 } });
    for (const time of [0, 400, 1999]) {
      for (const hold of holds(roaring, time)) {
        expect(hold?.action).toBe('attack');
        expect([1, 2]).toContain(hold?.frame);
      }
    }
    expect(holds(roaring, 2000)).toEqual(holds(look(), 2000));
    expect(holds(look({ moment: { phase: 'done' } }), 0)).toEqual(holds(look(), 0));
  });

  it('roars through the stop at its split, the end torn open showing its raw crystal core', () => {
    const stop = splitStop(100);
    const tornTail = look({ moment: stop, rawEnd: 'tail' });
    for (const time of [100, 600, 100 + WORM_BOSS.splitStopMs - 1]) {
      expect(wormBossPose(tornTail, 4, time).hold?.action).toBe('split');
      for (const i of [0, 1, 2, 3]) expect(wormBossPose(tornTail, i, time).hold?.action).toBe('attack');
    }
    expect(wormBossPose(look({ moment: stop, rawEnd: 'head' }), 0, 300).hold?.action).toBe('split');
    expect(holds(tornTail, 100 + WORM_BOSS.splitStopMs)).toEqual(holds(look(), 100 + WORM_BOSS.splitStopMs));
  });

  it('holds still, crawling no more, while its twin blows apart', () => {
    for (const hold of holds(look({ moment: { phase: 'deathHold', until: 900 } }), 300)) expect(hold).toBeUndefined();
  });

  it('pulses its maw through a spit wave, each segment flaring as its own shot leaves it', () => {
    const shots = spitWave(worm.segments, worm.heading);
    const spitting = look({ spit: { start: 1000, shots } });
    for (const time of [1000, 1050, 1110]) expect(wormBossPose(spitting, 0, time).hold?.action).toBe('spit');
    expect(new Set([1000, 1090, 1180].map((t) => wormBossPose(spitting, 0, t).hold?.frame)).size).toBe(2);
    // A segment is ready until its shot leaves it, and flares as it does.
    expect(wormBossPose(spitting, 3, 1000 + shots[3].atMs - 1).hold).toEqual({ action: 'spit', frame: 0 });
    expect(wormBossPose(spitting, 3, 1000 + shots[3].atMs).hold).toEqual({ action: 'spit', frame: 1 });
  });

  it('flares its tail as the last shot leaves it, and crawls on once that flare is done', () => {
    const shots = spitWave(worm.segments, worm.heading);
    const spitting = look({ spit: { start: 1000, shots } });
    const last = 1000 + shots[4].atMs;
    expect(wormBossPose(spitting, 4, last).hold).toEqual({ action: 'spit', frame: 1 });
    expect(wormBossPose(spitting, 4, last + 99).hold).toEqual({ action: 'spit', frame: 1 });
    expect(holds(spitting, last + 100)).toEqual(holds(look(), last + 100));
  });

  it('tucks its head and points its shards forward while it charges up and between lunges, and crawls through the lunge itself', () => {
    for (const rampage of ['charging', 'pausing'] as const) for (const hold of holds(look({ rampage }), 300)) expect(hold?.action, rampage).toBe('charge');
    expect(holds(look({ rampage: 'lunging' }), 300)).toEqual(holds(look(), 300));
    expect(holds(look({ rampage: 'over' }), 300)).toEqual(holds(look(), 300));
  });

  it('heaves the segment an egg is lobbed from, for as long as the throw', () => {
    const lobbing = look({ heave: { segments: [2], start: 1000 } });
    expect(wormBossPose(lobbing, 2, 1000).hold).toEqual({ action: 'lob', frame: 0 });
    expect(wormBossPose(lobbing, 2, 1000 + LOB_HEAVE_MS - 1).hold).toEqual({ action: 'lob', frame: 1 });
    expect(wormBossPose(lobbing, 2, 1000 + LOB_HEAVE_MS).hold).toEqual(wormPose(worm, 2, 1000 + LOB_HEAVE_MS).hold);
    expect(wormBossPose(lobbing, 1, 1000).hold).toEqual(wormPose(worm, 1, 1000).hold);
  });

  it('burrows into the wall where it is in the wall, and out of it where the segment behind still is', () => {
    // Diving up through the top wall: its head in it, the rest still in the room.
    const diving = createWorm([{ x: 4, y: -1 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 }], 'up');
    expect([0, 1, 2, 3].map((i) => wormBossPose(look({ worm: diving }), i, 0).hold?.action)).toEqual(['burrow', 'move', 'move', 'move']);
    expect(wormBossPose(look({ worm: diving }), 0, 0).hold?.frame).toBe(0);
    // Coming out of the left wall: its head in the room, the rest still in the wall.
    const emerging = createWorm([{ x: 0, y: 3 }, { x: -1, y: 3 }, { x: -2, y: 3 }], 'right');
    expect([0, 1, 2].map((i) => wormBossPose(look({ worm: emerging }), i, 0).hold)).toEqual([
      { action: 'burrow', frame: 1 },
      { action: 'burrow', frame: 0 },
      { action: 'burrow', frame: 0 },
    ]);
  });

  it('cracks as it dies, each segment bursting into crystal from its tail to its head, timed to the death chain', () => {
    const dying = look({ dying: { at: 1000 } });
    const { pops } = deathChain(5);
    expect(pops[0].segment).toBe(4);
    for (const { segment, atMs } of pops) {
      expect(wormBossPose(dying, segment, 1000 + atMs - POP_WARN_MS - 1).hold, `${segment}`).toEqual({ action: 'die', frame: 0 });
      expect(wormBossPose(dying, segment, 1000 + atMs - POP_WARN_MS).hold, `${segment}`).toEqual({ action: 'die', frame: 1 });
    }
    // Dying wins over anything it was doing.
    expect(wormBossPose(look({ dying: { at: 0 }, rampage: 'charging', moment: { phase: 'roaring', until: 9000 } }), 0, 10).hold?.action).toBe('die');
  });
});

describe("the worm boss's eggs", () => {
  it('rest until they start to wobble', () => {
    expect(eggPose(1000, 1000)).toEqual({});
    expect(eggPose(1000, 1000 + WORM_BROOD.hatchMs - WORM_BROOD.wobbleMs - 1)).toEqual({});
  });

  it('crack ever wider through the wobble, frame by frame, until they hatch', () => {
    const start = 1000 + WORM_BROOD.hatchMs - WORM_BROOD.wobbleMs;
    const frames = [0, 0.34, 0.67, 0.999].map((k) => eggPose(1000, start + k * WORM_BROOD.wobbleMs).hold);
    expect(frames).toEqual([0, 1, 2, 2].map((frame) => ({ action: 'attack', frame })));
  });
});
