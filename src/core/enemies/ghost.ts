/**
 * The dungeon's ghost drifts through walls, rocks and pits on a fixed cycle: visible for a
 * while, then faded. It can only be hit (and only hurts) while visible, so shots have to be timed.
 */
export interface GhostRules {
  /** How long each visible window lasts. */
  visibleMs: number;
  /** How long it stays faded between visible windows. */
  fadedMs: number;
  /** How long its opacity eases at each change, a tell of what comes next. */
  fadeMs: number;
}

/** Placeholder numbers for playtest tuning. */
export const GHOST: GhostRules = { visibleMs: 1400, fadedMs: 1800, fadeMs: 250 };

/** Opacity bands: fully solid at the heart of a visible window, faintest mid-fade. */
const OPACITY = { solid: 1, edge: 0.7, fadedEdge: 0.45, faint: 0.15 };

export interface GhostState {
  visible: boolean;
  /** Shots land and touching it hurts: exactly while visible. */
  hittable: boolean;
  /** How solid to draw it, from faint (faded) to 1 (visible). */
  opacity: number;
}

/** How far `ms` is into an eased window of length `length`: 0 at either edge, 1 in the middle. */
const ease = (ms: number, length: number, fadeMs: number) => Math.min(1, ms / fadeMs, (length - ms) / fadeMs);

/**
 * The ghost's state at `time` (ms). `offsetMs` shifts its whole schedule, so ghosts sharing a
 * room are out of step; a ghost starts a visible window at its offset.
 */
export function ghostAt(time: number, offsetMs = 0, rules: GhostRules = GHOST): GhostState {
  const cycle = rules.visibleMs + rules.fadedMs;
  const at = (((time - offsetMs) % cycle) + cycle) % cycle;
  if (at < rules.visibleMs) {
    const opacity = OPACITY.edge + (OPACITY.solid - OPACITY.edge) * ease(at, rules.visibleMs, rules.fadeMs);
    return { visible: true, hittable: true, opacity };
  }
  const opacity = OPACITY.fadedEdge - (OPACITY.fadedEdge - OPACITY.faint) * ease(at - rules.visibleMs, rules.fadedMs, rules.fadeMs);
  return { visible: false, hittable: false, opacity };
}
