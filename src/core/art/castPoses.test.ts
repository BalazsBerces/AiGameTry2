import { describe, expect, it } from 'vitest';
import {
  LOB_HEAVE_MS,
  POP_WARN_MS,
  WORM_CRAWL_FRAME_MS,
  WORM_PLATE_CELLS,
  batPose,
  eggPose,
  geodePose,
  ghoulPose,
  slimePose,
  wormBossPose,
  wormPose,
  wormSpine,
  type WormBossLook,
  type WormGlide,
} from './castPoses';
import { GEODE, createGeode, updateGeode } from '../enemies/geode';
import { createWorm, type Worm } from '../bosses/wormChain';
import { DIRECTIONS, STEP, type Cell } from '../map/floorGenerator';
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
  // Opened at 1000: its first shot is due at the end of the opening delay.
  const opened = updateGeode(createGeode(0), 1, true, 1000).geode;
  const firstShotAt = 1000 + GEODE.openDelayMs;
  const fired = updateGeode(opened, 1, true, firstShotAt).geode;

  it('is plain rock while shut, before it first opens and while it rests', () => {
    expect(geodePose(undefined, 100)).toEqual({});
    expect(geodePose(createGeode(500), 100)).toEqual({});
    let g = fired;
    for (let t = firstShotAt; g.open; t += 10) g = updateGeode(g, 1, true, t).geode;
    expect(geodePose(g, firstShotAt + 5000)).toEqual({});
  });

  it('cracks, then splits open, through the opening delay', () => {
    expect(geodePose(opened, 1010)).toEqual({ hold: { action: 'attack', frame: 0 } });
    expect(geodePose(opened, firstShotAt - 10)).toEqual({ hold: { action: 'attack', frame: 1 } });
  });

  it('flares its core just after a shot, then holds split open', () => {
    expect(geodePose(fired, firstShotAt + 50)).toEqual({ hold: { action: 'attack', frame: 2 } });
    expect(geodePose(fired, firstShotAt + 400)).toEqual({ hold: { action: 'attack', frame: 1 } });
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

  it('points its head the way it is heading, holding still', () => {
    expect(wormPose(worm, 0, 0).angle).toBeCloseTo(Math.PI / 2);
    expect(wormPose(worm, 0, 0).offset).toEqual({ x: 0, y: 0 });
  });

  it('crawls in a ripple that runs from its head down to its tail, a frame behind segment by segment', () => {
    const frame = (i: number, tick: number) => wormPose(worm, i, tick * WORM_CRAWL_FRAME_MS).hold;
    expect([0, 1, 2, 3].map((i) => frame(i, 0))).toEqual([0, 3, 2, 1].map((f) => ({ action: 'move', frame: f })));
    for (const tick of [0, 1, 2, 5]) for (const i of [1, 2, 3]) expect(frame(i, tick + 1)).toEqual(frame(i - 1, tick));
  });
});

