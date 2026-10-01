import { CHARACTERS, type Action, type View } from '../core/art/characters';
import { hudSvg, HEART_CANVAS, ICON_CANVAS, SHOT_CANVAS, type ShotArt } from '../core/art/hud';
import { PAPER } from '../core/art/palette';
import { DOWN, LEFT, RIGHT, UP, type Mask } from '../core/art/autotile';
import { CAVE_FLOOR_CANVAS, CAVE_WALL_CANVAS, DECOR_CANVAS, JOIN_LOOKS, MASKED_LOOKS, TILE, TILE_CANVAS, WALL_STYLES, floorCanvas, floorLooks, hasGround, terrainSvg, wallCanvas, type Shell, type WallSide, type WallStyle } from '../core/art/terrain';
import { createRng } from '../core/rng';
import { SHOT_ART, floorLook } from '../core/art/catalogue';
import { roomThemeById, roomThemesFor } from '../core/rooms/roomThemes';

/**
 * The papercut style mockup: one forest room and the boss room drawn entirely from the paper art
 * library (core/art), lit the way the game will be, plus every character's frames and the tile,
 * dressing and HUD pieces. scripts/mockup.mjs snapshots it into a static page for review.
 */

const uri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Each distinct SVG is embedded once and placed with <use>. */
class Sheet {
  constructor(private prefix: string) {}
  private ids = new Map<string, string>();
  defs: string[] = [];
  id(svg: string, w: number, h: number) {
    let id = this.ids.get(svg);
    if (!id) {
      id = `${this.prefix}${this.ids.size}`;
      this.ids.set(svg, id);
      this.defs.push(`<image id="${id}" width="${w}" height="${h}" href="${uri(svg)}"/>`);
    }
    return id;
  }
}

interface Placed {
  /** Draw order key: the foot y. */
  y: number;
  svg: string;
}

const MAP = [
  '#######D#######',
  '#T.....b....TT#',
  '#.....M...b..T#',
  '#..L..........#',
  'D.....xx...o..G',
  '#.~~..........#',
  '#.~~~....b...T#',
  '#T.~~.......bb#',
  '###############',
];
const BOSS_MAP = [
  '#######G#######',
  '#T...........T#',
  '#.............#',
  '#..b.......b..#',
  '#.............#',
  '#.............#',
  '#..x.......x..#',
  '#T...........T#',
  '###############',
];

const LOOK: Record<string, string> = { T: 'tree', b: 'bush', '~': 'pond', x: 'thorn bush', L: 'rolling log', M: 'mirror stone', o: 'puffball' };
/** The same map letters in the caves, and each cave sub-theme's own looks laid over them. */
const CAVE_LOOK: Record<string, string> = { T: 'stalagmite', b: 'loose rock', '~': 'chasm', x: 'thorn vine', L: 'boulder', M: 'crystal cluster', o: 'glowshroom' };
const GROTTO_LOOK = { ...CAVE_LOOK, T: 'crystal spire' };
const HOLLOW_LOOK = { ...CAVE_LOOK, T: 'giant mushroom', b: 'mushroom cap' };
const RIFT_LOOK = { ...CAVE_LOOK, '~': 'rift' };

interface Actor {
  kind: string;
  x: number;
  y: number;
  action: Action;
  frame: number;
  view?: View;
  flip?: boolean;
  champion?: boolean;
  /** Drawn at this size against its art (a smaller slime). */
  scale?: number;
}

interface Light {
  x: number;
  y: number;
  r: number;
  warm?: boolean;
}

interface Scene {
  map: string[];
  floor: 'normal' | 'item' | 'boss';
  actors: Actor[];
  shots: { kind: ShotArt; x: number; y: number }[];
  seed: number;
  /** The room shell it is drawn with (the forest's unless named) and its wall style. */
  shell?: Shell;
  wallStyle?: WallStyle;
  /** The dressing scattered over its floor; the forest's unless named. */
  decor?: string[];
  /** What each map letter is drawn as; the forest's unless named. */
  looks?: Record<string, string>;
}

const at = (gx: number, gy: number) => ({ x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE });

