import { CHARACTERS, type Action, type View } from '../core/art/characters';
import { hudSvg, HEART_CANVAS, ICON_CANVAS, SHOT_CANVAS } from '../core/art/hud';
import { PAPER } from '../core/art/palette';
import { DECOR_CANVAS, DOWN, LEFT, RIGHT, TILE, TILE_CANVAS, UP, terrainSvg, type Mask, type WallSide } from '../core/art/terrain';
import { createRng } from '../core/rng';

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

interface Actor {
  kind: string;
  x: number;
  y: number;
  action: Action;
  frame: number;
  view?: View;
  flip?: boolean;
  champion?: boolean;
}

interface Light {
  x: number;
  y: number;
  r: number;
  warm?: boolean;
}

interface Scene {
  map: string[];
  floor: 'normal' | 'boss';
  actors: Actor[];
  shots: { kind: 'player' | 'enemy'; x: number; y: number }[];
  seed: number;
}

const at = (gx: number, gy: number) => ({ x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE });

function drawRoom(sheet: Sheet, scene: Scene, lit: boolean, id: string): string {
  const { map } = scene;
  const rng = createRng(scene.seed);
  const cell = (x: number, y: number) => map[y]?.[x] ?? '#';
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
      const variant = (gx * 7 + gy * 13) % 4;
      if (ch === '#') {
        const side: WallSide =
          (gx === 0 || gx === row.length - 1) && (gy === 0 || gy === map.length - 1) ? 'corner'
          : gy === 0 ? 'top' : gy === map.length - 1 ? 'bottom' : gx === 0 ? 'left' : 'right';
        // Walls stand at the edge of the view: the top one first, the bottom one over everything.
        standing.push({ y: gy === 0 ? -100 : gy === map.length - 1 ? 9999 : c.y, svg: tile(terrainSvg.wall(side, variant), c.x, c.y) });
        return;
      }
      flat.push(tile(terrainSvg.floor(scene.floor, variant), c.x, c.y));
      if (ch === 'D' || ch === 'G') {
        const side = gy === 0 ? 'top' : gy === map.length - 1 ? 'bottom' : gx === 0 ? 'left' : 'right';
        standing.push({ y: gy === 0 ? -50 : c.y, svg: tile(terrainSvg.door(side, ch === 'G'), c.x, c.y) });
        return;
      }
      const look = LOOK[ch];
      if (!look) return;
      const same = (dx: number, dy: number) => cell(gx + dx, gy + dy) === ch;
      const mask: Mask = (same(0, -1) ? UP : 0) | (same(1, 0) ? RIGHT : 0) | (same(0, 1) ? DOWN : 0) | (same(-1, 0) ? LEFT : 0);
      const svg = tile(terrainSvg.tile(look, variant, mask), c.x, c.y);
      if (look === 'pond') flat.push(svg);
      else standing.push({ y: c.y, svg });
    }),
  );

  // Dressing: generous, on about a third of the open floor.
  const kinds = scene.floor === 'boss' ? ['leaves', 'pebbles', 'grass'] : ['grass', 'leaves', 'pebbles', 'grass', 'leaves', 'thornLitter', 'lilypad'];
  map.forEach((row, gy) =>
    [...row].forEach((ch, gx) => {
      if (ch !== '.' || rng.next() > 0.36) return;
      const c = at(gx, gy);
      const kind = rng.pick(kinds);
      if (kind === 'lilypad' && !map[gy][gx - 1]?.includes('~') && !map[gy][gx + 1]?.includes('~')) return;
      const svg = terrainSvg.decor(kind, rng.int(0, 3));
      flat.push(place(svg, DECOR_CANVAS.w, DECOR_CANVAS.h, DECOR_CANVAS.anchor.x, DECOR_CANVAS.anchor.y, c.x + rng.int(-12, 12), c.y + rng.int(-12, 12)));
    }),
  );

  for (const a of scene.actors) {
    const art = CHARACTERS[a.kind];
    const svg = art.draw(a.action, a.frame, a.view ?? art.views[0], !!a.champion);
    standing.push({ y: a.y, svg: place(svg, art.w, art.h, art.anchor.x, art.anchor.y, a.x, a.y, a.flip) });
  }
  standing.sort((a, b) => a.y - b.y);

  const shots = scene.shots
    .map((s) => {
      const svg = hudSvg.shot(s.kind, s.kind === 'player' ? 7 : 6);
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
    (['player', 'enemy'] as const)
      .map((k) => `<radialGradient id="${id}-glow-${k}"><stop offset="0" stop-color="${k === 'player' ? PAPER.shot : PAPER.enemyShot}" stop-opacity="0.75"/><stop offset="1" stop-color="${k === 'player' ? PAPER.shot : PAPER.enemyShot}" stop-opacity="0"/></radialGradient>`)
      .join('') +
    `<mask id="${id}-dark" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${Hh}"><rect width="${W}" height="${Hh}" fill="#fff"/>${holes}</mask>`;
  const dark = lit
    ? `<rect width="${W}" height="${Hh}" fill="#04070a" opacity="0.62" mask="url(#${id}-dark)"/>${warmth}<rect width="${W}" height="${Hh}" fill="url(#${id}-vignette)"/>`
    : '';
  return `<defs>${defs}</defs><rect width="${W}" height="${Hh}" fill="${PAPER.hedgeDark}"/>${flat.join('')}${standing.map((s) => s.svg).join('')}${dark}${shots}`;
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
  const mw = 164;
  const mh = 96;
  const mx = w - mw - 6;
  const cells = [
    { x: 0, y: 0, c: 'current' }, { x: -1, y: 0, c: 'visited' }, { x: 1, y: 0, c: 'visited' }, { x: 0, y: -1, c: 'unseen' },
    { x: 2, y: 0, c: 'item' }, { x: -1, y: 1, c: 'unseen' }, { x: 0, y: 1, c: 'boss' },
  ]
    .map((m) => {
      const x = mx + mw / 2 - 8 + m.x * 19;
      const y = 6 + mh / 2 - 5 + m.y * 13;
      const ink = PAPER.mapInk;
      const shape = m.c === 'unseen'
        ? `<rect x="${x}" y="${y}" width="16" height="10" fill="none" stroke="${ink}" stroke-width="1.2" stroke-dasharray="2 1.5"/>`
        : `<rect x="${x}" y="${y}" width="16" height="10" fill="${m.c === 'current' ? ink : '#9a8a6a'}"/>`;
      const dot = m.c === 'item' ? `<circle cx="${x + 8}" cy="${y + 5}" r="2.6" fill="#c89a2a"/>` : m.c === 'boss' ? `<circle cx="${x + 8}" cy="${y + 5}" r="2.6" fill="${PAPER.heart}"/>` : '';
      return shape + dot;
    })
    .join('');
  const scrap = `<use href="#${sheet.id(hudSvg.scrap(mw, mh), mw, mh)}" x="${mx}" y="6"/>`;
  return hearts + icons + scrap + cells + text(w - 10, 120, 'FLOOR 1', 'end');
}

function roomSvg(sheet: Sheet, scene: Scene, lit: boolean, id: string, hud: boolean): string {
  const w = scene.map[0].length * TILE;
  const h = scene.map.length * TILE;
  return `<svg class="room" viewBox="0 0 ${w} ${h}" role="img" aria-label="Papercut forest room">${drawRoom(sheet, scene, lit, id)}${hud ? drawHud(sheet, w) : ''}</svg>`;
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

const img = (svg: string, w: number, h: number, scale: number, flip = false, alt = '') =>
  `<img src="${uri(svg)}" width="${w * scale}" height="${h * scale}" alt="${alt}"${flip ? ' style="transform:scaleX(-1)"' : ''}>`;

function frameStrips(): string {
  const rows: string[] = [];
  const names: Record<string, string> = { player: 'Player', goblin: 'Goblin', seedSpitter: 'Seed spitter', boar: 'Boar', wasp: 'Wasp', treantBoss: 'Treant' };
  for (const [kind, art] of Object.entries(CHARACTERS)) {
    const scale = kind === 'treantBoss' ? 1 : 2;
    for (const view of art.views) {
      const cells = (Object.entries(art.actions) as [Action, number][])
        .map(([action, count]) => {
          const frames = Array.from({ length: count }, (_, f) =>
            `<figure>${img(art.draw(action, f, view, false), art.w, art.h, scale, false, `${names[kind]} ${action} frame ${f + 1}`)}<figcaption>${f + 1}</figcaption></figure>`,
          ).join('');
          return `<div class="action"><h4>${action} <span>${count}</span></h4><div class="frames">${frames}</div></div>`;
        })
        .join('');
      const label = art.views.length > 1 ? `${names[kind]} <span>facing ${view === 'side' ? 'right (left is mirrored)' : view}</span>` : names[kind];
      rows.push(`<section class="strip"><h3>${label}</h3><div class="actions">${cells}</div></section>`);
    }
  }
  const champs = ['goblin', 'seedSpitter', 'boar', 'wasp']
    .map((k) => `<figure>${img(CHARACTERS[k].draw('idle', 0, CHARACTERS[k].views[0], true), CHARACTERS[k].w, CHARACTERS[k].h, 2, false, `Champion ${names[k]}`)}<figcaption>${names[k]}</figcaption></figure>`)
    .join('');
  rows.push(`<section class="strip"><h3>Champions <span>gold paper trim</span></h3><div class="frames">${champs}</div></section>`);
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
${frameStrips()}
<h2>Pieces</h2>
<p class="note">Joined pieces show how neighbouring trees, thorns and pond tiles grow into each other.</p>
${pieceSheet()}`;
}

document.getElementById('page')!.innerHTML = buildMockup();
document.body.dataset.ready = '1';
