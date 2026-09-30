import type { Cell } from '../map/floorGenerator';
import { attackBreaks } from '../map/tiles';
import type { Tile } from '../rooms/roomGenerator';

/** A sword swing, in a room's tile units (2.5 = centre of tile 2). */
export interface Swing {
  /** Where the player swings from. */
  from: { x: number; y: number };
  /** The aim, in radians (0 = right, y down). */
  facing: number;
  /** The whole arc's width, in degrees. */
  arcDeg: number;
  /** How far the blade reaches, in tiles. */
  reach: number;
}

/**
 * Whether a target of `size` centred at `at` is inside the swing: within reach of its near edge,
 * and its centre within the arc. The same test the scene makes on enemy parts.
 */
export function inSwing(swing: Swing, at: { x: number; y: number }, size: number): boolean {
  const dx = at.x - swing.from.x;
  const dy = at.y - swing.from.y;
  const half = (swing.arcDeg / 2) * (Math.PI / 180);
  const off = Math.atan2(dy, dx) - swing.facing;
  const wrapped = Math.atan2(Math.sin(off), Math.cos(off));
  return Math.hypot(dx, dy) <= swing.reach + size / 2 && Math.abs(wrapped) <= half;
}

/** The room cells a swing hits once each: every breakable tile (rock, glowshroom) inside its arc. */
export function swordCells(swing: Swing, tiles: Tile[][]): Cell[] {
  const cells: Cell[] = [];
  const r = Math.ceil(swing.reach + 1);
  const cx = Math.floor(swing.from.x);
  const cy = Math.floor(swing.from.y);
  for (let y = Math.max(0, cy - r); y <= Math.min(tiles.length - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(tiles[y].length - 1, cx + r); x++) {
      if (attackBreaks(tiles[y][x]) && inSwing(swing, { x: x + 0.5, y: y + 0.5 }, 1)) cells.push({ x, y });
    }
  }
  return cells;
}