function drawRoom(sheet: Sheet, scene: Scene, lit: boolean, id: string): string {
  const { map } = scene;
  const shell = scene.shell ?? 'forest';
  const wallStyle = scene.wallStyle ?? WALL_STYLES[shell][0];
  const rng = createRng(scene.seed);
  // Each cell's variant, drawn in turn from one stream as the game's dressing does.
  const cellRng = createRng(scene.seed + 1);
  const cell = (x: number, y: number) => map[y]?.[x] ?? '#';
  const ground: string[] = [];
  const flat: string[] = [];
  const standing: Placed[] = [];
  const place = (svg: string, w: number, h: number, ax: number, ay: number, x: number, y: number, flip = false) => {
    const use = `<use href="#${sheet.id(svg, w, h)}" x="${x - ax}" y="${y - ay}"/>`;
    return flip ? `<g transform="translate(${2 * x} 0) scale(-1 1)">${use}</g>` : use;
  };
  const tile = (svg: string, x: number, y: number) => place(svg, TILE_CANVAS.w, TILE_CANVAS.h, TILE_CANVAS.anchor.x, TILE_CANVAS.anchor.y, x, y);

  map.forEach((row, gy) =>
    [...row].forEach((ch, gx) => {
      const c = at(gx, gy);
      // The caves pick each tile's look at random, as the game does; the forest keeps its old pattern.
      const variant = shell === 'caves' ? cellRng.int(0, 3) : (gx * 7 + gy * 13) % 4;
      if (ch === '#') {
        const side: WallSide =
          (gx === 0 || gx === row.length - 1) && (gy === 0 || gy === map.length - 1) ? 'corner'
          : gy === 0 ? 'top' : gy === map.length - 1 ? 'bottom' : gx === 0 ? 'left' : 'right';
        const wc = wallCanvas(wallStyle);
        // Walls stand at the edge of the view: the top one first, the bottom one over everything.
        standing.push({
          y: gy === 0 ? -100 : gy === map.length - 1 ? 9999 : c.y + 14,
          svg: place(terrainSvg.wall(side, variant, wallStyle), wc.w, wc.h, wc.anchor.x, wc.anchor.y, c.x, c.y),
        });
        return;
      }
      const fc = floorCanvas(shell);
      if (hasGround(shell)) ground.push(tile(terrainSvg.ground(scene.floor), c.x, c.y));
      flat.push(place(terrainSvg.floor(scene.floor, floorLook(shell, variant, gx, gy), shell), fc.w, fc.h, fc.anchor.x, fc.anchor.y, c.x, c.y));
      if (ch === 'D' || ch === 'G') {
        const side = gy === 0 ? 'top' : gy === map.length - 1 ? 'bottom' : gx === 0 ? 'left' : 'right';
        standing.push({ y: gy === 0 ? -50 : c.y + TILE / 2, svg: tile(terrainSvg.door(side, ch === 'G', shell), c.x, c.y) });
        return;
      }
      const look = (scene.looks ?? LOOK)[ch];
      if (!look) return;
      const same = (dx: number, dy: number) => cell(gx + dx, gy + dy) === ch;
      const mask: Mask = (same(0, -1) ? UP : 0) | (same(1, 0) ? RIGHT : 0) | (same(0, 1) ? DOWN : 0) | (same(-1, 0) ? LEFT : 0);
      const svg = tile(terrainSvg.tile(look, variant, mask), c.x, c.y);
      if (MASKED_LOOKS.includes(look)) flat.push(svg);
      else standing.push({ y: c.y, svg });
      // Neighbouring trees and thorns (stalagmites, vines) grow into each other across the seam.
      if (JOIN_LOOKS.includes(look)) {
        if (same(1, 0)) standing.push({ y: c.y + 0.1, svg: tile(terrainSvg.join(look, 'across'), c.x + TILE / 2, c.y) });
        if (same(0, 1)) standing.push({ y: c.y + TILE / 2, svg: tile(terrainSvg.join(look, 'down'), c.x, c.y + TILE / 2) });
      }
    }),
  );

  // Dressing: generous, on about a third of the open floor.
  const kinds = scene.decor ?? (scene.floor === 'boss' ? ['leaves', 'pebbles', 'grass'] : ['grass', 'leaves', 'pebbles', 'grass', 'leaves', 'thornLitter', 'lilypad']);
  map.forEach((row, gy) =>
    [...row].forEach((ch, gx) => {
      if (ch !== '.' || rng.next() > 0.36) return;
      const c = at(gx, gy);
      const kind = rng.pick(kinds);
      if (kind === 'lilypad' && !map[gy][gx - 1]?.includes('~') && !map[gy][gx + 1]?.includes('~')) return;
      const svg = terrainSvg.decor(kind, rng.int(0, 3));
      const spread = shell === 'caves' ? 20 : 12;
      flat.push(place(svg, DECOR_CANVAS.w, DECOR_CANVAS.h, DECOR_CANVAS.anchor.x, DECOR_CANVAS.anchor.y, c.x + rng.int(-spread, spread), c.y + rng.int(-spread, spread)));
    }),
  );

  for (const a of scene.actors) {
    const art = CHARACTERS[a.kind];
    const svg = art.draw(a.action, a.frame, a.view ?? art.views[0], !!a.champion);
    const placed = place(svg, art.w, art.h, art.anchor.x, art.anchor.y, a.x, a.y, a.flip);
    standing.push({ y: a.y, svg: a.scale ? `<g transform="translate(${a.x} ${a.y}) scale(${a.scale}) translate(${-a.x} ${-a.y})">${placed}</g>` : placed });
  }
  standing.sort((a, b) => a.y - b.y);

  const shots = scene.shots
    .map((s) => {
      const svg = hudSvg.shot(s.kind, SHOT_ART[s.kind]);
      return `<circle cx="${s.x}" cy="${s.y}" r="18" fill="url(#${id}-glow-${s.kind})"/>` + place(svg, SHOT_CANVAS, SHOT_CANVAS, SHOT_CANVAS / 2, SHOT_CANVAS / 2, s.x, s.y);
    })
    .join('');

  const W = map[0].length * TILE;
  const Hh = map.length * TILE;
  const lights: Light[] = [
    ...scene.actors.filter((a) => a.kind === 'player').map((a) => ({ x: a.x, y: a.y - 14, r: 150, warm: true })),
    ...scene.shots.map((s) => ({ x: s.x, y: s.y, r: s.kind === 'player' ? 48 : 40 })),
    ...map.flatMap((row, gy) => [...row].flatMap((ch, gx) => (ch === 'o' ? [{ ...at(gx, gy), r: 84, warm: true }] : []))),
  ];
  const holes = lights.map((l) => `<circle cx="${l.x}" cy="${l.y}" r="${l.r}" fill="url(#${id}-hole)" style="mix-blend-mode:multiply"/>`).join('');
  const warmth = lights
    .filter((l) => l.warm)
    .map((l) => `<circle cx="${l.x}" cy="${l.y}" r="${l.r * 0.9}" fill="url(#${id}-warm)" style="mix-blend-mode:soft-light"/>`)
    .join('');
  const defs =
    `<radialGradient id="${id}-hole"><stop offset="0" stop-color="#000"/><stop offset="0.45" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>` +
    `<radialGradient id="${id}-warm"><stop offset="0" stop-color="${PAPER.warmLight}" stop-opacity="0.9"/><stop offset="1" stop-color="${PAPER.warmLight}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}-vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></radialGradient>` +
    ([['player', PAPER.shot], ['enemy', PAPER.enemyShot], ['shard', PAPER.enemyShot]] as const)
      .map(([k, c]) => `<radialGradient id="${id}-glow-${k}"><stop offset="0" stop-color="${c}" stop-opacity="0.75"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`)
      .join('') +
    `<mask id="${id}-dark" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${Hh}"><rect width="${W}" height="${Hh}" fill="#fff"/>${holes}</mask>`;
  const dark = lit
    ? `<rect width="${W}" height="${Hh}" fill="#04070a" opacity="0.62" mask="url(#${id}-dark)"/>${warmth}<rect width="${W}" height="${Hh}" fill="url(#${id}-vignette)"/>`
    : '';
  return `<defs>${defs}</defs><rect width="${W}" height="${Hh}" fill="${shell === 'caves' ? PAPER.caves.rockDeep : PAPER.hedgeDark}"/>${ground.join('')}${flat.join('')}${standing.map((s) => s.svg).join('')}${dark}${shots}`;
}

