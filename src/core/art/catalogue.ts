import { CHARACTERS, type Action, type View } from './characters';
import { DECOR_CANVAS, DECOR_KINDS, JOIN_LOOKS, MASKED_LOOKS, TILE_CANVAS, TILE_LOOKS, WALL_STYLES, floorCanvas, floorLooks, terrainSvg, wallCanvas, type Shell, type WallSide, type WallStyle } from './terrain';
import type { Mask } from './autotile';
import { HEART_CANVAS, ICON_CANVAS, PICKUP_ART, PICKUP_CANVAS, SHOT_CANVAS, hudSvg, pickupSvg, type PickupArt } from './hud';

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
/** The room shell's pieces are keyed by the floor's shell: each floor has walls, doors and floors of its own. */
export const wallKey = (shell: Shell, side: WallSide, variant: number, style: WallStyle = WALL_STYLES[shell][0]) =>
  `w:${shell}:${style}:${side}:${variant % TILE_VARIANTS}`;
/** The wall a door is in, as the room's doors name it. */
export type DoorSide = 'up' | 'down' | 'left' | 'right';
const DOOR_ART_SIDE = { up: 'top', down: 'bottom', left: 'left', right: 'right' } as const;
export const doorKey = (shell: Shell, side: DoorSide, locked: boolean) => `d:${shell}:${side}:${locked ? 'locked' : 'open'}`;
export type FloorKind = 'normal' | 'item' | 'boss';
export const floorKey = (shell: Shell, kind: FloorKind, look: number) => `f:${shell}:${kind}:${look % floorLooks(shell)}`;
/**
 * The look of the floor piece at tile x,y. The forest's is just the tile's variant; a floor with
 * more looks than variants (the caves') mixes in where the tile is, so no look falls into a pattern.
 */
export function floorLook(shell: Shell, variant: number, x: number, y: number): number {
  if (floorLooks(shell) === TILE_VARIANTS) return variant;
  // An integer hash of where the tile lies: neighbours land on unrelated looks, with no rows or diagonals.
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(variant, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) % floorLooks(shell);
}
const SHELLS = Object.keys(WALL_STYLES) as Shell[];
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
    ...SHELLS.flatMap((shell) => [
      ...WALL_STYLES[shell].flatMap((style: WallStyle) =>
        (['top', 'bottom', 'left', 'right', 'corner'] as const).flatMap((side) =>
          variants.map((v) => ({ key: wallKey(shell, side, v, style), w: wallCanvas(style).w, h: wallCanvas(style).h, svg: () => terrainSvg.wall(side, v, style) })),
        ),
      ),
      ...(['up', 'down', 'left', 'right'] as const).flatMap((side) => [false, true].map((l) => tileEntry(doorKey(shell, side, l), () => terrainSvg.door(DOOR_ART_SIDE[side], l, shell)))),
      ...(['normal', 'item', 'boss'] as const).flatMap((kind) => Array.from({ length: floorLooks(shell) }, (_, v) => v).map((v) => ({ key: floorKey(shell, kind, v), w: floorCanvas(shell).w, h: floorCanvas(shell).h, svg: () => terrainSvg.floor(kind, v, shell) }))),
    ]),
    ...DECOR_KINDS.flatMap((kind) =>
      variants.map((v) => ({ key: decorKey(kind, v), w: DECOR_CANVAS.w, h: DECOR_CANVAS.h, svg: () => terrainSvg.decor(kind, v) })),
    ),
  ];
}

/** A glowing paper shot, drawn at the size of a player shot (7 px) or an enemy's (6 px); other sizes scale it. */
export const SHOT_ART = { player: 7, enemy: 6 } as const;
export const shotKey = (kind: keyof typeof SHOT_ART) => `s:${kind}`;

function shotEntries(): ArtEntry[] {
  return (Object.keys(SHOT_ART) as (keyof typeof SHOT_ART)[]).map((kind) => ({
    key: shotKey(kind),
    w: SHOT_CANVAS,
    h: SHOT_CANVAS,
    svg: () => hudSvg.shot(kind, SHOT_ART[kind]),
  }));
}

export const pickupKey = (kind: PickupArt) => `p:${kind}`;

function pickupEntries(): ArtEntry[] {
  return (Object.keys(PICKUP_ART) as PickupArt[]).map((kind) => ({ key: pickupKey(kind), w: PICKUP_CANVAS, h: PICKUP_CANVAS, svg: () => pickupSvg(kind) }));
}

/** The HUD's pieces: hearts and the key and bomb icons. */
export const HUD_KEYS = { heart: (level: 'full' | 'half' | 'empty') => `h:heart:${level}`, key: 'h:key', bomb: 'h:bomb' } as const;

function hudEntries(): ArtEntry[] {
  return [
    ...(['full', 'half', 'empty'] as const).map((level) => ({ key: HUD_KEYS.heart(level), w: HEART_CANVAS, h: HEART_CANVAS, svg: () => hudSvg.heart(level) })),
    { key: HUD_KEYS.key, w: ICON_CANVAS, h: ICON_CANVAS, svg: () => hudSvg.key() },
    { key: HUD_KEYS.bomb, w: ICON_CANVAS, h: ICON_CANVAS, svg: () => hudSvg.bomb() },
  ];
}

/** The whole catalogue, in a fixed order. */
export function artCatalogue(): ArtEntry[] {
  return [...characterEntries(), ...terrainEntries(), ...shotEntries(), ...pickupEntries(), ...hudEntries()];
}
