import { PASSIVE_POOL } from '../../core/rooms/roomGenerator';
import type { Passive, PassiveLevels } from '../../core/player/weaponModel';
import { passiveArtKey } from '../art/passiveArt';

/**
 * The HUD's row of owned passives, under the keys and bombs. A slot is `pitch` wide so all
 * 13 passives fit on one line; art icons are `icon` px square, other passives a `radius` dot.
 */
export const PASSIVE_ROW = { x: 21, y: 76, radius: 6, icon: 20, pitch: 24 };

/** One owned passive's place in the row. */
export interface PassiveSlot {
  passive: Passive;
  x: number;
  y: number;
  /** Its art's texture key, or undefined to draw the coloured dot. */
  art?: string;
  /** The white level-2 ring's radius, or undefined at level 1. */
  ring?: number;
}

/** The owned passives in pool order, each with its art (if loaded) and level-2 ring. */
export function passiveRow(passives: PassiveLevels, textures: { exists(key: string): boolean }): PassiveSlot[] {
  return PASSIVE_POOL.filter((p) => passives[p]).map((passive, i) => {
    const art = passiveArtKey(textures, passive);
    const ring = passives[passive] === 2 ? (art ? PASSIVE_ROW.icon / 2 + 1 : PASSIVE_ROW.radius + 3) : undefined;
    return { passive, x: PASSIVE_ROW.x + i * PASSIVE_ROW.pitch, y: PASSIVE_ROW.y, art, ring };
  });
}
