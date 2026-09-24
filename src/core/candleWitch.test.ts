import { describe, expect, it } from 'vitest';
import {
  CANDLE_WITCH,
  candleCells,
  createWitch,
  damageFactor,
  isDark,
  lightSources,
  relightTarget,
  snuffCandle,
  updateWitch,
  type Witch,
  type WitchAttack,
} from './candleWitch';

const CELLS = candleCells(26, 14);

/** Runs the witch from `from` to `to` in 20 ms frames, with the player and witch where given. */
function run(witch: Witch, from: number, to: number, player = { x: 13, y: 7 }, at = { x: 13, y: 4 }) {
  const attacks: { at: number; attack: WitchAttack }[] = [];
  let w = witch;
  for (let time = from; time <= to; time += 20) {
    const out = updateWitch(w, { time, player, witch: at });
    w = out.witch;
    for (const attack of out.attacks) attacks.push({ at: time, attack });
  }
  return { witch: w, attacks };
}

describe('candle witch candles', () => {
  it('stands a candle in each corner of the room, inside the walls', () => {
    expect(CELLS).toHaveLength(4);
    const xs = new Set(CELLS.map((c) => c.x));
    const ys = new Set(CELLS.map((c) => c.y));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
    for (const c of CELLS) {
      expect(c.x > 0 && c.x < 25 && c.y > 0 && c.y < 13).toBe(true);
    }
  });

  it('starts with all four lit, each with a pattern of its own', () => {
    const w = createWitch(0, CELLS);
    expect(w.candles.map((c) => c.lit)).toEqual([true, true, true, true]);
    expect(new Set(w.candles.map((c) => c.pattern)).size).toBe(4);
  });

  it('has every lit candle fire its pattern', () => {
    const { attacks } = run(createWitch(0, CELLS), 0, 3000);
    const fired = new Set(attacks.flatMap((a) => (a.attack.from === 'candle' ? [a.attack.candle] : [])));
    expect([...fired].sort()).toEqual([0, 1, 2, 3]);
  });

  it('stops a snuffed candle firing', () => {
    const { attacks } = run(snuffCandle(createWitch(0, CELLS), 2), 0, 3000);
    const fired = new Set(attacks.flatMap((a) => (a.attack.from === 'candle' ? [a.attack.candle] : [])));
    expect([...fired].sort()).toEqual([0, 1, 3]);
  });

  it('aims the aimed candle at the player', () => {
    const w = createWitch(0, CELLS);
    const aimed = w.candles.findIndex((c) => c.pattern === 'aimed');
    const { attacks } = run(w, 0, 3000, { x: 13, y: 7 });
    const shot = attacks.find((a) => a.attack.from === 'candle' && a.attack.candle === aimed)!.attack;
    const c = CELLS[aimed];
    const toPlayer = Math.atan2(7 - (c.y + 0.5), 13 - (c.x + 0.5));
    const mean = shot.angles.reduce((s, a) => s + a, 0) / shot.angles.length;
    expect(mean).toBeCloseTo(toPlayer);
  });
});

describe('candle witch relighting', () => {
  const { relightEveryMs, relightMs, relightDamageFactor } = CANDLE_WITCH;

  it('never goes to relight while every candle burns', () => {
    for (const t of [relightEveryMs - 10, relightEveryMs + 10, relightEveryMs * 2 + 10]) {
      expect(relightTarget(run(createWitch(0, CELLS), 0, t).witch)).toBeUndefined();
    }
  });

  it('goes to a snuffed candle on its beat, and it burns again once she is done', () => {
    const snuffed = snuffCandle(createWitch(0, CELLS), 1);
    expect(relightTarget(run(snuffed, 0, relightEveryMs - 10).witch)).toBeUndefined();
    const relighting = run(snuffed, 0, relightEveryMs + 10).witch;
    expect(relightTarget(relighting)).toEqual(CELLS[1]);
    expect(relighting.candles[1].lit).toBe(false);
    const done = run(snuffed, 0, relightEveryMs + relightMs + 10);
    expect(relightTarget(done.witch)).toBeUndefined();
    expect(done.witch.candles[1].lit).toBe(true);
    const later = run(done.witch, relightEveryMs + relightMs + 10, relightEveryMs + relightMs + 3000);
    expect(later.attacks.some((a) => a.attack.from === 'candle' && a.attack.candle === 1)).toBe(true);
  });

  it('goes to the snuffed candle nearest her', () => {
    let w = createWitch(0, CELLS);
    for (const i of [0, 3]) w = snuffCandle(w, i);
    const nearLast = { x: CELLS[3].x, y: CELLS[3].y - 1 };
    expect(relightTarget(run(w, 0, relightEveryMs + 10, { x: 13, y: 7 }, nearLast).witch)).toEqual(CELLS[3]);
  });

  it('takes heavy damage only while she relights', () => {
    const snuffed = snuffCandle(createWitch(0, CELLS), 1);
    expect(damageFactor(run(snuffed, 0, relightEveryMs - 10).witch)).toBe(1);
    expect(damageFactor(run(snuffed, 0, relightEveryMs + 10).witch)).toBe(relightDamageFactor);
    expect(relightDamageFactor).toBeGreaterThan(1);
    expect(damageFactor(run(snuffed, 0, relightEveryMs + relightMs + 10).witch)).toBe(1);
  });
});

describe('candle witch darkness', () => {
  it('darkens the room once she is down to half her hit points', () => {
    expect(isDark(51, 100)).toBe(false);
    expect(isDark(50, 100)).toBe(true);
  });

  it('lights the room only from the lit candles and her own flame', () => {
    let w = createWitch(0, CELLS);
    const her = { x: 10.5, y: 6.5 };
    const keys = (ps: { x: number; y: number }[]) => ps.map((p) => `${p.x},${p.y}`).sort();
    expect(keys(lightSources(w, her))).toEqual(keys([...CELLS.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })), her]));
    w = snuffCandle(snuffCandle(w, 0), 2);
    expect(keys(lightSources(w, her))).toEqual(keys([CELLS[1], CELLS[3]].map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })).concat(her)));
  });
});

describe('candle witch curses', () => {
  it('casts curses aimed at the player on a steady beat', () => {
    const { attacks } = run(createWitch(0, CELLS), 0, CANDLE_WITCH.curseEveryMs * 3 + 10, { x: 13, y: 10 }, { x: 13, y: 4 });
    const curses = attacks.filter((a) => a.attack.from === 'witch');
    expect(curses.length).toBe(3);
    for (const c of curses) {
      const mean = c.attack.angles.reduce((s, a) => s + a, 0) / c.attack.angles.length;
      expect(mean).toBeCloseTo(Math.PI / 2);
    }
  });
});
