import { beats, fan, ring, spiral } from './bulletPatterns';
import type { Cell } from '../map/floorGenerator';

/** Candle Witch numbers; placeholders for playtest tuning. */
export const CANDLE_WITCH = {
  /** Candles stand this many tiles in from each corner. */
  candleInset: 2,
  /** Each candle's pattern and how often it fires it. */
  patterns: {
    ring: { everyMs: 1600, bullets: 8 },
    spiral: { everyMs: 220, arms: 2, spinDegPerSec: 140 },
    aimed: { everyMs: 1300, bullets: 3, width: (30 * Math.PI) / 180 },
    cross: { everyMs: 900 },
  },
  /** The witch's own curse: a fan aimed at the player. */
  curseEveryMs: 1700,
  curseBullets: 3,
  curseWidth: (24 * Math.PI) / 180,
  /** On this beat she goes to relight a snuffed candle, if there is one... */
  relightEveryMs: 8000,
  /** ...taking this long over it, and this many times the damage meanwhile. */
  relightMs: 2200,
  relightDamageFactor: 2.5,
};

export type CandlePattern = keyof typeof CANDLE_WITCH.patterns;
const PATTERN_ORDER: CandlePattern[] = ['ring', 'spiral', 'aimed', 'cross'];

export interface Candle {
  cell: Cell;
  lit: boolean;
  pattern: CandlePattern;
  /** When it was (re)lit: its pattern keeps time from here. */
  litAt: number;
}

export interface Witch {
  candles: Candle[];
  start: number;
  /** Everything up to this time has been played out. */
  lastTime: number;
  /** The candle she is relighting, and when she started. */
  relight?: { candle: number; start: number };
}

export type WitchAttack = { from: 'candle'; candle: number; angles: number[] } | { from: 'witch'; angles: number[] };

interface Point {
  x: number;
  y: number;
}

export interface WitchInput {
  time: number;
  /** Positions in tile units (2.5 = the middle of tile 2). */
  player: Point;
  witch: Point;
}

/** A candle a few tiles in from each corner of a `width` x `height` room. */
export function candleCells(width: number, height: number): Cell[] {
  const i = CANDLE_WITCH.candleInset;
  return [
    { x: i, y: i },
    { x: width - 1 - i, y: i },
    { x: i, y: height - 1 - i },
    { x: width - 1 - i, y: height - 1 - i },
  ];
}

export const createWitch = (time: number, cells: Cell[]): Witch => ({
  candles: cells.map((cell, i) => ({ cell, lit: true, pattern: PATTERN_ORDER[i % PATTERN_ORDER.length], litAt: time })),
  start: time,
  lastTime: time,
});

/** One shot puts a candle out. */
export const snuffCandle = (witch: Witch, index: number): Witch => ({
  ...witch,
  candles: witch.candles.map((c, i) => (i === index ? { ...c, lit: false } : c)),
});

/** The candle she is on her way to relight, if any. */
export const relightTarget = (witch: Witch): Cell | undefined => (witch.relight ? witch.candles[witch.relight.candle].cell : undefined);

/** Damage to her is multiplied by this: heavy while she relights a candle. */
export const damageFactor = (witch: Witch) => (witch.relight ? CANDLE_WITCH.relightDamageFactor : 1);

const centre = (c: Cell): Point => ({ x: c.x + 0.5, y: c.y + 0.5 });

/** Phase two: at half her hit points the room goes dark. */
export const isDark = (hp: number, maxHp: number) => hp <= maxHp / 2;

/** What lights the dark room: every lit candle, and her own flame at `witchAt` (tile units). */
export const lightSources = (witch: Witch, witchAt: Point): Point[] => [
  ...witch.candles.filter((c) => c.lit).map((c) => centre(c.cell)),
  witchAt,
];
const angleTo = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);

/** The shots one candle fires at time `t`. */
function candleShot(candle: Candle, t: number, beat: number, player: Point): number[] {
  const P = CANDLE_WITCH.patterns;
  switch (candle.pattern) {
    case 'ring':
      return ring(P.ring.bullets);
    case 'spiral':
      return spiral(P.spiral.arms, t, P.spiral.spinDegPerSec);
    case 'aimed':
      return fan(angleTo(centre(candle.cell), player), P.aimed.bullets, P.aimed.width);
    case 'cross':
      // A plus, then an x, turn about.
      return ring(4, beat % 2 ? Math.PI / 4 : 0);
  }
}

/** Advances the witch to `input.time`: its new state and the shots it and its candles fire. */
export function updateWitch(witch: Witch, input: WitchInput): { witch: Witch; attacks: WitchAttack[] } {
  const from = witch.lastTime;
  const to = input.time;
  const attacks: WitchAttack[] = [];
  const { relightEveryMs, relightMs } = CANDLE_WITCH;
  let candles = witch.candles;
  let relight = witch.relight;
  if (relight && to >= relight.start + relightMs) {
    const done = relight;
    candles = candles.map((c, i) => (i === done.candle ? { ...c, lit: true, litAt: done.start + relightMs } : c));
    relight = undefined;
  }
  if (!relight && beats(witch.start, relightEveryMs, relightEveryMs, from, to).length) {
    const out = candles.flatMap((c, i) => (c.lit ? [] : [i]));
    const dist = (i: number) => Math.hypot(centre(candles[i].cell).x - input.witch.x, centre(candles[i].cell).y - input.witch.y);
    const nearest = out.sort((a, b) => dist(a) - dist(b))[0];
    if (nearest !== undefined) relight = { candle: nearest, start: to };
  }
  candles.forEach((candle, i) => {
    if (!candle.lit) return;
    const every = CANDLE_WITCH.patterns[candle.pattern].everyMs;
    for (const t of beats(candle.litAt, every, every, from, to)) {
      const beat = Math.round((t - candle.litAt) / every);
      attacks.push({ from: 'candle', candle: i, angles: candleShot(candle, t, beat, input.player) });
    }
  });
  for (const _ of beats(witch.start, CANDLE_WITCH.curseEveryMs, CANDLE_WITCH.curseEveryMs, from, to)) {
    attacks.push({ from: 'witch', angles: fan(angleTo(input.witch, input.player), CANDLE_WITCH.curseBullets, CANDLE_WITCH.curseWidth) });
  }
  return { witch: { ...witch, candles, relight, lastTime: to }, attacks };
}
