import Phaser from 'phaser';
import { STEP, type Cell } from '../core/floorGenerator';
import { CELL_TILES, roomPadding, type Door } from '../core/roomGenerator';
import type { WorldRoom } from '../core/world';
import { TUNING } from './config';

export const CELL_PX_W = CELL_TILES.w * TUNING.tile;
export const CELL_PX_H = CELL_TILES.h * TUNING.tile;
/** Strip under the playfield for the room label (HudScene); the game camera stops above it. */
export const LABEL_STRIP_H = 20;

export function cellOrigin(cell: Cell) {
  return { x: cell.x * CELL_PX_W, y: cell.y * CELL_PX_H };
}

/** The room's whole map-cell block in world pixels, plus its wall padding in tiles. */
export function roomBlock(room: WorldRoom) {
  const { cells, cell } = room.floorRoom;
  const cellsW = Math.max(...cells.map((c) => c.x)) - cell.x + 1;
  const cellsH = Math.max(...cells.map((c) => c.y)) - cell.y + 1;
  const o = cellOrigin(cell);
  return {
    x: o.x,
    y: o.y,
    w: cellsW * CELL_PX_W,
    h: cellsH * CELL_PX_H,
    tilesW: cellsW * CELL_TILES.w,
    tilesH: cellsH * CELL_TILES.h,
    pad: roomPadding(room.layout.width, room.layout.height),
  };
}

/** World-space center of interior tile (tx, ty); coordinates outside the interior reach into the walls. */
export function tileCenter(room: WorldRoom, tx: number, ty: number) {
  const b = roomBlock(room);
  return { x: b.x + (tx + b.pad.x + 0.5) * TUNING.tile, y: b.y + (ty + b.pad.y + 0.5) * TUNING.tile };
}

/** Interior tile under a world position, clamped to the room. */
export function tileAt(room: WorldRoom, x: number, y: number): Cell {
  const b = roomBlock(room);
  const t = TUNING.tile;
  return {
    x: Phaser.Math.Clamp(Math.floor((x - b.x) / t) - b.pad.x, 0, room.layout.width - 1),
    y: Phaser.Math.Clamp(Math.floor((y - b.y) / t) - b.pad.y, 0, room.layout.height - 1),
  };
}

/** Interior-tile coordinates of the doorway tiles running from the door out to the block edge. */
export function doorCorridor(room: WorldRoom, door: Door): Cell[] {
  const b = roomBlock(room);
  const depth = door.side === 'left' || door.side === 'right' ? b.pad.x : b.pad.y;
  const s = STEP[door.side];
  return Array.from({ length: depth }, (_, i) => ({ x: door.cell.x + s.x * (i + 1), y: door.cell.y + s.y * (i + 1) }));
}

export function mapCellAt(worldX: number, worldY: number): Cell {
  return { x: Math.floor(worldX / CELL_PX_W), y: Math.floor(worldY / CELL_PX_H) };
}
