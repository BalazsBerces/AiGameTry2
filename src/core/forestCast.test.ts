import { describe, expect, it } from 'vitest';
import { createGoblin, goblinStep, spreadShots, updateGoblinPack } from './forestCast';

/**
 * Distance field of a 5x1 corridor with the player at x=0: the goblin at x=2 steps to x=1 to
 * chase and to x=3 to get away.
 */
const CORRIDOR = [[0, 1, 2, 3, 4]];
const HERE = { x: 2, y: 0 };

describe('goblin step', () => {
  const hiding = { ...createGoblin(), mode: 'hide' as const };

  it('heads down the walk field to chase and up it to get away', () => {
    expect(goblinStep(createGoblin(), CORRIDOR, HERE)).toEqual({ x: 1, y: 0 });
    expect(goblinStep(hiding, CORRIDOR, HERE)).toEqual({ x: 3, y: 0 });
  });

  it('holds its ground when cornered while getting away', () => {
    expect(goblinStep(hiding, CORRIDOR, { x: 4, y: 0 })).toBeUndefined();
  });

  it('never gets away onto a cell it cannot walk to', () => {
    expect(goblinStep(hiding, [[0, 1, 2, Infinity]], HERE)).toBeUndefined();
  });
});

describe('goblin pack', () => {
  type Member = Parameters<typeof updateGoblinPack>[0][number];
  /** Goblin `id` of 4 max HP with `hp` left at `cell`, in its starting state. */
  const at = (id: number, hp: number, cell = { x: id * 3, y: 0 }): Member => ({ id, hp, maxHp: 4, cell, goblin: createGoblin() });
  /** Open floor: walking between two cells takes their grid distance. */
  const walkBetween = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  /** Heals half a goblin's max HP a second: 2 HP/s for these 4 HP goblins. */
  const world = (time: number) => ({ time, walkBetween, healRate: 0.5 });
  const decide = (pack: Member[], time = 1000) => updateGoblinPack(pack, world(time)).map((d) => d.goblin);
  /** The same goblins a frame later, carrying the states just decided. */
  const carry = (pack: Member[], decided: ReturnType<typeof decide>) => pack.map((m, i) => ({ ...m, goblin: decided[i] }));
  /** One frame at `time`: the goblins with their new states and whatever HP they were healed. */
  const frame = (pack: Member[], time: number) =>
    updateGoblinPack(pack, world(time)).map((d, i) => ({ ...pack[i], hp: pack[i].hp + d.heal, goblin: d.goblin }));

  it('sends every goblin at half HP or more after the player', () => {
    expect(decide([at(1, 4), at(2, 2)]).map((g) => g.mode)).toEqual(['chase', 'chase']);
  });

  it('hides a lone hurt goblin for as long as others are alive', () => {
    const pack = [at(1, 4), at(2, 1)];
    const first = decide(pack);
    expect(first.map((g) => g.mode)).toEqual(['chase', 'hide']);
    // Long past the old 2.5s retreat, it is still waiting for a partner.
    expect(decide(carry(pack, first), 60_000).map((g) => g.mode)).toEqual(['chase', 'hide']);
  });

  it('pairs two hurt goblins up and sends each to where the other is', () => {
    const [a, b] = decide([at(1, 1, { x: 0, y: 0 }), at(2, 1, { x: 6, y: 2 }), at(3, 4)]);
    expect(a).toMatchObject({ mode: 'seek', partner: 2, meetAt: { x: 6, y: 2 } });
    expect(b).toMatchObject({ mode: 'seek', partner: 1, meetAt: { x: 0, y: 0 } });
  });

  it('pairs the two closest when three are hurt, and the third keeps hiding', () => {
    // 2 and 3 are two steps apart; 1 is eight or more steps from either.
    const decided = decide([at(1, 1, { x: 0, y: 0 }), at(2, 1, { x: 10, y: 0 }), at(3, 1, { x: 8, y: 0 })]);
    expect(decided.map((g) => [g.mode, g.partner])).toEqual([['hide', undefined], ['seek', 3], ['seek', 2]]);
  });

  it('counts a pair as met once they stand on the same or neighbouring tiles', () => {
    const modes = (b: { x: number; y: number }) => decide([at(1, 1, { x: 4, y: 2 }), at(2, 1, b)]).map((g) => [g.mode, g.partner]);
    // Met, they start healing: equally hurt, the lower id goes first.
    expect(modes({ x: 5, y: 2 })).toEqual([['mend', 2], ['heal', 1]]);
    expect(modes({ x: 4, y: 2 })).toEqual([['mend', 2], ['heal', 1]]);
    // Diagonal is still a step apart on foot.
    expect(modes({ x: 5, y: 3 })).toEqual([['seek', 2], ['seek', 1]]);
  });

  it('heals the more hurt of a pair first, while the other stands and channels', () => {
    const pack = frame([at(1, 1.5, { x: 4, y: 2 }), at(2, 1, { x: 5, y: 2 })], 1000);
    expect(pack.map((m) => m.goblin.mode)).toEqual(['heal', 'mend']);
  });

  it('gives the one being healed its HP back steadily, 2 HP/s here', () => {
    let pack = frame([at(1, 1.5, { x: 4, y: 2 }), at(2, 1, { x: 5, y: 2 })], 1000);
    pack = frame(pack, 1500);
    expect(pack.map((m) => m.hp)).toEqual([1.5, 2]);
    pack = frame(pack, 1750);
    expect(pack.map((m) => m.hp)).toEqual([1.5, 2.5]);
  });

  it('swaps once the first is full, and sends both back to the fight once both are', () => {
    let pack = frame([at(1, 1.5, { x: 4, y: 2 }), at(2, 1, { x: 5, y: 2 })], 1000);
    // 3 HP to go at 2 HP/s: full at 2500.
    pack = frame(pack, 2500);
    expect(pack.map((m) => m.hp)).toEqual([1.5, 4]);
    pack = frame(pack, 2600);
    expect(pack.map((m) => m.goblin.mode)).toEqual(['mend', 'heal']);
    // 2.5 HP to go: full 1.25s later.
    pack = frame(pack, 3850);
    expect(pack.map((m) => m.hp)).toEqual([4, 4]);
    pack = frame(pack, 3900);
    expect(pack.map((m) => [m.goblin.mode, m.goblin.partner])).toEqual([['chase', undefined], ['chase', undefined]]);
  });

  it('pairs up and heals again as often as the pair gets hurt again', () => {
    let pack = frame([at(1, 1, { x: 4, y: 2 }), at(2, 1, { x: 5, y: 2 })], 1000);
    for (const t of [2500, 2600, 4100, 4200]) pack = frame(pack, t);
    expect(pack.map((m) => [m.hp, m.goblin.mode])).toEqual([[4, 'chase'], [4, 'chase']]);
    // Hurt below half again: they heal each other all over again.
    pack = frame(pack.map((m) => ({ ...m, hp: 1 })), 5000);
    expect(pack.map((m) => m.goblin.mode)).toEqual(['mend', 'heal']);
    pack = frame(pack, 5500);
    expect(pack.map((m) => m.hp)).toEqual([2, 1]);
  });

  it('lets the last goblin alive flee once for 2.5s, then fight to the death', () => {
    const step = (goblin: ReturnType<typeof createGoblin>, time: number) => decide([{ ...at(1, 1), goblin }], time)[0];
    let g = step(createGoblin(), 1000);
    expect(g.mode).toBe('retreat');
    g = step(g, 3400);
    expect(g.mode).toBe('retreat');
    g = step(g, 3500);
    expect(g.mode).toBe('chase');
    // Still hurt, with nobody to heal it: it never runs again.
    g = step(g, 20_000);
    expect(g.mode).toBe('chase');
  });
});

