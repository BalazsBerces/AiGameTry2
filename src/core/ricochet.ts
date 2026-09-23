import type { Cell } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { reflectsShots } from './tiles';

/** A shot in tile units (tile x spans x..x+1), with the stone bounces it still has. */
export interface RicochetShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bouncesLeft: number;
}

/** How often a crystal turret's shot may bounce off stone; other shots have none. */
export const CRYSTAL_TURRET_BOUNCES = 1;

/** Offsets closer than this to equal count as hitting a corner. */
const CORNER_EPSILON = 1e-6;

/**
 * What happens to a shot that hits `tile` at `cell`: its reflected velocity (and the bounces it
 * has left), or undefined when the tile stops it. Reflecting tiles (crystals) bounce every shot
 * for free; stone bounces a shot only while it has bounces left; everything else stops it.
 */
export function ricochet(shot: RicochetShot, tile: Tile, cell: Cell): Omit<RicochetShot, 'x' | 'y'> | undefined {
  let bouncesLeft = shot.bouncesLeft;
  if (!reflectsShots(tile)) {
    if (tile !== 'obstacle' || bouncesLeft <= 0) return undefined;
    bouncesLeft--;
  }
  const face = faceHit(shot, cell);
  return {
    vx: face.vertical ? -shot.vx : shot.vx,
    vy: face.horizontal ? -shot.vy : shot.vy,
    bouncesLeft,
  };
}

/** Which faces of the tile the shot struck: a vertical (left/right) one, a horizontal (top/bottom) one, or both at a corner. */
function faceHit(shot: RicochetShot, cell: Cell) {
  // How far the shot's centre lies outside the tile along each axis.
  let ox = Math.max(cell.x - shot.x, 0, shot.x - (cell.x + 1));
  let oy = Math.max(cell.y - shot.y, 0, shot.y - (cell.y + 1));
  if (ox === 0 && oy === 0) {
    // Already inside: it came in through the face it is least deep behind, on its way in.
    ox = -(shot.vx > 0 ? shot.x - cell.x : shot.vx < 0 ? cell.x + 1 - shot.x : Infinity);
    oy = -(shot.vy > 0 ? shot.y - cell.y : shot.vy < 0 ? cell.y + 1 - shot.y : Infinity);
  }
  if (Math.abs(ox - oy) < CORNER_EPSILON) return { vertical: true, horizontal: true };
  return ox > oy ? { vertical: true, horizontal: false } : { vertical: false, horizontal: true };
}