function drawHud(sheet: Sheet, w: number): string {
  const hearts = (['full', 'full', 'half', 'empty'] as const)
    .map((level, i) => `<use href="#${sheet.id(hudSvg.heart(level), HEART_CANVAS, HEART_CANVAS)}" x="${10 + i * 24}" y="8"/>`)
    .join('');
  const text = (x: number, y: number, t: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" fill="${PAPER.cream}" font-family="'Alegreya SC', Georgia, serif" font-size="15" text-anchor="${anchor}" stroke="#0b0d0a" stroke-width="3" paint-order="stroke">${t}</text>`;
  const icons =
    `<use href="#${sheet.id(hudSvg.key(), ICON_CANVAS, ICON_CANVAS)}" x="10" y="38"/>` + text(38, 57, '× 1') +
    `<use href="#${sheet.id(hudSvg.bomb(), ICON_CANVAS, ICON_CANVAS)}" x="72" y="38"/>` + text(100, 57, '× 2');
  const mw = 150;
  const mh = 84;
  const mx = w - mw - 10;
  // The minimap as in the game: nothing behind it, bone rooms outlined in dark ink.
  const ink = '#14100c';
  const bone = '#d8ccb0';
  const cells = [
    { x: 0, y: 0, c: 'current' }, { x: -1, y: 0, c: 'visited' }, { x: 1, y: 0, c: 'visited' }, { x: 0, y: -1, c: 'glimpsed' },
    { x: 2, y: 0, c: 'item' }, { x: -1, y: 1, c: 'glimpsed' }, { x: 0, y: 1, c: 'boss' },
  ]
    .map((m) => {
      const x = mx + mw / 2 - 8 + m.x * 18;
      const y = 10 + mh / 2 - 5 + m.y * 12;
      const shape = m.c === 'glimpsed'
        ? `<rect x="${x + 0.5}" y="${y + 0.5}" width="15" height="9" fill="${ink}" fill-opacity="0.55" stroke="${bone}" stroke-width="1"/>`
        : `<rect x="${x + 1}" y="${y + 1}" width="14" height="8" fill="${m.c === 'current' ? '#f6f0e2' : bone}" stroke="${ink}" stroke-width="2"/>`;
      const symbol = m.c === 'item' ? PAPER.key : m.c === 'boss' ? PAPER.heart : undefined;
      const dot = symbol ? `<circle cx="${x + 8}" cy="${y + 5}" r="4.5" fill="${symbol}" stroke="${ink}" stroke-width="1.5"/>` : '';
      return shape + dot;
    })
    .join('');
  return hearts + icons + cells + text(w - 10, 120, 'FLOOR 1', 'end');
}

function roomSvg(sheet: Sheet, scene: Scene, lit: boolean, id: string, hud: boolean): string {
  const w = scene.map[0].length * TILE;
  const h = scene.map.length * TILE;
  return `<svg class="room" viewBox="0 0 ${w} ${h}" role="img" aria-label="Papercut ${scene.shell ?? 'forest'} room">${drawRoom(sheet, scene, lit, id)}${hud ? drawHud(sheet, w) : ''}</svg>`;
}

const FOREST: Scene = {
  map: MAP,
  floor: 'normal',
  seed: 11,
  actors: [
    { kind: 'player', x: 244, y: 236, action: 'attack', frame: 1, view: 'side' },
    { kind: 'goblin', x: 468, y: 196, action: 'move', frame: 1, flip: true },
    { kind: 'goblin', x: 440, y: 318, action: 'move', frame: 3, flip: true, champion: true },
    { kind: 'seedSpitter', x: 612, y: 238, action: 'attack', frame: 2 },
    { kind: 'wasp', x: 164, y: 132, action: 'move', frame: 0 },
    { kind: 'wasp', x: 206, y: 104, action: 'move', frame: 1, flip: true },
    { kind: 'boar', x: 300, y: 372, action: 'move', frame: 2 },
  ],
  shots: [
    { kind: 'player', x: 306, y: 226 },
    { kind: 'player', x: 382, y: 220 },
    { kind: 'enemy', x: 560, y: 214 },
    { kind: 'enemy', x: 548, y: 244 },
    { kind: 'enemy', x: 562, y: 272 },
  ],
};

const BOSS: Scene = {
  map: BOSS_MAP,
  floor: 'boss',
  seed: 5,
  actors: [
    { kind: 'treantBoss', x: 360, y: 196, action: 'attack', frame: 0 },
    { kind: 'player', x: 318, y: 356, action: 'move', frame: 1, view: 'up' },
  ],
  shots: [
    { kind: 'player', x: 320, y: 300 },
    { kind: 'player', x: 324, y: 250 },
  ],
};

/** A cave room: stalagmites fused along the walls, a chasm, a thorn-vine patch, a boulder, crystal and glowshrooms. */
const CAVE_MAP = [
  '#######D#######',
  '#TT....b....TT#',
  '#T....M...b..T#',
  '#..L..........#',
  'D.....xx...o..G',
  '#.~~.....xx...#',
  '#.~~~....b...T#',
  '#T.~~..o....bb#',
  '###############',
];
/** A crystal grotto: spires, and crystal enough (3 or more) for veined walls. */
const GROTTO_MAP = [
  '#######D#######',
  '#T..M.......TT#',
  '#.....b...M...#',
  '#..T..........#',
  'D......MM.....#',
  '#.............#',
  '#.~~.....b..T.#',
  '#T.~.........M#',
  '###############',
];
/** A mushroom hollow: giant mushrooms, clumps of caps, glowshrooms everywhere. */
const HOLLOW_MAP = [
  '#######D#######',
  '#T..o.....b.TT#',
  '#..b....o.....#',
  '#.....T.......#',
  'D..o......bb..#',
  '#.......o.....#',
  '#.bb.......o.T#',
  '#TT..o...b...T#',
  '###############',
];
/** A rift: a long torn chasm across the room. */
const RIFT_MAP = [
  '#######D#######',
  '#T..b.......TT#',
  '#.....~~......#',
  '#......~~~....#',
  'D.......~~....#',
  '#..~~....~....#',
  '#..~~~......b.#',
  '#T.........bbT#',
  '###############',
];

/** A sub-theme's decor kinds, as the game scatters them. */
const decorOf = (theme: string) => roomThemeById(theme)!.decor.map((d) => d.id);

/** The caves' rooms: their terrain and decor in paper; the cave cast comes in later passes. */
const CAVE: Scene = {
  map: CAVE_MAP,
  floor: 'normal',
  seed: 23,
  shell: 'caves',
  wallStyle: 'strata',
  decor: decorOf('rift'),
  looks: CAVE_LOOK,
  actors: [
    { kind: 'player', x: 330, y: 250, action: 'idle', frame: 0 },
    { kind: 'ghoul', x: 440, y: 236, action: 'attack', frame: 0, flip: true },
    { kind: 'ghoul', x: 290, y: 350, action: 'move', frame: 1, champion: true },
    { kind: 'bat', x: 380, y: 130, action: 'move', frame: 0 },
    { kind: 'bat', x: 520, y: 150, action: 'attack', frame: 0, flip: true },
    { kind: 'bat', x: 150, y: 215, action: 'attack', frame: 1 },
    { kind: 'geode', x: 600, y: 182, action: 'attack', frame: 2 },
    { kind: 'geode', x: 264, y: 86, action: 'idle', frame: 0, champion: true },
    { kind: 'slime', x: 396, y: 330, action: 'attack', frame: 2 },
    { kind: 'slime', x: 456, y: 292, action: 'move', frame: 2, flip: true, scale: 23 / 32 },
    { kind: 'slime', x: 520, y: 354, action: 'land', frame: 0, scale: 15 / 32, champion: true },
  ],
  shots: [
    { kind: 'shard', x: 520, y: 202 },
    { kind: 'shard', x: 668, y: 236 },
  ],
};

/** The sub-theme rooms show off their terrain: just the player in them. */
const ALONE: Actor[] = [{ kind: 'player', x: 330, y: 250, action: 'idle', frame: 0 }];
const CAVE_GROTTO: Scene = { ...CAVE, actors: ALONE, seed: 29, wallStyle: 'veined', map: GROTTO_MAP, looks: GROTTO_LOOK, decor: decorOf('grotto') };
const CAVE_HOLLOW: Scene = { ...CAVE, actors: ALONE, seed: 37, map: HOLLOW_MAP, looks: HOLLOW_LOOK, decor: decorOf('hollow') };
/**
 * A worm crawling along cells `cells` (head first), each piece where the game would put it: on its
 * cell's centre (its feet 10 px below), facing the way it crawls, its crawl rippling down from the head.
 * The worm boss (`boss`) is drawn in its own pieces, at its bigger size; `pose` holds one of its segments in another pose.
 */
function worm(cells: [number, number][], champion = false, boss = false, pose?: { segment: number; action: Action; frame: number }): Actor[] {
  const face = (from: [number, number], to: [number, number]) => {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    return dx ? { view: 'side' as const, flip: dx < 0 } : { view: dy > 0 ? ('down' as const) : ('up' as const), flip: false };
  };
  const scale = boss ? BOSS_SCALE : champion ? 1.35 : undefined;
  return cells.map((cell, i) => ({
    kind: `${boss ? 'wormBoss' : 'worm'}${i === 0 ? 'Head' : i === cells.length - 1 ? 'Tail' : 'Body'}`,
    x: cell[0] * TILE + TILE / 2,
    y: cell[1] * TILE + TILE / 2 + 10 * (scale ?? 1),
    ...(pose?.segment === i ? { action: pose.action, frame: pose.frame } : { action: 'move' as const, frame: (4 - (i % 4)) % 4 }),
    // Each piece faces the way it got to its cell: from the one behind it (the head, its tail, the way it heads).
    ...(i < cells.length - 1 ? face(cells[i + 1], cell) : face(cell, cells[i - 1])),
    champion,
    scale,
  }));
}

/** The worm boss's segments against the worm's (core/config): its art is the worm's, grown to fit. */
const BOSS_SCALE = 38 / 30;

const CAVE_RIFT: Scene = {
  ...CAVE,
  seed: 41,
  map: RIFT_MAP,
  looks: RIFT_LOOK,
  actors: [
    { kind: 'player', x: 250, y: 200, action: 'idle', frame: 0 },
    // One crawling the length of the room and turning down it, a champion heading off the other way.
    ...worm([[12, 5], [12, 4], [12, 3], [12, 2], [11, 2], [10, 2]]),
    ...worm([[3, 7], [4, 7], [5, 7], [6, 7]], true),
  ],
};
const CAVE_BOSS: Scene = {
  ...CAVE,
  map: BOSS_MAP.map((row) => row.replace(/[Tbx]/g, '.')),
  floor: 'boss',
  seed: 31,
  decor: ['bones', 'shards', 'bones', 'cracks', 'pebbles', 'pick'],
  actors: [
    { kind: 'player', x: 344, y: 330, action: 'idle', frame: 0, view: 'up' },
    // The worm boss crawling round the room, heaving an egg out of its back; one egg in the air, one resting, one about to hatch.
    ...worm([[4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [10, 4], [10, 5], [11, 5], [12, 5]], false, true, { segment: 5, action: 'lob', frame: 0 }),
    { kind: 'wormEgg', x: 9 * TILE, y: 2 * TILE, action: 'move', frame: 1 },
    { kind: 'wormEgg', x: 2.5 * TILE, y: 6.5 * TILE + 13, action: 'idle', frame: 0 },
    { kind: 'wormEgg', x: 12.5 * TILE, y: 1.5 * TILE + 13, action: 'attack', frame: 2 },
  ],
};

const img = (svg: string, w: number, h: number, scale: number, flip = false, alt = '') =>
  `<img src="${uri(svg)}" width="${w * scale}" height="${h * scale}" alt="${alt}"${flip ? ' style="transform:scaleX(-1)"' : ''}>`;

const NAMES: Record<string, string> = { player: 'Player', goblin: 'Goblin', seedSpitter: 'Seed spitter', boar: 'Boar', wasp: 'Wasp', treantBoss: 'Treant', ghoul: 'Ghoul', bat: 'Bat', slime: 'Slime', geode: 'Geode', wormHead: 'Worm head', wormBody: 'Worm body', wormTail: 'Worm tail', wormBossHead: 'Worm boss head', wormBossBody: 'Worm boss body', wormBossTail: 'Worm boss tail', wormEgg: 'Worm egg' };
/** What each cave pose is, for the strips' headings. */
const POSE_NAMES: Record<string, Partial<Record<Action, string>>> = {
  ghoul: { move: 'stalk', attack: 'wind-up, lunge' },
  bat: { idle: 'flutter in place', move: 'flutter', attack: 'telegraph, swoop' },
  slime: { idle: 'rest', move: 'hop: take-off, rise, top, drop', attack: 'squash', land: 'splat, settle' },
  geode: { idle: 'shut', move: 'shut (it never moves)', attack: 'crack, split open, fire' },
  wormHead: { move: 'crawl', attack: 'rear, maw splayed (for the boss)' },
  wormBody: { move: 'crawl', attack: 'rear, crystals flaring (for the boss)' },
  wormTail: { move: 'crawl', attack: 'rear (for the boss)' },
  wormBossHead: { move: 'crawl', attack: 'roar: maw splayed, crystals flaring', spit: 'maw pulsing', charge: 'head tucked, shards forward', burrow: 'diving in, climbing out', lob: 'heave, let go', split: 'torn open on its crystal core', die: 'cracking, bursting' },
  wormBossBody: { move: 'crawl', attack: 'roar: crystals flaring', spit: 'ready, firing', charge: 'shards forward', burrow: 'diving in, climbing out', lob: 'heave, let go', split: 'torn open', die: 'cracking, bursting' },
  wormBossTail: { move: 'crawl', attack: 'roar', spit: 'ready, firing', charge: 'shards forward', burrow: 'diving in, climbing out', lob: 'heave, let go', split: 'torn open on its crystal core', die: 'cracking, bursting' },
  wormEgg: { idle: 'resting', move: 'tumbling through the air', attack: 'wobbling: hairline, spreading, splitting' },
};

/** Every frame of `kinds`' art, view by view, then their champions' gold-trimmed frames. */
function frameStrips(kinds: string[], champs: string[]): string {
  const rows: string[] = [];
  const names = NAMES;
  for (const kind of kinds) {
    const art = CHARACTERS[kind];
    const scale = kind === 'treantBoss' ? 1 : 2;
    for (const view of art.views) {
      const cells = (Object.entries(art.actions) as [Action, number][])
        .map(([action, count]) => {
          const frames = Array.from({ length: count }, (_, f) =>
            `<figure>${img(art.draw(action, f, view, false), art.w, art.h, scale, false, `${names[kind]} ${action} frame ${f + 1}`)}<figcaption>${f + 1}</figcaption></figure>`,
          ).join('');
          const what = POSE_NAMES[kind]?.[action];
          return `<div class="action"><h4>${what ? `${action} (${what})` : action} <span>${count}</span></h4><div class="frames">${frames}</div></div>`;
        })
        .join('');
      const label = art.views.length > 1 ? `${names[kind]} <span>facing ${view === 'side' ? 'right (left is mirrored)' : view}</span>` : names[kind];
      rows.push(`<section class="strip"><h3>${label}</h3><div class="actions">${cells}</div></section>`);
    }
  }
  if (!champs.length) return rows.join('');
  const champFigs = champs
    .map((k) => `<figure>${img(CHARACTERS[k].draw('idle', 0, CHARACTERS[k].views[0], true), CHARACTERS[k].w, CHARACTERS[k].h, 2, false, `Champion ${names[k]}`)}<figcaption>${names[k]}</figcaption></figure>`)
    .join('');
  rows.push(`<section class="strip"><h3>Champions <span>gold paper trim</span></h3><div class="frames">${champFigs}</div></section>`);
  return rows.join('');
}

function pieceSheet(): string {
  const tiles = [
    ['tree', 0, 0], ['tree', 1, RIGHT], ['oak', 2, 0], ['willow', 3, 0], ['bush', 0, 0], ['reed clump', 1, 0], ['bramble bush', 2, 0],
    ['thorn bush', 0, 0], ['thorn bush', 1, LEFT | RIGHT], ['rolling log', 0, 0], ['mirror stone', 0, 0], ['puffball', 0, 0],
    ['pond', 0, 0], ['pond', 1, RIGHT | DOWN], ['pond', 3, UP | LEFT | RIGHT | DOWN], ['bog', 1, 0],
  ] as const;
  const tileFigs = tiles
    .map(([look, v, m]) => `<figure>${img(terrainSvg.tile(look, v, m), TILE_CANVAS.w, TILE_CANVAS.h, 1.5, false, look)}<figcaption>${look}${m ? ' (joined)' : ''}</figcaption></figure>`)
    .join('');
  const room = [
    [terrainSvg.wall('top', 0), 'hedge, top wall'], [terrainSvg.wall('left', 1), 'hedge, side'], [terrainSvg.door('top', false), 'door'],
    [terrainSvg.door('top', true), 'locked door'], [terrainSvg.door('left', false), 'side door'], [terrainSvg.floor('normal', 0), 'floor'],
    [terrainSvg.floor('item', 0), 'item room floor'], [terrainSvg.floor('boss', 0), 'boss room floor'],
  ]
    .map(([svg, label]) => `<figure>${img(svg, TILE_CANVAS.w, TILE_CANVAS.h, 1.5, false, label)}<figcaption>${label}</figcaption></figure>`)
    .join('');
  const decor = ['grass', 'leaves', 'flowers', 'pebbles', 'puddle', 'reeds', 'lilypad', 'thornLitter', 'berries']
    .map((k) => `<figure>${img(terrainSvg.decor(k, 1), DECOR_CANVAS.w, DECOR_CANVAS.h, 2.5, false, k)}<figcaption>${k}</figcaption></figure>`)
    .join('');
  const hud = [
    [hudSvg.heart('full'), HEART_CANVAS, 'heart'], [hudSvg.heart('half'), HEART_CANVAS, 'half heart'], [hudSvg.heart('empty'), HEART_CANVAS, 'container'],
    [hudSvg.key(), ICON_CANVAS, 'key'], [hudSvg.bomb(), ICON_CANVAS, 'bomb'], [hudSvg.shot('player', 7), SHOT_CANVAS, 'player shot'], [hudSvg.shot('enemy', 6), SHOT_CANVAS, 'enemy seed'],
  ]
    .map(([svg, s, label]) => `<figure>${img(svg as string, s as number, s as number, 2.5, false, label as string)}<figcaption>${label}</figcaption></figure>`)
    .join('');
  return `<section class="strip"><h3>Terrain tiles</h3><div class="frames">${tileFigs}</div></section>` +
    `<section class="strip"><h3>Walls, doors, floors</h3><div class="frames">${room}</div></section>` +
    `<section class="strip"><h3>Dressing</h3><div class="frames">${decor}</div></section>` +
    `<section class="strip"><h3>HUD and shots</h3><div class="frames">${hud}</div></section>`;
}

/** Every piece of the caves' room shell: walls in both styles, doors, floors. */
function caveShellSheet(): string {
  const fig = (svg: string, label: string) => `<figure>${img(svg, TILE_CANVAS.w, TILE_CANVAS.h, 1.5, false, label)}<figcaption>${label}</figcaption></figure>`;
  const sides: WallSide[] = ['top', 'bottom', 'left', 'right', 'corner'];
  const variants = [0, 1, 2, 3];
  const walls = WALL_STYLES.caves.map((style) => {
    const figs = sides
      .flatMap((side) => variants.map((v) => `<figure>${img(terrainSvg.wall(side, v, style), CAVE_WALL_CANVAS.w, CAVE_WALL_CANVAS.h, 1.2, false, `${side} ${v + 1}`)}<figcaption>${side} ${v + 1}</figcaption></figure>`))
      .join('');
    const name = style === 'strata' ? 'Rock-strata walls <span>free-form crags spilling past their tile; the top wall a ragged strata cliff with stalactites</span>' : 'Crystal-veined walls <span>rooms with 3 or more crystal tiles: one seam runs the length of each wall, clusters breaking out of it</span>';
    return `<section class="strip"><h3>${name}</h3><div class="frames">${figs}</div></section>`;
  });
  const doors = (['top', 'bottom', 'left', 'right'] as const)
    .flatMap((side) => [false, true].map((locked) => fig(terrainSvg.door(side, locked, 'caves'), `${side}${locked ? ', locked' : ''}`)))
    .join('');
  // Each floor piece on its ground, the dashed square its own tile: its marks reach well past it.
  const FC = CAVE_FLOOR_CANVAS;
  /** `cols`×`rows` tiles of paper ground, the first's top-left corner at x,y. */
  const groundUnder = (kind: 'normal' | 'item' | 'boss', cols: number, rows: number, x: number, y: number) => {
    const href = uri(terrainSvg.ground(kind));
    return Array.from({ length: rows }, (_, gy) => Array.from({ length: cols }, (_, gx) =>
      `<image href="${href}" width="${TILE_CANVAS.w}" height="${TILE_CANVAS.h}" x="${x + gx * TILE + TILE / 2 - TILE_CANVAS.anchor.x}" y="${y + gy * TILE + TILE / 2 - TILE_CANVAS.anchor.y}"/>`,
    ).join('')).join('');
  };
  const floors = (['normal', 'item', 'boss'] as const)
    .flatMap((kind) => Array.from({ length: floorLooks('caves') }, (_, v) => v).map((v) => {
      const tileBox = `<rect x="${FC.anchor.x - TILE / 2}" y="${FC.anchor.y - TILE / 2}" width="${TILE}" height="${TILE}" fill="none" stroke="#e8dcc0" stroke-opacity="0.35" stroke-dasharray="3 3"/>`;
      return `<figure><svg width="${FC.w * 0.75}" height="${FC.h * 0.75}" viewBox="0 0 ${FC.w} ${FC.h}" role="img" aria-label="${kind} floor ${v + 1}">${groundUnder(kind, 3, 3, FC.anchor.x - TILE * 1.5, FC.anchor.y - TILE * 1.5)}<image href="${uri(terrainSvg.floor(kind, v, 'caves'))}" width="${FC.w}" height="${FC.h}"/>${tileBox}</svg><figcaption>${kind} ${v + 1}</figcaption></figure>`;
    }))
    .join('');
  // A 6×4 stretch of each floor, variants picked at random, to judge whether the grid shows.
  const patch = (kind: 'normal' | 'item' | 'boss') => {
    const [cols, rows] = [6, 4];
    const cellRng = createRng(kind.length);
    const cells = Array.from({ length: rows }, (_, gy) => Array.from({ length: cols }, (_, gx) => {
      const svg = terrainSvg.floor(kind, floorLook('caves', cellRng.int(0, 3), gx, gy), 'caves');
      return `<image href="${uri(svg)}" width="${FC.w}" height="${FC.h}" x="${gx * TILE + TILE / 2 - FC.anchor.x}" y="${gy * TILE + TILE / 2 - FC.anchor.y}"/>`;
    }).join('')).join('');
    const [w, h] = [TILE * cols, TILE * rows];
    return `<figure><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${kind} floor, laid out">${groundUnder(kind, cols, rows, 0, 0)}${cells}</svg><figcaption>${kind}, laid out</figcaption></figure>`;
  };
  return walls.join('') +
    `<section class="strip"><h3>Mine-prop doorways <span>timber props and lintel; locked ones barred by a rusted iron grate</span></h3><div class="frames">${doors}</div></section>` +
    `<section class="strip"><h3>Earth floors <span>see-through marks spilling past their tile (dashed) · normal: slabs, long cracks, grit · item: broken shrine paving · boss: gouges and burrows</span></h3><div class="frames">${floors}</div></section>` +
    `<section class="strip"><h3>Floors laid out <span>variants at random: no grid to be seen</span></h3><div class="frames">${patch('normal')}${patch('item')}${patch('boss')}</div></section>`;
}

/** Every caves terrain piece: each look's variants, chasm and rift pieces for every neighbour mask, and the joins. */
function caveTerrainSheet(): string {
  const fig = (svg: string, label: string) => `<figure>${img(svg, TILE_CANVAS.w, TILE_CANVAS.h, 1.5, false, label)}<figcaption>${label}</figcaption></figure>`;
  const strip = (title: string, figs: string) => `<section class="strip"><h3>${title}</h3><div class="frames">${figs}</div></section>`;
  const variants = [0, 1, 2, 3];
  const looks: [string, string][] = [
    ['stalagmite', 'Stalagmites'], ['loose rock', 'Loose rock <span>breakable</span>'], ['thorn vine', 'Thorn vines <span>hurt on touch</span>'],
    ['boulder', 'Boulders <span>the crusher</span>'], ['crystal cluster', 'Crystal clusters <span>reflect shots; quartz prisms fanned from one root, half buried in a crust of rock and earth, cracks running into the floor</span>'], ['glowshroom', 'Glowshrooms <span>stun burst</span>'],
    ['crystal spire', 'Crystal spires <span>crystal grotto; prisms studding the rock, a rooted cluster at the foot</span>'], ['giant mushroom', 'Giant mushrooms <span>mushroom hollow</span>'], ['mushroom cap', 'Mushroom caps <span>mushroom hollow, breakable</span>'],
  ];
  const tiles = looks.map(([look, title]) => strip(title, variants.map((v) => fig(terrainSvg.tile(look, v, 0), `${look} ${v + 1}`)).join('')));
  const joins = strip('Joins <span>neighbouring stalagmites fuse, thorn vines reach into each other</span>',
    ['stalagmite', 'thorn vine'].flatMap((look) => (['across', 'down'] as const).map((d) => fig(terrainSvg.join(look, d), `${look}, ${d}`))).join(''));
  const maskName = (m: number) => [[UP, 'up'], [RIGHT, 'right'], [DOWN, 'down'], [LEFT, 'left']].filter(([bit]) => m & (bit as number)).map(([, name]) => name).join('+') || 'alone';
  const masked = (['chasm', 'rift'] as const).map((look) =>
    strip(`${look === 'chasm' ? 'Chasm' : 'Rift <span>rift sub-theme</span>'} <span>a piece for every neighbour mask (named: where it carries on)</span>`,
      Array.from({ length: 16 }, (_, m) => fig(terrainSvg.tile(look, m % 4, m), maskName(m))).join('')));
  return tiles.join('') + joins + masked.join('');
}

/** Every caves decor kind the sub-themes scatter, every variant. */
function caveDecorSheet(): string {
  const kinds = [...new Set(roomThemesFor(1).flatMap((t) => t.decor.map((d) => d.id)))];
  const figs = kinds
    .flatMap((k) => [0, 1, 2, 3].map((v) => `<figure>${img(terrainSvg.decor(k, v), DECOR_CANVAS.w, DECOR_CANVAS.h, 2.5, false, `${k} ${v + 1}`)}<figcaption>${k} ${v + 1}</figcaption></figure>`))
    .join('');
  const themes = roomThemesFor(1).map((t) => `${t.name}: ${t.decor.map((d) => d.id).join(', ')}`).join(' · ');
  return `<section class="strip"><h3>Dressing <span>${themes}</span></h3><div class="frames">${figs}</div></section>`;
}

function cavesSheet(): string {
  const lit = new Sheet('c');
  const caveLit = roomSvg(lit, CAVE, true, 'c', false);
  const unlit = new Sheet('cu');
  const caveUnlit = roomSvg(unlit, CAVE, false, 'cu', false);
  const grotto = new Sheet('cg');
  const grottoUnlit = roomSvg(grotto, CAVE_GROTTO, false, 'cg', false);
  const hollow = new Sheet('ch');
  const hollowUnlit = roomSvg(hollow, CAVE_HOLLOW, false, 'ch', false);
  const rift = new Sheet('cr');
  const riftUnlit = roomSvg(rift, CAVE_RIFT, false, 'cr', false);
  const boss = new Sheet('cb');
  const bossUnlit = roomSvg(boss, CAVE_BOSS, false, 'cb', false);
  const defs = (s: Sheet) => `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${s.defs.join('')}</defs></svg>`;
  return `
<div class="caves">
<header class="masthead">
  <p class="eyebrow">Floor 2 · room shell and terrain</p>
  <h1>Papercut Caves</h1>
  <p class="lede">Warm earth, cold light: umber and ochre rock paper, icy cyan-white crystal as the hard accent, violet fungus as the second hue, and deep-teal slime, soft and translucent round a milky core. This sheet covers the room shell (walls, doors, floors), every cave terrain tile and the decor, bones and a dropped miner's pick among it, and the cave cast: the ghoul, the bat, the slime, the geode, the worm, and the worm boss with its eggs.</p>
</header>
${defs(lit)}${defs(unlit)}${defs(grotto)}${defs(hollow)}${defs(rift)}${defs(boss)}
<figure class="stage">${caveLit}<figcaption>A sample cave room, lit as in the game: stalagmites fused along the walls, a chasm, thorn vines, a boulder, a crystal cluster and glowshrooms; a ghoul winding up at the player (a champion stalking below), one bat hanging wings-wide for its tell, another swooping; a geode split open and firing red-hot shard shots (one already ricocheting off the wall), a champion geode shut above; a big slime squashed for its jump, a medium one in the air over a rock and a small champion splatting down. The right door is barred while enemies live.</figcaption></figure>
<div class="pair">
  <figure class="stage small">${caveUnlit}<figcaption>The same room with the lights on.</figcaption></figure>
  <figure class="stage small">${grottoUnlit}<figcaption>A crystal grotto: crystal spires, and crystal enough for veined walls all the way round.</figcaption></figure>
  <figure class="stage small">${hollowUnlit}<figcaption>A mushroom hollow: giant mushrooms, clumps of mushroom caps and glowshrooms.</figcaption></figure>
  <figure class="stage small">${riftUnlit}<figcaption>A rift: the chasm's lip torn red. A worm crawls along the top and turns down the room, its crawl rippling from head to tail; a champion heads off the other way below.</figcaption></figure>
  <figure class="stage small">${bossUnlit}<figcaption>The worm's room: darker earth broken by burrows, strewn with bones and shards. The worm boss crawls round it, heaving an egg out of its back; another egg is in the air, one rests by the wall and one is splitting open to hatch.</figcaption></figure>
</div>
<h2>The cave cast, frame by frame</h2>
<p class="note">The ghoul's wind-up (eyes flared cyan) is held for its whole tell, then the lunge frames play while it lunges; it loops recover while it catches its breath. The bat beats its wings at twice the usual frame rate, hangs with them spread wide for its tell, and holds the swoop frames while it swoops.</p>
<p class="note">The slime squashes ever lower through its tell, then plays its hop frame by frame through the jump and splats where it lands; the medium and small slimes are the same art, smaller. The geode cracks along its seam as its shot charges, splits open on its crystal core (held open while it waits for a clear shot) and flares as it fires. Its shard shots are crystal splinters with a red-hot core and a dark outline, tumbling as they fly: hostile like every enemy shot, and the only ones that ricochet.</p>
<p class="note">The worm is drawn piece by piece, each over its own segment's cell: a head, body pieces and a tail, armoured in dark chitin plates that lap toward the front, cyan crystal shards growing from the spine, and a lamprey maw ringed with bone teeth. Each piece faces the way it crawls (side on, toward the camera or away), so the chain bends round each turn as it gets there; the head points where the worm is heading. The crawl ripples from the head down to the tail, a frame behind segment by segment. Its rearing frames (the maw splayed wide, the crystals flaring) wait for the worm boss.</p>
${frameStrips(['ghoul', 'bat', 'slime', 'geode', 'wormHead', 'wormBody', 'wormTail'], ['ghoul', 'bat', 'slime', 'geode', 'wormHead', 'wormBody', 'wormTail'])}
<h2>The worm boss, acting out its fight</h2>
<p class="note">The worm boss is the worm grown huge, its crystals bigger still, drawn piece by piece like the worm, each pose held exactly as long as the moment of the fight it acts out. It crawls; it rears up and roars (the maw splayed, the crystals flaring) through the stop at its split and through its last stand's roar; its maw pulses as a spit wave runs down its body, each segment flaring as its shot leaves; it tucks its head and points its shards forward as it charges up and between lunges; it dives into the walls and climbs out of them; a segment heaves as it lobs an egg; at the split its torn ends show a raw crystal core; and a dying half cracks through, each segment's crystals blazing just before it bursts into crystal shards, tail to head along the death chain.</p>
<p class="note">Its eggs are pale, leathery pods flecked with crystal: tumbling through the air, resting where they land, then cracking ever wider as they wobble to hatch into a worm.</p>
${frameStrips(['wormBossHead', 'wormBossBody', 'wormBossTail', 'wormEgg'], [])}
<section class="strip"><h3>Shots <span>the geode's ricocheting shard shot, red-hot and outlined like the enemy shot beside it</span></h3><div class="frames"><figure>${img(hudSvg.shot('shard', SHOT_ART.shard), SHOT_CANVAS, SHOT_CANVAS, 2.5, false, 'shard shot')}<figcaption>shard shot (tumbles in flight)</figcaption></figure><figure>${img(hudSvg.shot('enemy', SHOT_ART.enemy), SHOT_CANVAS, SHOT_CANVAS, 2.5, false, 'enemy shot')}<figcaption>enemy shot</figcaption></figure></div></section>
<h2>Terrain</h2>
${caveTerrainSheet()}
<h2>Dressing</h2>
${caveDecorSheet()}
<h2>Room shell pieces</h2>
${caveShellSheet()}
</div>`;
}

export function buildMockup(): string {
  const forest = new Sheet('f');
  const forestLit = roomSvg(forest, FOREST, true, 'f', true);
  const boss = new Sheet('b');
  const bossLit = roomSvg(boss, BOSS, true, 'b', false);
  const unlit = new Sheet('u');
  const forestUnlit = roomSvg(unlit, FOREST, false, 'u', false);
  const defs = (s: Sheet) => `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${s.defs.join('')}</defs></svg>`;
  return `
<header class="masthead">
  <p class="eyebrow">Floor 1 · art direction for review</p>
  <h1>Papercut Forest</h1>
  <p class="lede">One forest room drawn entirely from the paper art library the game will bake its textures from. Every sprite is layered paper with a down-right shadow and faint grain, seen from a 3/4 angle, in a dark room lit by the player, the shots and the puffballs.</p>
</header>
${defs(forest)}${defs(boss)}${defs(unlit)}
<figure class="stage">${forestLit}<figcaption>A marsh-edge room mid-fight: the player shooting at two goblins (the lower one a champion), a seed spitter spitting, a boar and two wasps. The right door is locked while enemies live.</figcaption></figure>
<div class="pair">
  <figure class="stage small">${forestUnlit}<figcaption>The same room with the lights on, to judge the paper itself.</figcaption></figure>
  <figure class="stage small">${bossLit}<figcaption>The Treant's room, the Treant winding up an arm slam.</figcaption></figure>
</div>
<h2>Characters, frame by frame</h2>
<p class="note">Idle 2, move 4, attack 3, hurt 1, played at about 9 frames a second. On a hit the sprite also flashes white; that is done in the game, not drawn here.</p>
${frameStrips(['player', 'goblin', 'seedSpitter', 'boar', 'wasp', 'treantBoss'], ['goblin', 'seedSpitter', 'boar', 'wasp'])}
<h2>Pieces</h2>
<p class="note">Joined pieces show how neighbouring trees, thorns and pond tiles grow into each other.</p>
${pieceSheet()}
${cavesSheet()}`;
}

document.getElementById('page')!.innerHTML = buildMockup();
document.body.dataset.ready = '1';