describe('seed-spitter spread', () => {
  const close = (actual: { x: number; y: number }[], expected: { x: number; y: number }[]) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => {
      expect(v.x).toBeCloseTo(expected[i].x, 6);
      expect(v.y).toBeCloseTo(expected[i].y, 6);
    });
  };

  it('fires three shots at the given speed: one straight at the target and one either side', () => {
    // Aiming right at speed 10 with a 90 degree fan: straight right, straight up, straight down.
    close(spreadShots({ x: 5, y: 0 }, 10, Math.PI / 2), [
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      { x: 0, y: 10 },
    ]);
  });

  it('turns the fan with the aim', () => {
    // Aiming down-left at speed 2 with a 45 degree fan.
    const r = Math.SQRT1_2 * 2;
    close(spreadShots({ x: -3, y: 3 }, 2, Math.PI / 4), [
      { x: -r, y: r },
      { x: 0, y: 2 },
      { x: -2, y: 0 },
    ]);
  });

  it('fans its default spread evenly, well short of a right angle', () => {
    const [middle, a, b] = spreadShots({ x: 0, y: 1 }, 1);
    expect(middle.x).toBeCloseTo(0, 6);
    expect(middle.y).toBeCloseTo(1, 6);
    expect(a.x).toBeCloseTo(-b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.y).toBeGreaterThan(0.8);
    expect(a.y).toBeLessThan(1);
  });
});
