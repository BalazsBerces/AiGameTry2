/**
 * Everything that stands up in the 3/4 view (characters, trees, walls) shares one band of draw
 * depths, sorted by where its feet are: lower on screen is nearer the camera, so drawn over.
 * The band sits where the player's shape used to (10), so what was drawn over or under it still is.
 */
export const STANDING = { from: 10, to: 11 };

/** World y past which every foot line counts as the same (far larger than any floor). */
const MAX_Y = 100_000;
/** Serials that tell apart things standing on the same line. */
const SERIALS = 1_000_000;
const PER_PX = (STANDING.to - STANDING.from) / MAX_Y;

/** Draw depth of something whose feet are at world `footY`; `serial` breaks ties the same way every time. */
export function footDepth(footY: number, serial: number): number {
  const y = Math.min(Math.max(footY, 0), MAX_Y - 1);
  // The tie-break stays under half a pixel's worth of depth, so it never reorders different lines.
  const tie = ((serial % SERIALS) / SERIALS) * PER_PX * 0.4;
  return STANDING.from + y * PER_PX + tie;
}