describe("the worm's spine", () => {
  type Pt = { x: number; y: number };
  /**
   * A worm `length` long crawling along `trail` (the cells its head passes through, in order),
   * sampled `per` times a step: at step s it lies on trail[s..s+length-1], head last in the trail,
   * gliding there from one cell further back.
   */
  function crawl(trail: Cell[], length: number, per = 20) {
    const frames: { step: number; k: number; worm: Worm; glide: WormGlide }[] = [];
    for (let s = 1; s + length <= trail.length; s++) {
      const segments = trail.slice(s, s + length).reverse();
      const from = trail.slice(s - 1, s - 1 + length).reverse();
      const d = { x: segments[0].x - from[0].x, y: segments[0].y - from[0].y };
      const heading = DIRECTIONS.find((h) => STEP[h].x === d.x && STEP[h].y === d.y)!;
      for (let j = 0; j <= per; j++) frames.push({ step: s, k: j / per, worm: createWorm(segments, heading), glide: { from, progress: j / per } });
    }
    return frames;
  }
  /** Where a segment's plate lies, in cells: its shape's centre (gliding straight from cell to cell) plus its offset. */
  const plateAt = (worm: Worm, glide: WormGlide, i: number): Pt & { angle: number } => {
    const a = glide.from[i];
    const b = worm.segments[i];
    const { offset, angle } = wormSpine(worm, i, glide);
    return { x: a.x + (b.x - a.x) * glide.progress + offset.x, y: a.y + (b.y - a.y) * glide.progress + offset.y, angle };
  };
  const turnBy = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  const line = (from: Cell, dx: number, dy: number, count: number) => Array.from({ length: count }, (_, i) => ({ x: from.x + dx * (i + 1), y: from.y + dy * (i + 1) }));
  // Right along row 0, down a column, left back along row 3, then up: three corners, one a U-turn round a tight bend.
  const start = { x: 0, y: 0 };
  const winding: Cell[] = [start, ...line(start, 1, 0, 6)];
  winding.push(...line(winding[winding.length - 1], 0, 1, 3));
  winding.push(...line(winding[winding.length - 1], -1, 0, 1));
  winding.push(...line(winding[winding.length - 1], 0, -1, 1));
  winding.push(...line(winding[winding.length - 1], -1, 0, 5));
  const LENGTH = 5;
  const frames = crawl(winding, LENGTH);

  it('lies on its cells with no offset on a straight run, every plate pointing the way it heads', () => {
    for (const { worm, glide } of crawl(line(start, 1, 0, 9), 4)) {
      for (const i of [0, 1, 2, 3]) {
        const { offset, angle } = wormSpine(worm, i, glide);
        expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(0);
        expect(turnBy(angle, 0)).toBeCloseTo(0);
      }
    }
  });

  it('keeps every plate within reach of the next through every turn, at any point in the step, so no gap ever shows', () => {
    expect(WORM_PLATE_CELLS).toBeGreaterThan(1);
    for (const { step, k, worm, glide } of frames) {
      for (let i = 1; i < LENGTH; i++) {
        const [a, b] = [plateAt(worm, glide, i - 1), plateAt(worm, glide, i)];
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        expect(gap, `segments ${i - 1}-${i} at step ${step}, ${k}`).toBeLessThanOrEqual(1 + 1e-9);
        expect(gap, `segments ${i - 1}-${i} at step ${step}, ${k}`).toBeGreaterThan(0.5);
      }
    }
  });

  it('rounds each corner rather than cutting across it', () => {
    // Its neck in the first corner (6,0), and its head just round it: the neck's plate sits in toward the inside of the bend.
    const turning = frames.find((f) => f.worm.segments[1].x === 6 && f.worm.segments[1].y === 0 && f.k === 1)!;
    const plate = plateAt(turning.worm, turning.glide, 1);
    expect(plate.x).toBeLessThan(6 - 0.1);
    expect(plate.y).toBeGreaterThan(0.1);
  });

  it('moves and turns every plate smoothly, from frame to frame and from one step into the next, never jumping', () => {
    for (let f = 1; f < frames.length; f++) {
      const [was, now] = [frames[f - 1], frames[f]];
      for (let i = 0; i < LENGTH; i++) {
        const [a, b] = [plateAt(was.worm, was.glide, i), plateAt(now.worm, now.glide, i)];
        // A twentieth of a step: not much more than a twentieth of a cell, nor a sixth of a quarter turn.
        const why = `segment ${i}, step ${now.step} at ${now.k}`;
        expect(Math.hypot(a.x - b.x, a.y - b.y), why).toBeLessThanOrEqual(0.07);
        expect(turnBy(a.angle, b.angle), why).toBeLessThanOrEqual(Math.PI / 2 / 6);
      }
    }
  });

  it('turns its head smoothly toward its new heading on its way into a corner', () => {
    // The step its head turns down at the first corner: from facing right to facing down over the first half of the step.
    const turn = frames.filter((f) => f.worm.segments[0].x === 6 && f.worm.segments[0].y === 1);
    const angle = (k: number) => wormSpine(turn[0].worm, 0, { ...turn[0].glide, progress: k }).angle;
    expect(turnBy(angle(0), 0)).toBeCloseTo(0);
    expect(turnBy(angle(0.25), 0)).toBeGreaterThan(0.2);
    expect(turnBy(angle(0.25), Math.PI / 2)).toBeGreaterThan(0.2);
    for (const k of [0.5, 0.75, 1]) expect(turnBy(angle(k), Math.PI / 2)).toBeCloseTo(0);
  });

  it('lies still where it lies when it is not gliding (held, reversed or newly split), its plates still curving round its corners', () => {
    const still = createWorm([{ x: 5, y: 2 }, { x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }], 'down');
    const at = (i: number) => wormSpine(still, i, { from: still.segments, progress: 0.4 });
    for (const i of [0, 1, 2, 3]) expect(at(i)).toEqual(wormSpine(still, i));
    // The corner at 5,1: its plate sits in toward the inside of the bend, pointing halfway round it.
    expect(at(1).offset.x).toBeLessThan(0);
    expect(at(1).offset.y).toBeGreaterThan(0);
    expect(turnBy(at(1).angle, Math.PI / 4)).toBeCloseTo(0);
    expect(at(2)).toEqual({ offset: { x: 0, y: 0 }, angle: 0 });
  });

  it('copes with a worm still coiled on one cell (a hatchling), and with a segment crossing the walls in one step', () => {
    const coiled = createWorm([{ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }], 'left');
    for (const i of [0, 1, 2]) expect(wormSpine(coiled, i, { from: coiled.segments, progress: 0.5 }).angle, `${i}`).toBeCloseTo(Math.PI);
    const hatching = createWorm([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }], 'left');
    for (const i of [0, 1, 2]) expect(Number.isFinite(wormSpine(hatching, i, { from: coiled.segments, progress: 0.5 }).angle)).toBe(true);
    const wrapped = createWorm([{ x: 9, y: 4 }, { x: -1, y: 4 }], 'left');
    expect(wormSpine(wrapped, 0, { from: [{ x: -1, y: 4 }, { x: 0, y: 4 }], progress: 0.5 }).offset).toEqual({ x: 0, y: 0 });
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

  it("lies along the worm's one continuous spine, gliding or still, whatever it is doing", () => {
    // Its head has just stepped down round the corner at 5,1, the rest following on along row 1.
    const glide: WormGlide = { from: [{ x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }], progress: 0.3 };
    const moments: Partial<WormBossLook>[] = [{}, { moment: { phase: 'roaring', until: 500 } }, { rampage: 'charging' }, { dying: { at: 0 } }];
    for (const more of moments) {
      for (const i of ALL) {
        const { offset, angle } = wormBossPose(look({ ...more, glide }), i, 100);
        expect({ offset, angle }, `${i} ${JSON.stringify(more)}`).toEqual(wormSpine(worm, i, glide));
        expect(wormBossPose(look(more), i, 100).angle).toEqual(wormSpine(worm, i).angle);
      }
    }
    // Still, its head points the way it heads and its neck rounds the corner.
    expect(wormBossPose(look(), 0, 0).angle).toBeCloseTo(Math.PI / 2);
    expect(wormBossPose(look(), 1, 0).angle).toBeCloseTo(Math.PI / 4);
    expect(wormBossPose(look(), 0, 0).aim).toBeUndefined();
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
