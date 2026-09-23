import type { Cell } from './floorGenerator';
import type { Tile } from './roomGenerator';
import { blocksShots, hitsToBreak, isWalkable } from './tiles';

/**
 * The forest's charger. It rests, then, once it sees the player lined up with it, winds up
 * and dashes in a straight line until the first tile it can't run through. Running into
 * something solid (stone, rock, the room wall) stuns it, and smashes rock for good; it pulls
 * up short of holes and thorns unharmed.
 */
export interface BoarRules {
  /** Rest between charges (and before the first). */
  idleMs: number;
  /** The tell: how long it paws the ground before dashing. */
  windUpMs: number;
  /** How long a hard stop leaves it stunned. */
  stunMs: number;
  /** A dash held up (by another enemy, say) this long is given up. */
  maxDashMs: number;
  /** It only charges a player at most this many tiles off its row or column. */
  lineUpTiles: number;
}

/** Placeholder numbers for playtest tuning. */
export const BOAR: BoarRules = { idleMs: 1200, windUpMs: 650, stunMs: 1600, maxDashMs: 1600, lineUpTiles: 0.6 };

/** A unit grid step: the dash runs along one axis. */
export type Heading = Cell;

export type Boar =
  | { mode: 'idle'; readyAt: number }
  | { mode: 'windUp'; direction: Heading; dashAt: number }
  | { mode: 'dash'; direction: Heading; stop: Cell; giveUpAt: number }
  | { mode: 'stunned'; until: number };

export interface BoarSenses {
  time: number;
  /** The boar's tile. */
  at: Cell;
  /** Offset to the player, in tiles. */
  toPlayer: { x: number; y: number };
  canSeePlayer: boolean;
  tiles: Tile[][];
  /** While dashing: it has reached its stop tile. */
  arrived?: boolean;
}

export interface BoarStep {
  boar: Boar;
  /** It hit something solid and is stunned this long (the shared enemy stun). */
  stunMs?: number;
  /** The rock it smashed, which is floor from now on. */
  smashed?: Cell;
}

export const createBoar = (time: number, rules: BoarRules = BOAR): Boar => ({ mode: 'idle', readyAt: time + rules.idleMs });

const tileAt = (tiles: Tile[][], c: Cell): Tile | undefined => tiles[c.y]?.[c.x];

/** The last tile it can run onto from `from` heading `direction`. */
function dashStop(tiles: Tile[][], from: Cell, direction: Heading): Cell {
  let at = from;
  for (;;) {
    const next = { x: at.x + direction.x, y: at.y + direction.y };
    const tile = tileAt(tiles, next);
    if (!tile || !isWalkable(tile)) return at;
    at = next;
  }
}

/** The player's axis, if they are lined up with the boar along it. */
function lineUp(toPlayer: { x: number; y: number }, rules: BoarRules): Heading | undefined {
  const horizontal = Math.abs(toPlayer.x) >= Math.abs(toPlayer.y);
  const [along, across] = horizontal ? [toPlayer.x, toPlayer.y] : [toPlayer.y, toPlayer.x];
  if (along === 0 || Math.abs(across) > rules.lineUpTiles) return undefined;
  return horizontal ? { x: Math.sign(along), y: 0 } : { x: 0, y: Math.sign(along) };
}

export function updateBoar(boar: Boar, senses: BoarSenses, rules: BoarRules = BOAR): BoarStep {
  const { time, tiles } = senses;
  const rest = (): Boar => ({ mode: 'idle', readyAt: time + rules.idleMs });
  switch (boar.mode) {
    case 'idle': {
      const direction = senses.canSeePlayer && time >= boar.readyAt ? lineUp(senses.toPlayer, rules) : undefined;
      return { boar: direction ? { mode: 'windUp', direction, dashAt: time + rules.windUpMs } : boar };
    }
    case 'windUp':
      if (time < boar.dashAt) return { boar };
      return {
        boar: { mode: 'dash', direction: boar.direction, stop: dashStop(tiles, senses.at, boar.direction), giveUpAt: time + rules.maxDashMs },
      };
    case 'dash': {
      if (!senses.arrived) return { boar: time >= boar.giveUpAt ? rest() : boar };
      const ahead = { x: boar.stop.x + boar.direction.x, y: boar.stop.y + boar.direction.y };
      const tile = tileAt(tiles, ahead);
      // Off the room's tiles is its wall, which is as solid as stone.
      const solid = !tile || (blocksShots(tile) && !isWalkable(tile));
      if (!solid) return { boar: rest() };
      return {
        boar: { mode: 'stunned', until: time + rules.stunMs },
        stunMs: rules.stunMs,
        ...(tile && hitsToBreak(tile) ? { smashed: ahead } : {}),
      };
    }
    case 'stunned':
      return { boar: time >= boar.until ? rest() : boar };
  }
}
