import { CHARACTERS, type Action, type View } from './characters';
import { DECOR_CANVAS, DECOR_KINDS, JOIN_LOOKS, MASKED_LOOKS, TILE_CANVAS, TILE_LOOKS, terrainSvg, type WallSide } from './terrain';
import type { Mask } from './autotile';

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

/** Looks each terrain tile kind comes in, picked by the tile's variant (core/dressing). */
export const TILE_VARIANTS = 4;

export const tileKey = (art: string, variant: number, mask: Mask = 0) => `t:${art}:${variant % TILE_VARIANTS}:${MASKED_LOOKS.includes(art) ? mask : 0}`;
export const joinKey = (art: string, dir: 'across' | 'down') => `j:${art}:${dir}`;
export const wallKey = (side: WallSide, variant: number) => `w:${side}:${variant % TILE_VARIANTS}`;
/** The wall a door is in, as the room's doors name it. */
export type DoorSide = 'up' | 'down' | 'left' | 'right';
const DOOR_ART_SIDE = { up: 'top', down: 'bottom', left: 'left', right: 'right' } as const;
export const doorKey = (side: DoorSide, locked: boolean) => `d:${side}:${locked ? 'locked' : 'open'}`;
export type FloorKind = 'normal' | 'item' | 'boss';
export const floorKey = (kind: FloorKind, variant: number) => `f:${kind}:${variant % TILE_VARIANTS}`;
export const decorKey = (kind: string, variant: number) => `k:${kind}:${variant % TILE_VARIANTS}`;

const variants = Array.from({ length: TILE_VARIANTS }, (_, v) => v);
const tileEntry = (key: string, svg: () => string): ArtEntry => ({ key, w: TILE_CANVAS.w, h: TILE_CANVAS.h, svg });

function terrainEntries(): ArtEntry[] {
  const masks = Array.from({ length: 16 }, (_, m) => m);
  return [
    ...TILE_LOOKS.flatMap((look) =>
      variants.flatMap((v) => (MASKED_LOOKS.includes(look) ? masks : [0]).map((m) => tileEntry(tileKey(look, v, m), () => terrainSvg.tile(look, v, m)))),
    ),
    ...JOIN_LOOKS.flatMap((look) => (['across', 'down'] as const).map((d) => tileEntry(joinKey(look, d), () => terrainSvg.join(look, d)))),
    ...(['top', 'bottom', 'left', 'right', 'corner'] as const).flatMap((side) => variants.map((v) => tileEntry(wallKey(side, v), () => terrainSvg.wall(side, v)))),
    ...(['up', 'down', 'left', 'right'] as const).flatMap((side) => [false, true].map((l) => tileEntry(doorKey(side, l), () => terrainSvg.door(DOOR_ART_SIDE[side], l)))),
    ...(['normal', 'item', 'boss'] as const).flatMap((kind) => variants.map((v) => tileEntry(floorKey(kind, v), () => terrainSvg.floor(kind, v)))),
    ...DECOR_KINDS.flatMap((kind) =>
      variants.map((v) => ({ key: decorKey(kind, v), w: DECOR_CANVAS.w, h: DECOR_CANVAS.h, svg: () => terrainSvg.decor(kind, v) })),
    ),
  ];
}

/** The whole catalogue, in a fixed order. */
export function artCatalogue(): ArtEntry[] {
  return [...characterEntries(), ...terrainEntries()];
}
