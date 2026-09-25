/** The worm boss's health bar: one piece, ripped in two when the worm splits. */
export interface BossBarSnapshot {
  maxHp: number;
  /** The whole worm's hit points, before it splits. */
  hp: number;
  /** After the split: each half, the one with the old head first. */
  halves?: BarHalf[];
  rage: boolean;
}

export interface BarHalf {
  pool: number;
  /** Its pool when the worm split. */
  startPool: number;
  alive: boolean;
}

export interface BarPiece {
  /** Edges as shares of the bar's full width. */
  left: number;
  right: number;
  /** How full the piece is, as a share of its own width. */
  fill: number;
  state: 'whole' | 'torn' | 'crumbling' | 'rage';
}

/**
 * The bar's pieces, left to right; `gap` is the tear's width as a share of the bar's. Once split,
 * the bar rips where the halves' hit points meet, and each piece is full at the split and drains
 * with its own half.
 */
export function layoutBossBar(s: BossBarSnapshot, gap: number): BarPiece[] {
  if (!s.halves) return [{ left: 0, right: 1, fill: s.hp / s.maxHp, state: s.hp > 0 ? 'whole' : 'crumbling' }];
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
    state: !h.alive ? 'crumbling' : s.rage ? 'rage' : 'torn',
  }));
}
