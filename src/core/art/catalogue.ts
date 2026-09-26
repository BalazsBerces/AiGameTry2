import { CHARACTERS, type Action, type View } from './characters';

/**
 * Every piece of paper art the game bakes at boot, by key: what the texture baker draws and the
 * visual layer looks up. Nothing here draws; each entry makes its SVG only when asked.
 */
export interface ArtEntry {
  key: string;
  w: number;
  h: number;
  svg(): string;
}

/** Kinds whose champions get their own gold-trimmed frames. */
const CHAMPION_KINDS = new Set(['goblin', 'seedSpitter', 'boar', 'wasp']);

export const charKey = (kind: string, action: Action, frame: number, view: View, champion = false) =>
  `c:${kind}:${action}:${frame}:${view}${champion ? ':champ' : ''}`;

function characterEntries(): ArtEntry[] {
  return Object.entries(CHARACTERS).flatMap(([kind, art]) =>
    (CHAMPION_KINDS.has(kind) ? [false, true] : [false]).flatMap((champion) =>
      art.views.flatMap((view) =>
        (Object.entries(art.actions) as [Action, number][]).flatMap(([action, count]) =>
          Array.from({ length: count }, (_, frame) => ({
            key: charKey(kind, action, frame, view, champion),
            w: art.w,
            h: art.h,
            svg: () => art.draw(action, frame, view, champion),
          })),
        ),
      ),
    ),
  );
}

/** The whole catalogue, in a fixed order. */
export function artCatalogue(): ArtEntry[] {
  return [...characterEntries()];
}
