/** How the bar feels its big moments; placeholders for playtest tuning. */
export const BAR_FEEL = {
  /** At the snap the whole bar jolts this hard (px), fading out over `snapJoltMs`. */
  snapJoltPx: 7,
  snapJoltMs: 450,
  /** The halves fly apart this many times their gap, then slam back to it, all over `snapMs`. */
  snapOvershoot: 3.5,
  snapMs: 480,
  /** A dying half's piece trembles this hard (px), and harder with each pop, up to `dyingPx` more by its head blast. */
  dyingBasePx: 0.8,
  dyingPx: 4,
  /** The bar trembles this hard (px) through the roar. */
  roarPx: 2.5,
};

/** The worm boss's health bar: one piece, ripped in two when the worm splits. */
export interface BossBarSnapshot {
  maxHp: number;
  /** The whole worm's hit points, before it splits. */
  hp: number;
  /** After the split: each half, the one with the old head first. */
  halves?: BarHalf[];
  /** When it split. */
  splitAt?: number;
  rage: boolean;
  /** The last stand's roar, while and since it began. */
  roar?: { from: number; until: number };
}

export interface BarHalf {
  pool: number;
  /** Its pool when the worm split. */
  startPool: number;
  alive: boolean;
  /** Once dead, its half blowing apart: `pops` of its `of` segments popped so far, and whether its head blast has gone off. */
  death?: { pops: number; of: number; blown: boolean };
}

export interface BarPiece {
  /** Edges as shares of the bar's full width. */
  left: number;
  right: number;
  /** How full the piece is, as a share of its own width. */
  fill: number;
  /** A dead half's piece is `dying` while the half blows apart, and crumbles at its head blast. */
  state: 'whole' | 'torn' | 'dying' | 'crumbling' | 'rage';
  /**
   * The share of it still there, from its left edge: a dying piece breaks off a chunk from its
   * tail end (the right, as the bar runs head to tail) with each segment of its half that pops.
   */
  remaining: number;
}

const dying = (h: BarHalf) => !h.alive && !!h.death && !h.death.blown;

/**
 * How hard each of the bar's pieces (as `layoutBossBar` lays them out) shakes at `now`, in px:
 * a hard jolt at the snap that fades fast, a dying half's piece trembling harder with each pop,
 * and a tremble through the roar. Nothing else shakes it.
 */
export function barShake(s: BossBarSnapshot, now: number): number[] {
  const since = s.splitAt === undefined ? Infinity : now - s.splitAt;
  const snap = since >= 0 && since < BAR_FEEL.snapJoltMs ? BAR_FEEL.snapJoltPx * (1 - since / BAR_FEEL.snapJoltMs) ** 2 : 0;
  const roar = s.roar && now >= s.roar.from && now < s.roar.until ? BAR_FEEL.roarPx : 0;
  const tremble = (h: BarHalf) => (dying(h) ? BAR_FEEL.dyingBasePx + (BAR_FEEL.dyingPx * h.death!.pops) / h.death!.of : 0);
  return (s.halves ?? [undefined]).map((h) => Math.max(snap, roar, h ? tremble(h) : 0));
}

/**
 * The tear's width `sinceMs` after the snap, settling on `rest`: the halves fly apart well past
 * it, slam back, and shiver to a stop on it.
 */
export function snapGap(sinceMs: number, rest: number): number {
  const k = sinceMs / BAR_FEEL.snapMs;
  const peak = rest * BAR_FEEL.snapOvershoot;
  if (k <= 0) return 0;
  if (k >= 1) return rest;
  if (k < 0.25) return peak * (1 - (1 - k / 0.25) ** 2);
  if (k < 0.5) return peak + (rest - peak) * ((k - 0.25) / 0.25) ** 2;
  const u = (k - 0.5) / 0.5;
  return rest * (1 - 0.3 * Math.sin(Math.PI * 2 * u) * (1 - u));
}

/**
 * The bar's pieces, left to right; `gap` is the tear's width as a share of the bar's. Once split,
 * the bar rips where the halves' hit points meet, and each piece is full at the split and drains
 * with its own half.
 */
export function layoutBossBar(s: BossBarSnapshot, gap: number): BarPiece[] {
  if (!s.halves) return [{ left: 0, right: 1, fill: s.hp / s.maxHp, state: s.hp > 0 ? 'whole' : 'crumbling', remaining: 1 }];
  const total = s.halves.reduce((sum, h) => sum + h.startPool, 0);
  const tear = s.halves[0].startPool / total;
  const edges = [
    [0, tear - gap / 2],
    [tear + gap / 2, 1],
  ];
  return s.halves.map((h, i) => ({
    left: edges[i][0],
    right: edges[i][1],
    fill: h.pool / h.startPool,
    state: dying(h) ? 'dying' : !h.alive ? 'crumbling' : s.rage ? 'rage' : 'torn',
    remaining: h.death ? 1 - h.death.pops / h.death.of : 1,
  }));
}
