import { PAPER as P } from './palette';
import type { Direction } from '../map/floorGenerator';
import { DOWN, LEFT, RIGHT, UP, type Mask } from './autotile';
import { blob, cutPoly, fill, group, n, pieceRng, polyPath, ragged, ring, sheet, svgDoc, type Pt } from './svg';

/**
 * Terrain in paper. A tile piece's canvas is larger than its tile so tall things (trees) can rise
 * above it and shadows can fall past it: the tile's own square sits with its centre on `anchor`.
 */
export const TILE = 48;
export const TILE_CANVAS = { w: 72, h: 92, anchor: { x: 36, y: 58 } };


const { x: AX, y: AY } = TILE_CANVAS.anchor;
const H = TILE / 2;

const ellipse = (x: number, y: number, rx: number, ry: number, color: string, extra = '') =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${color}"${extra ? ` ${extra}` : ''}/>`;
const contact = (rx: number, ry: number, dy = 14) => ellipse(AX + 3, AY + dy, rx, ry, P.shadow, 'opacity="0.42"');
const tileDoc = (body: string, seed: number, grain = 1) => svgDoc(TILE_CANVAS.w, TILE_CANVAS.h, body, seed, grain);
/** The cave floor's paper grain: half strength, so the ground stays quiet under the fight. */
const CAVE_FLOOR_GRAIN = 0.5;


// ---------------------------------------------------------------------------------------------
// Terrain tiles
// ---------------------------------------------------------------------------------------------

type Foliage = { main: string; light: string; dark: string };
const TREE: Foliage = { main: P.tree, light: P.treeLight, dark: P.treeDark };

/** A forest tree: a trunk on its tile and a ragged layered canopy rising above it. */
function tree(variant: number, look: Foliage = TREE) {
  const r = (part: string) => pieceRng('tree', variant, part);
  const lean = (variant % 3) - 1;
  const top = AY - 26;
  return (
    contact(22, 8, 12) +
    sheet(fill(cutPoly(r('trunk'), [{ x: AX - 6, y: AY + 16 }, { x: AX - 4, y: AY - 4 }, { x: AX + 4, y: AY - 4 }, { x: AX + 6, y: AY + 16 }, { x: AX + 1, y: AY + 13 }], 0.5), P.trunk)) +
    sheet(fill(ragged(r('back'), AX + lean * 2, top + 4, 25, 21, 14, 0.24), look.dark), 2) +
    sheet(fill(ragged(r('mid'), AX + lean * 3, top - 3, 20, 17, 12, 0.22), look.main), 2) +
    sheet(fill(ragged(r('top'), AX - 5 + lean * 4, top - 10, 10, 7, 8, 0.25), look.light))
  );
}

/** A bush: a low clump of leafy blobs; breaks after a few shots. */
function bush(variant: number, look: { main: string; light: string; dark: string } = { main: P.bush, light: P.bushLight, dark: P.bushDark }) {
  const r = (part: string) => pieceRng('bush', variant, part);
  const clumps = [
    { x: -10, y: 2, rx: 12, ry: 10, c: look.dark },
    { x: 10, y: 2, rx: 12, ry: 10, c: look.dark },
    { x: 0, y: -6, rx: 15, ry: 12, c: look.main },
    { x: -7, y: 5, rx: 10, ry: 8, c: look.main },
    { x: 8, y: 6, rx: 10, ry: 7, c: look.main },
    { x: -3, y: -11, rx: 7, ry: 5, c: look.light },
  ];
  return contact(19, 6, 14) + clumps.map((c, i) => sheet(fill(ragged(r(`c${i}`), AX + c.x, AY + c.y, c.rx, c.ry, 10, 0.18), c.c))).join('');
}

/**
 * A piece of pond: water with an earthen bank on every side that has no pond beyond it, and
 * rounded outer corners where two banks meet. Pieces with pond on a side run to the tile edge.
 */
function pond(variant: number, mask: Mask, look: { water: string; light: string; deep: string } = { water: P.pond, light: P.pondLight, deep: P.pondDeep }) {
  const r = (part: string) => pieceRng('pond', variant, mask, part);
  const inset = (bit: number) => (mask & bit ? 0 : 5);
  const [t, rt, b, l] = [inset(UP), inset(RIGHT), inset(DOWN), inset(LEFT)];
  const x0 = AX - H + l;
  const x1 = AX + H - rt;
  const y0 = AY - H + t;
  const y1 = AY + H - b;
  const round = (a: number, bb: number) => (!(mask & a) && !(mask & bb) ? 12 : 0);
  const [tl, tr, br, bl] = [round(UP, LEFT), round(UP, RIGHT), round(DOWN, RIGHT), round(DOWN, LEFT)];
  // Grown only on open sides: where pond carries on, pieces meet edge to edge.
  const shape = (grow: number) => {
    const [gt, gr, gb, gl] = [UP, RIGHT, DOWN, LEFT].map((bit) => (mask & bit ? 0 : grow));
    const [a, b2, c, d] = [x0 - gl, x1 + gr, y0 - gt, y1 + gb];
    return (
      `M${n(a + tl)} ${n(c)}L${n(b2 - tr)} ${n(c)}Q${n(b2)} ${n(c)} ${n(b2)} ${n(c + tr)}` +
      `L${n(b2)} ${n(d - br)}Q${n(b2)} ${n(d)} ${n(b2 - br)} ${n(d)}` +
      `L${n(a + bl)} ${n(d)}Q${n(a)} ${n(d)} ${n(a)} ${n(d - bl)}` +
      `L${n(a)} ${n(c + tl)}Q${n(a)} ${n(c)} ${n(a + tl)} ${n(c)}Z`
    );
  };
  // The bank is a paper sheet under the water, peeking out on open sides.
  const bank = fill(shape(4), P.bank);
  // Water sits below the ground: its top edge is shaded, as the bank throws its shadow into it.
  const water = fill(shape(0), look.water) + (mask & UP ? '' : fill(`M${n(x0)} ${n(y0)}L${n(x1)} ${n(y0)}L${n(x1)} ${n(y0 + 7)}L${n(x0)} ${n(y0 + 7)}Z`, look.deep, 'opacity="0.6"'));
  const ripple = variant % 2
    ? `<path d="M${n(AX - 10)} ${n(AY + 4)}q5 -3 10 0t10 0" stroke="${look.light}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.8"/>`
    : '';
  const lily = variant === 3 ? sheet(fill(blob(r('lily'), AX + 6, AY - 4, 6, 4.5, 8, 0.08), P.lily) + fill(`M${AX + 6} ${AY - 4}L${AX + 12} ${AY - 6}L${AX + 12} ${AY - 2}Z`, look.water)) : '';
  return sheet(bank) + water + ripple + lily;
}

/** A thorn bush: low twisted brambles with pink spikes; it reaches its vines into neighbouring thorns. */
function thorn(variant: number) {
  const r = (part: string) => pieceRng('thorn', variant, part);
  const vines = [
    ...[0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + variant;
      return { x: AX + Math.cos(a) * 16, y: AY + Math.sin(a) * 12 };
    }),
  ];
  const stems = vines
    .map((p, i) => {
      const mid = { x: (p.x + AX) / 2 + (r(`bend${i}`).next() - 0.5) * 10, y: (p.y + AY) / 2 + (r(`bend${i}`).next() - 0.5) * 8 };
      const spikes = [0.4, 0.75].map((k) => {
        const s = { x: AX + (p.x - AX) * k, y: AY + (p.y - AY) * k };
        return fill(`M${n(s.x - 2)} ${n(s.y)}L${n(s.x)} ${n(s.y - 6)}L${n(s.x + 2)} ${n(s.y)}Z`, P.thornSpike);
      });
      return `<path d="M${AX} ${AY}Q${n(mid.x)} ${n(mid.y)} ${n(p.x)} ${n(p.y)}" stroke="${P.thorn}" stroke-width="4.5" fill="none" stroke-linecap="round"/>` + spikes.join('');
    })
    .join('');
  const heart = fill(blob(r('heart'), AX, AY, 13, 10, 9, 0.2), P.thorn) +
    [0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2 + variant * 0.7;
      const s = { x: AX + Math.cos(a) * 10, y: AY + Math.sin(a) * 7 };
      return fill(`M${n(s.x - 2.2)} ${n(s.y + 1)}L${n(s.x + Math.cos(a) * 6)} ${n(s.y + Math.sin(a) * 6 - 3)}L${n(s.x + 2.2)} ${n(s.y + 1)}Z`, P.thornSpike);
    }).join('');
  return contact(18, 6, 10) + sheet(stems) + sheet(heart, 2);
}

/**
 * Where two neighbouring trees' canopies grow into each other, or two thorn bushes' vines: drawn
 * on the seam between them, whose centre is the canvas anchor. `down` joins a tile to the one below.
 */
function canopyJoin(look: Foliage, dir: 'across' | 'down') {
  const r = (part: string) => pieceRng('canopyJoin', dir, part);
  // A canopy stands 26 px above its tile's centre: the seam's clump sits between the two.
  const y = AY - 26 + (dir === 'down' ? 0 : -2);
  const [rx, ry] = dir === 'across' ? [18, 15] : [17, 19];
  return sheet(fill(ragged(r('dark'), AX, y, rx, ry, 12, 0.24), look.dark), 2) + sheet(fill(ragged(r('main'), AX, y - 3, rx * 0.7, ry * 0.6, 9, 0.22), look.main));
}

function vineJoin(dir: 'across' | 'down', look: { stem: string; spike: string; key: string } = { stem: P.thorn, spike: P.thornSpike, key: 'vineJoin' }) {
  const r = pieceRng(look.key, dir);
  const [dx, dy] = dir === 'across' ? [26, 0] : [0, 26];
  const bend = (r.next() - 0.5) * 10;
  const spikes = [-0.4, 0.3].map((k) => {
    const s = { x: AX + dx * k + (dir === 'down' ? bend / 2 : 0), y: AY + dy * k + (dir === 'across' ? bend / 2 : 0) };
    return fill(`M${n(s.x - 2)} ${n(s.y)}L${n(s.x)} ${n(s.y - 6)}L${n(s.x + 2)} ${n(s.y)}Z`, look.spike);
  });
  return sheet(
    `<path d="M${AX - dx} ${AY - dy}Q${n(AX + (dir === 'down' ? bend : 0))} ${n(AY + (dir === 'across' ? bend : 0))} ${AX + dx} ${AY + dy}" stroke="${look.stem}" stroke-width="4.5" fill="none" stroke-linecap="round"/>` + spikes.join(''),
  );
}

/** A rolling log: a fallen trunk lying across its tile, its cut end facing the camera. */
function log(variant: number) {
  const r = (part: string) => pieceRng('log', variant, part);
  const body = cutPoly(r('body'), [{ x: AX - 22, y: AY - 14 }, { x: AX + 22, y: AY - 14 }, { x: AX + 22, y: AY + 12 }, { x: AX - 22, y: AY + 12 }], 0.8);
  const bark = [-12, -2, 9].map((dx) => `<path d="M${AX + dx} ${AY - 12}q2 12 -1 22" stroke="${P.barkShade}" stroke-width="2" fill="none" opacity="0.6"/>`).join('');
  const end = fill(blob(r('end'), AX + 20, AY - 1, 7, 13, 9, 0.05), P.logEnd) +
    `<ellipse cx="${AX + 20}" cy="${AY - 1}" rx="3.5" ry="7" fill="none" stroke="${P.logRing}" stroke-width="1.4"/>`;
  return contact(24, 6, 14) + sheet(fill(body, P.log) + bark, 2) + sheet(end);
}

/** A mirror stone: a pale faceted standing stone that bounces shots. */
function mirrorStone(variant: number) {
  const r = (part: string) => pieceRng('mirror', variant, part);
  const top = AY - 30;
  const stone = cutPoly(r('stone'), [{ x: AX - 16, y: AY + 12 }, { x: AX - 18, y: AY - 8 }, { x: AX - 6, y: top }, { x: AX + 10, y: top + 4 }, { x: AX + 18, y: AY - 6 }, { x: AX + 15, y: AY + 12 }], 1);
  const facet = cutPoly(r('facet'), [{ x: AX - 6, y: top + 2 }, { x: AX + 9, y: top + 6 }, { x: AX + 4, y: AY + 6 }, { x: AX - 10, y: AY + 2 }], 0.8);
  return contact(19, 6, 13) + sheet(fill(stone, P.stoneShade) + fill(facet, P.stone), 2) + sheet(fill(`M${AX - 3} ${top + 6}L${AX + 3} ${top + 8}L${AX - 1} ${AY - 8}Z`, P.stoneLight));
}

/** A puffball: a plump glowing mushroom cap on a short stem; bursts into a stun cloud. */
function puffball(variant: number) {
  const r = (part: string) => pieceRng('puff', variant, part);
  return (
    contact(14, 5, 12) +
    sheet(fill(cutPoly(r('stem'), [{ x: AX - 6, y: AY + 12 }, { x: AX - 5, y: AY - 2 }, { x: AX + 5, y: AY - 2 }, { x: AX + 6, y: AY + 12 }], 0.5), P.puffStem)) +
    sheet(fill(blob(r('cap'), AX, AY - 8, 16, 13, 10, 0.06), P.puff) + fill(blob(r('glow'), AX - 5, AY - 13, 7, 5, 8, 0.1), P.puffLight) +
      [0, 1, 2].map((i) => ellipse(AX + [-8, 6, 1][i], AY - [2, 6, -1][i], 1.6, 1.3, P.puffStem)).join(''), 2)
  );
}

// ---------------------------------------------------------------------------------------------
// Room: walls, doors, floor
// ---------------------------------------------------------------------------------------------

export type WallSide = 'top' | 'bottom' | 'left' | 'right' | 'corner';

/** Each floor's room shell: which walls, doors and floors it is drawn with. */
export type Shell = 'forest' | 'caves';
/** The wall styles a floor's rooms come in; the first is its usual one. */
export const WALL_STYLES = { forest: ['hedge'], caves: ['strata', 'veined'] } as const satisfies Record<Shell, readonly string[]>;
export type WallStyle = (typeof WALL_STYLES)[Shell][number];
/** The canvas a wall style's pieces are drawn on (cave rock spills far past its tile). */
export const wallCanvas = (style: WallStyle) => (style === 'hedge' ? TILE_CANVAS : CAVE_WALL_CANVAS);
/** The canvas a floor's pieces are drawn on (cave floor marks spill far past their tile). */
export const floorCanvas = (shell: Shell) => (shell === 'caves' ? CAVE_FLOOR_CANVAS : TILE_CANVAS);
/** How many looks a floor's pieces come in. */
export const floorLooks = (shell: Shell) => (shell === 'caves' ? CAVE_FLOOR_LOOKS : 4);
/** Whether a floor's pieces are only marks, laid over a ground of paper of their own (`terrainSvg.ground`) drawn first. */
export const hasGround = (shell: Shell) => shell === 'caves';

/**
 * A hedge wall tile. Every side is a clump of dark foliage from above; the top wall also shows
 * its front face, a band of trunks and roots facing the camera, because the view looks down at 3/4.
 */
function hedge(side: WallSide, variant: number) {
  const r = (part: string) => pieceRng('hedge', side, variant, part);
  const face =
    side === 'top'
      ? sheet(
          fill(`M${AX - H - 6} ${AY - 4}L${AX + H + 6} ${AY - 4}L${AX + H + 6} ${AY + H}L${AX - H - 6} ${AY + H}Z`, P.wallFaceDark) +
            [-14, 2, 16].map((dx, i) => fill(cutPoly(r(`trunk${i}`), [{ x: AX + dx - 4, y: AY - 4 }, { x: AX + dx + 4, y: AY - 4 }, { x: AX + dx + 5 + i, y: AY + H }, { x: AX + dx - 5, y: AY + H }], 0.6), P.wallFace)).join(''),
        )
      : '';
  const clumpY = side === 'top' ? AY - 10 : AY;
  const clumps = [
    { x: -14, y: 2, rx: 17, ry: 15, c: P.hedgeDark },
    { x: 14, y: 2, rx: 17, ry: 15, c: P.hedgeDark },
    { x: 0, y: -4, rx: 19, ry: 16, c: P.hedge },
    { x: -9 + (variant % 3) * 6, y: -9, rx: 9, ry: 7, c: P.hedgeLight },
  ];
  return face + clumps.map((c, i) => sheet(fill(ragged(r(`c${i}`), AX + c.x, clumpY + c.y, c.rx, c.ry, 12, 0.2), c.c), i < 2 ? 1 : 2)).join('');
}

/** A doorway: a trodden path through the hedge, with a wooden arch over a top or side door. `locked` closes it with a plank gate. */
function doorway(side: 'top' | 'bottom' | 'left' | 'right', locked: boolean) {
  const r = (part: string) => pieceRng('door', side, part);
  const path = fill(blob(r('path'), AX, AY, 22, 22, 10, 0.06), P.door) + fill(blob(r('pathMid'), AX, AY, 12, 12, 8, 0.1), P.doorDark, 'opacity="0.5"');
  const vertical = side === 'top' || side === 'bottom';
  const posts = vertical
    ? [-1, 1].map((s) => fill(cutPoly(r(`post${s}`), [{ x: AX + s * 22 - 4, y: AY - 28 }, { x: AX + s * 22 + 4, y: AY - 28 }, { x: AX + s * 22 + 4, y: AY + 20 }, { x: AX + s * 22 - 4, y: AY + 20 }], 0.5), P.trunk)).join('') +
      fill(cutPoly(r('beam'), [{ x: AX - 30, y: AY - 34 }, { x: AX + 30, y: AY - 34 }, { x: AX + 27, y: AY - 25 }, { x: AX - 27, y: AY - 25 }], 0.6), P.barkLight)
    : [-1, 1].map((s) => fill(cutPoly(r(`post${s}`), [{ x: AX - 6, y: AY + s * 22 - 4 }, { x: AX + 6, y: AY + s * 22 - 4 }, { x: AX + 6, y: AY + s * 22 + 4 }, { x: AX - 6, y: AY + s * 22 + 4 }], 0.5), P.trunk)).join('');
  const gate = locked
    ? sheet(
        (vertical
          ? [-15, -5, 5, 15].map((dx) => fill(cutPoly(r(`plank${dx}`), [{ x: AX + dx - 4.5, y: AY - 22 }, { x: AX + dx + 4.5, y: AY - 22 }, { x: AX + dx + 4.5, y: AY + 20 }, { x: AX + dx - 4.5, y: AY + 20 }], 0.4), P.log)).join('') +
            [-12, 8].map((dy) => fill(`M${AX - 22} ${AY + dy}L${AX + 22} ${AY + dy}L${AX + 22} ${AY + dy + 5}L${AX - 22} ${AY + dy + 5}Z`, P.gate)).join('')
          : [-15, -5, 5, 15].map((dy) => fill(cutPoly(r(`plank${dy}`), [{ x: AX - 20, y: AY + dy - 4.5 }, { x: AX + 20, y: AY + dy - 4.5 }, { x: AX + 20, y: AY + dy + 4.5 }, { x: AX - 20, y: AY + dy + 4.5 }], 0.4), P.log)).join('') +
            [-10, 6].map((dx) => fill(`M${AX + dx} ${AY - 22}L${AX + dx + 5} ${AY - 22}L${AX + dx + 5} ${AY + 22}L${AX + dx} ${AY + 22}Z`, P.gate)).join('')),
        2,
      )
    : '';
  return path + gate + sheet(posts, 2);
}

/** Floor under the room: moss paper in soft patches that stay inside the tile, so any mix of variants tiles seamlessly. */
function floorTile(variant: number, kind: 'normal' | 'item' | 'boss') {
  const r = (part: string) => pieceRng('floor', kind, variant, part);
  const base = kind === 'item' ? '#4a5a2e' : kind === 'boss' ? '#3a3226' : P.floor;
  const patch = kind === 'item' ? '#566a36' : kind === 'boss' ? '#46392a' : P.floorPatch;
  const x0 = AX - H;
  const y0 = AY - H;
  const patches = [0, 1].map((i) => {
    const pr = r(`p${i}`);
    return fill(blob(pr, x0 + 12 + pr.next() * 24, y0 + 12 + pr.next() * 24, 8 + pr.next() * 5, 6 + pr.next() * 4, 8, 0.15), i ? P.floorDark : patch, 'opacity="0.7"');
  });
  // The item room's floor is warmer moss; the boss room's is bare earth with a scatter of scorched roots.
  const mark = kind === 'boss' && variant === 0
      ? `<path d="M${x0 + 6} ${y0 + 30}q10 -8 18 -2t18 -8" stroke="#2a1e14" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.45"/>`
      : '';
  // Bleeds a pixel past the tile so scaled neighbours never show a seam.
  return `<rect x="${x0 - 1}" y="${y0 - 1}" width="${TILE + 2}" height="${TILE + 2}" fill="${base}"/>` + patches.join('') + mark;
}

// ---------------------------------------------------------------------------------------------
// Room in the caves: rock walls, timber doorways, earth floors
// ---------------------------------------------------------------------------------------------

const C = P.caves;

/**
 * A quartz prism standing out of the ground at `root`, leaning `lean` radians off upright: parallel
 * sides `w` wide and `h` long to its point, three faces showing (lit on the left, mid, shaded on the
 * right) each running up into its own facet of the point, and a hard highlight down the lit edge.
 * `snapped`, its point is broken off in a pale jagged break (a stub).
 */
function prism(r: Rng, root: Pt, h: number, w: number, lean: number, snapped = false) {
  const u = { x: Math.sin(lean), y: -Math.cos(lean) };
  const v = { x: Math.cos(lean), y: Math.sin(lean) };
  const at = (k: number, s: number) => ({ x: root.x + u.x * k + v.x * s, y: root.y + u.y * k + v.y * s });
  const point = Math.min(w * 1.5, h * 0.4);
  const body = snapped ? h * (0.75 + r.next() * 0.15) : h - point;
  const edges = [-w, -w * 0.3, w * 0.35, w];
  const tip = at(h, (r.next() - 0.5) * w * 0.3);
  const side = (i: number, tone: string) => fill(polyPath([at(0, edges[i]), at(body, edges[i]), at(body, edges[i + 1]), at(0, edges[i + 1])]), tone);
  const facet = (i: number, tone: string) => fill(polyPath([at(body, edges[i]), tip, at(body, edges[i + 1])]), tone);
  const outline = fill(polyPath(snapped ? [at(-1, -w - 0.6), at(body + 0.6, -w - 0.6), at(body + 0.6, w + 0.6), at(-1, w + 0.6)] : [at(-1, -w - 0.6), at(body, -w - 0.6), { x: tip.x + u.x * 0.8, y: tip.y + u.y * 0.8 }, at(body, w + 0.6), at(-1, w + 0.6)]), C.crystalDeep);
  const faces = side(0, C.crystal) + side(1, C.crystalShade) + side(2, C.crystalDeep);
  // A break: the snapped top a jagged pale scar across the body's end.
  const top = snapped
    ? fill(polyPath([at(body, -w), at(body + w * 0.35, -w * 0.4), at(body - w * 0.1, w * 0.1), at(body + w * 0.25, w * 0.6), at(body, w), at(body - w * 0.45, w * 0.3), at(body - w * 0.3, -w * 0.5)]), C.crystalLight, 'opacity="0.9"')
    : facet(0, C.crystalLight) + facet(1, C.crystal) + facet(2, C.crystalShade);
  const edge = at(body * 0.08, edges[1]);
  const highlight = `<path d="M${n(edge.x)} ${n(edge.y)}L${n(at(body, edges[1]).x)} ${n(at(body, edges[1]).y)}${snapped ? '' : `L${n(tip.x)} ${n(tip.y)}`}" stroke="${C.crystalLight}" stroke-width="${n(Math.max(0.6, w * 0.16))}" fill="none" stroke-linejoin="bevel" opacity="0.95"/>`;
  return outline + faces + top + highlight;
}

/**
 * A few quartz prisms fanned out of one root at x,y (their bases a little under it, for the ground
 * to bury): the tallest near the middle and in front, the rest leaning out to either side.
 */
function shards(key: string, x: number, y: number, size: number, count: number, snapped = false) {
  const r = pieceRng('shards', key);
  const mid = (count - 1) / 2;
  const prisms = Array.from({ length: count }, (_, i) => ({
    i,
    lean: (i - mid) * 0.42 + (r.next() - 0.5) * 0.25,
    h: size * (0.75 + r.next() * 0.4) * (i === Math.floor(count / 2) ? 1.25 : 1),
    w: size * (0.17 + r.next() * 0.05),
  }));
  // Outermost first, so the upright ones in the middle stand in front.
  return prisms
    .sort((a, b) => Math.abs(b.i - mid) - Math.abs(a.i - mid))
    .map((p) => prism(r, { x: x + (p.i - mid) * p.w * 0.9, y: y + 2 }, p.h, p.w, p.lean, snapped))
    .join('');
}

/** The crust crystal breaks out of: a jagged lip of earth and rock across the prisms' bases, crags and grit on it. */
function crust(r: Rng, x: number, y: number, rx: number, ry: number) {
  const lip = jagged(r, x, y, rx, ry, 16, 0.22);
  const crags = [-0.6, 0.05, 0.55].map((k) => crag(r, x + rx * k + (r.next() - 0.5) * 3, y + (r.next() - 0.3) * ry * 0.6, 2.6 + r.next() * 2.2, r.next() < 0.35 ? OCHRE_ROCK : ROCK)).join('');
  const grit = Array.from({ length: 5 }, () => `<circle cx="${n(x + (r.next() - 0.5) * rx * 1.8)}" cy="${n(y + (r.next() - 0.5) * ry)}" r="${n(0.6 + r.next() * 0.7)}" fill="${C.rockLight}"/>`).join('');
  return sheet(fill(polyPath(lip), C.rockDark) + fill(polyPath(lip.map((p) => ({ x: p.x * 0.85 + x * 0.15, y: p.y * 0.7 + (y + ry * 0.3) * 0.3 }))), C.earthPatch) + grit) + crags;
}

/** Cracks in the floor running out from where crystal broke through the ground at x,y. */
function floorCracks(r: Rng, x: number, y: number, reach: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    // Out to either side and a little toward the camera, wandering as it goes.
    const dir = { x: i % 2 ? 1 : -1, y: 0.15 + r.next() * 0.45 };
    let p = { x: x + dir.x * reach * 0.4, y: y + dir.y * reach * 0.15 };
    let d = `M${n(p.x)} ${n(p.y)}`;
    for (let s = 0; s < 3; s++) {
      p = { x: p.x + dir.x * reach * 0.2 + (r.next() - 0.5) * 3, y: p.y + dir.y * reach * 0.2 + (r.next() - 0.5) * 2.5 };
      d += `L${n(p.x)} ${n(p.y)}`;
    }
    return `<path d="${d}" stroke="${C.slabLight}" stroke-width="1" fill="none" opacity="0.45" transform="translate(0 0.9)"/>` +
      `<path d="${d}" stroke="${C.crack}" stroke-width="${n(1.3 - i * 0.12)}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
}


/**
 * A cave wall piece's canvas: much bigger than its tile, so the rock spills into its neighbours
 * and the wall reads as one free-form mass rather than a row of tiles.
 */
export const CAVE_WALL_CANVAS = { w: 128, h: 132, anchor: { x: 64, y: 72 } };
const { x: WX, y: WY } = CAVE_WALL_CANVAS.anchor;

type Rng = ReturnType<typeof pieceRng>;
type RockTone = { dark: string; main: string; light: string };
const ROCK: RockTone = { dark: C.rockDark, main: C.rock, light: C.rockLight };
const OCHRE_ROCK: RockTone = { dark: C.rockDark, main: C.ochre, light: C.stalactiteLight };
const DEEP_ROCK: RockTone = { dark: C.rockDeep, main: C.rockDark, light: C.rock };

/** A crag seen from above: an angular rock with a lit top and a pale facet catching the light from up-left. */
function crag(r: Rng, cx: number, cy: number, rad: number, tone: RockTone) {
  const count = 6 + Math.floor(r.next() * 3);
  const turn = r.next() * Math.PI;
  const pts = Array.from({ length: count }, (_, i) => {
    const a = turn + (i / count) * Math.PI * 2 + (r.next() - 0.5) * 0.5;
    const k = 0.72 + r.next() * 0.5;
    return { x: cx + Math.cos(a) * rad * k, y: cy + Math.sin(a) * rad * k * 0.82 };
  });
  const c = { x: cx - rad * 0.08, y: cy - rad * 0.28 };
  const top = pts.map((p) => ({ x: c.x + (p.x - cx) * 0.7, y: c.y + (p.y - cy) * 0.64 }));
  const lit = top.reduce((best, p, i) => (p.x + p.y < top[best].x + top[best].y ? i : best), 0);
  const facet = [c, top[lit], top[(lit + 1) % top.length]];
  const scar = rad > 13 && r.next() < 0.6
    ? `<path d="M${n(c.x - rad * 0.4)} ${n(c.y + rad * 0.1)}l${n(rad * 0.35)} ${n(-rad * 0.12)}l${n(rad * 0.3)} ${n(rad * 0.1)}" stroke="${tone.dark}" stroke-width="1.2" fill="none" opacity="0.8"/>`
    : '';
  return sheet(fill(polyPath(pts), tone.dark) + fill(polyPath(top), tone.main) + fill(polyPath(facet), tone.light, 'opacity="0.9"') + scar, rad > 14 ? 2 : 1);
}

/** A rock spire jutting up out of the wall, lit on its left flank. */
function spire(r: Rng, x: number, y: number, h: number) {
  const w = 6 + r.next() * 4;
  const tip = { x: x + (r.next() - 0.5) * h * 0.3, y: y - h };
  const mid = { x: x + (tip.x - x) * 0.5 + (r.next() - 0.5) * 3, y: y - h * 0.5 };
  return sheet(
    fill(polyPath([{ x: x - w, y }, { x: mid.x - w * 0.55, y: mid.y }, tip, { x: mid.x + w * 0.5, y: mid.y }, { x: x + w, y }]), C.rockDark) +
      fill(polyPath([{ x: x - w, y }, { x: mid.x - w * 0.55, y: mid.y }, tip, { x: mid.x, y: mid.y + 2 }, { x: x - 1, y }]), C.stalactite),
    2,
  );
}

/** A jagged outline round a centre: rock with no straight edge anywhere. */
function jagged(r: Rng, cx: number, cy: number, rx: number, ry: number, count: number, jitter: number) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const k = 1 - jitter + r.next() * jitter * 2;
    return { x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k };
  });
}

/** Which way each wall looks into the room. */
const INTO: Record<WallSide, { x: number; y: number }> = { top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 }, left: { x: 1, y: 0 }, right: { x: -1, y: 0 }, corner: { x: 0, y: 0 } };

/**
 * A cave wall: free-form crags heaped on a bed of dark rock that spills far past the tile, rubble
 * tumbling out into the room, and the odd spire. The top wall shows its front face, a ragged cliff
 * of rock strata with stalactites hanging from its lip. `veined` rock has the odd wall gem set
 * into it. The rock of every piece is laid out afresh, so no two look alike.
 */
function rockWall(side: WallSide, variant: number, veined: boolean) {
  const r = pieceRng('rockWall', side, variant);
  const into = INTO[side];
  // A side wall is drawn over the one above it and under the one below, so it must not reach up
  // into the tile above (a doorway may be there); it spills down, out and a little into the room.
  const noHigher = side === 'left' || side === 'right' || side === 'corner' ? WY - H - 3 : -Infinity;
  const clampUp = (p: Pt) => ({ x: p.x, y: Math.max(p.y, noHigher) });
  const top = side === 'top';
  const parts: { y: number; svg: string }[] = [];

  let face = '';
  let drips = '';
  if (top) {
    // The face spans just its tile. Every layer meets the tile's edges at a fixed height and only
    // wanders in between, so the strata run on unbroken from one wall piece to the next.
    const [x0, x1] = [WX - H - 2, WX + H + 2];
    const lip = WY - 6;
    const wander = (x: number, amount: number) => (Math.abs(x - WX) < H - 4 ? (r.next() - 0.5) * amount : 0);
    const across = (count: number) => Array.from({ length: count }, (_, k) => x0 + (k * (x1 - x0)) / (count - 1));
    // The cliff's foot, ragged, nudging into the room here and there.
    const foot = across(10).reverse().map((x) => ({ x, y: WY + H + Math.max(0, wander(x, 8)) }));
    const tops = [lip, WY + 2, WY + 8, WY + 13, WY + 18];
    const tones = [C.strataDark, C.strataLight, C.strata, C.ochre, C.strataLight];
    const bands = tops.map((y, i) => {
      const edge = across(11).map((x) => ({ x, y: y + wander(x, i ? 5 : 3) }));
      const under = i + 1 < tops.length ? [{ x: x1, y: tops[i + 1] + 3 }, { x: x0, y: tops[i + 1] + 3 }] : foot;
      return sheet(fill(polyPath([...edge, ...under]), tones[i]));
    });
    // Fractures running down the face split it into blocks.
    const fractures = Array.from({ length: 2 + Math.floor(r.next() * 2) }, () => {
      let x = x0 + 10 + r.next() * (x1 - x0 - 20);
      let y = lip + 2;
      let d = `M${n(x)} ${n(y)}`;
      while (y < WY + H - 2) {
        x += (r.next() - 0.5) * 7;
        y += 4 + r.next() * 5;
        d += `L${n(x)} ${n(Math.min(y, WY + H - 1))}`;
      }
      return `<path d="${d}" stroke="${C.rockDeep}" stroke-width="1.3" fill="none" opacity="0.85"/>`;
    }).join('');
    // Stalactites hang from the cliff's lip over its face, kept inside the tile so no neighbour cuts them off.
    drips = Array.from({ length: [1, 3, 0, 2][variant % 4] }, () => {
      const x = WX - 20 + r.next() * 40;
      const len = 12 + r.next() * 16;
      const w = 3.5 + r.next() * 2.5;
      const tip = { x: x + (r.next() - 0.5) * 3, y: lip - 1 + len };
      return fill(polyPath([{ x: x - w, y: lip - 2 }, { x: x + w, y: lip - 2 }, { x: x + w * 0.35, y: lip + len * 0.55 }, tip]), C.stalactite) +
        fill(polyPath([{ x: x - w * 0.7, y: lip - 2 }, { x: x - w * 0.1, y: lip - 2 }, { x: tip.x, y: tip.y - 2 }]), C.stalactiteLight);
    }).join('');
    face = [...bands].reverse().join('') + fractures;
    // Boulders fallen from the cliff, lying at its foot.
    for (let i = 0, count = Math.floor(r.next() * 3); i < count; i++) {
      const rad = 4 + r.next() * 5;
      parts.push({ y: 999, svg: crag(r, WX - 34 + r.next() * 68, WY + H + 1, rad, r.next() < 0.3 ? OCHRE_ROCK : ROCK) });
    }
  }

  // The bed: a dark heap of rock spilling well past the tile, shifted away from the room.
  const bedC = top ? { x: WX, y: WY - 22 } : { x: WX - into.x * 5, y: WY - into.y * 5 };
  const bedR = top ? { x: 48, y: 22 } : { x: 40 - Math.abs(into.x) * 6, y: 38 - Math.abs(into.y) * 6 };
  const bedPts = jagged(r, bedC.x, bedC.y, bedR.x, bedR.y, 18, 0.2).map(clampUp).map((p) => (top ? { x: p.x, y: Math.min(p.y, WY - 4) } : p));
  const bed = sheet(fill(polyPath(bedPts), C.rockDeep));

  // Crags heaped on the bed: a few big ones and a scatter of small, placed anywhere, back ones first.
  const count = 4 + Math.floor(r.next() * 4);
  for (let i = 0; i < count; i++) {
    const rad = i < 2 ? 14 + r.next() * 9 : 6 + r.next() * 9;
    const x = bedC.x + (r.next() - 0.5) * bedR.x * 1.4;
    let y = bedC.y + (r.next() - 0.5) * bedR.y * 1.3;
    // On the top wall they stay above the cliff's lip, never hanging over a neighbour's face.
    if (top) y = Math.min(y, WY - 7 - rad);
    y = Math.max(y, noHigher + rad * 1.1);
    const roll = r.next();
    parts.push({ y, svg: crag(r, x, y, rad, roll < 0.2 ? OCHRE_ROCK : roll < 0.45 ? DEEP_ROCK : ROCK) });
  }
  // Spires on the top wall and the rock beyond the room, never over a doorway.
  if ((top || side === 'corner') && r.next() < 0.55) {
    const y = top ? WY - 14 - r.next() * 12 : WY - 4 + r.next() * 16;
    parts.push({ y: y + 0.5, svg: spire(r, WX - 26 + r.next() * 52, y, 22 + r.next() * 18) });
  }
  // Rubble tumbling out of the wall into the room.
  if (!top && side !== 'corner') {
    for (let i = 0, rubble = 1 + Math.floor(r.next() * 4); i < rubble; i++) {
      const along = (r.next() - 0.5) * 44;
      const out = 20 + r.next() * 10;
      const x = WX + into.x * out + into.y * along;
      const y = Math.max(WY + into.y * out + into.x * along, noHigher + 6);
      parts.push({ y, svg: crag(r, x, y, 3 + r.next() * 4, r.next() < 0.3 ? OCHRE_ROCK : ROCK) });
    }
  }
  parts.sort((a, b) => a.y - b.y);

  // Wall gems: now and then a small cluster of prisms set into the rock, well back from the room.
  const gems = veined ? wallGems(side, variant).map((g, i) => wallGem(`${side}${variant}${i}`, WX + g.x, WY + g.y, g.size)).join('') : '';
  return top
    ? face + gems + (drips ? sheet(drips, 2) : '') + bed + parts.map((p) => p.svg).join('')
    : bed + parts.map((p) => p.svg).join('') + gems;
}

/** A wall gem: where it sits, from its wall tile's centre in px, and how tall its prisms stand. */
export interface WallGem {
  x: number;
  y: number;
  size: number;
}

/**
 * Where a veined wall piece's gems sit: none in a corner, and 0-2 elsewhere (many pieces have none),
 * each set back from the room-facing edge; on the top wall, in the cliff face above its foot. The
 * same for a piece every time, so the gloom can light them where they are drawn.
 */
export function wallGems(side: WallSide, variant: number): WallGem[] {
  if (side === 'corner') return [];
  const r = pieceRng('wallGems', side, variant);
  const roll = r.next();
  const count = roll < 0.74 ? 0 : roll < 0.93 ? 1 : 2;
  const into = INTO[side];
  // Along the wall, the gems keep apart; across it, they sit 14-24 px back from the room-facing edge.
  const slots = count === 2 ? [-12, 12] : [0];
  return slots.slice(0, count).map((slot) => {
    const along = slot + (r.next() - 0.5) * 12;
    const size = 6 + r.next() * 3.5;
    if (side === 'top') return { x: along, y: -2 + r.next() * 8, size };
    const back = H - 14 - r.next() * 10;
    // A side wall's gems stay inside its own tile, never up in the tile above (a doorway may be there).
    const sideways = side === 'bottom' ? along : Math.max(-H + 10, along);
    return { x: into.x * back + into.y * sideways, y: into.y * back + Math.abs(into.x) * sideways, size };
  });
}

/** A wall gem: 2-3 tiny prisms breaking out of a dark socket in the rock. */
function wallGem(key: string, x: number, y: number, size: number) {
  const r = pieceRng('wallGem', key);
  return sheet(fill(blob(r, x, y + 1, size * 0.6, size * 0.32, 8, 0.2), C.rockDeep) + shards(`gem${key}`, x, y - 1, size, 2 + Math.floor(r.next() * 2)));
}

/** A cave doorway: an opening in the rock framed by timber mine props and a lintel. `locked` bars it with a rusted iron grate. */
function mineDoor(side: 'top' | 'bottom' | 'left' | 'right', locked: boolean) {
  const r = (part: string) => pieceRng('mineDoor', side, part);
  const opening = fill(blob(r('path'), AX, AY, 22, 22, 10, 0.08), C.earthDark) + fill(blob(r('pathMid'), AX, AY, 13, 13, 8, 0.12), C.rockDeep, 'opacity="0.7"');
  const vertical = side === 'top' || side === 'bottom';
  const beam = (pts: { x: number; y: number }[], part: string, color: string) => fill(cutPoly(r(part), pts, 0.6), color);
  const props = vertical
    ? [-1, 1].map((s) =>
        beam([{ x: AX + s * 22 - 4.5, y: AY - 28 }, { x: AX + s * 22 + 4.5, y: AY - 28 }, { x: AX + s * 22 + 4, y: AY + 20 }, { x: AX + s * 22 - 4, y: AY + 20 }], `prop${s}`, C.timber) +
        fill(`M${AX + s * 22 + (s > 0 ? 1.5 : -4)} ${AY - 27}l2.5 0l-0.5 46l-2.5 0Z`, C.timberDark, 'opacity="0.8"'),
      ).join('') +
      beam([{ x: AX - 31, y: AY - 35 }, { x: AX + 31, y: AY - 35 }, { x: AX + 29, y: AY - 25 }, { x: AX - 29, y: AY - 25 }], 'lintel', C.timberLight) +
      [-24, 24].map((dx) => `<circle cx="${AX + dx}" cy="${AY - 30}" r="1.4" fill="${C.rustDark}"/>`).join('')
    : [-1, 1].map((s) =>
        beam([{ x: AX - 7, y: AY + s * 22 - 4.5 }, { x: AX + 7, y: AY + s * 22 - 4.5 }, { x: AX + 7, y: AY + s * 22 + 4.5 }, { x: AX - 7, y: AY + s * 22 + 4.5 }], `prop${s}`, C.timber) +
        `<circle cx="${AX}" cy="${AY + s * 22}" r="2.4" fill="none" stroke="${C.timberDark}" stroke-width="1.2"/>`,
      ).join('') +
      beam([{ x: AX - 4, y: AY - 28 }, { x: AX + 4, y: AY - 28 }, { x: AX + 4, y: AY + 28 }, { x: AX - 4, y: AY + 28 }], 'lintel', C.timberLight);
  // Loose rock piled at the foot of each prop.
  const rubble = (vertical ? [-1, 1].map((s) => ({ x: AX + s * 27, y: AY + 18 })) : [-1, 1].map((s) => ({ x: AX + 9, y: AY + s * 25 })))
    .map((p, i) => fill(cutPoly(r(`rubble${i}`), ring(p.x, p.y, 4.5, 3.5, 6, i), 0.8), C.rockLight)).join('');
  const bar = (pts: { x: number; y: number }[], part: string, color: string) => fill(cutPoly(r(part), pts, 0.3), color);
  const grate = locked
    ? sheet(
        vertical
          ? [-15, -5, 5, 15].map((dx) => bar([{ x: AX + dx - 2, y: AY - 24 }, { x: AX + dx + 2, y: AY - 24 }, { x: AX + dx + 2, y: AY + 20 }, { x: AX + dx - 2, y: AY + 20 }], `bar${dx}`, C.rust) +
              `<path d="M${AX + dx - 0.8} ${AY - 22}v40" stroke="${C.rustLight}" stroke-width="0.9" opacity="0.8"/>`).join('') +
            [-14, 8].map((dy) => bar([{ x: AX - 22, y: AY + dy }, { x: AX + 22, y: AY + dy }, { x: AX + 22, y: AY + dy + 4 }, { x: AX - 22, y: AY + dy + 4 }], `cross${dy}`, C.rustDark) +
              [-15, -5, 5, 15].map((dx) => `<circle cx="${AX + dx}" cy="${AY + dy + 2}" r="1.3" fill="${C.rustLight}"/>`).join('')).join('')
          : [-15, -5, 5, 15].map((dy) => bar([{ x: AX - 20, y: AY + dy - 2 }, { x: AX + 20, y: AY + dy - 2 }, { x: AX + 20, y: AY + dy + 2 }, { x: AX - 20, y: AY + dy + 2 }], `bar${dy}`, C.rust) +
              `<path d="M${AX - 18} ${AY + dy - 0.8}h36" stroke="${C.rustLight}" stroke-width="0.9" opacity="0.8"/>`).join('') +
            [-10, 6].map((dx) => bar([{ x: AX + dx, y: AY - 22 }, { x: AX + dx + 4, y: AY - 22 }, { x: AX + dx + 4, y: AY + 22 }, { x: AX + dx, y: AY + 22 }], `cross${dx}`, C.rustDark) +
              [-15, -5, 5, 15].map((dy) => `<circle cx="${AX + dx + 2}" cy="${AY + dy}" r="1.3" fill="${C.rustLight}"/>`).join('')).join(''),
        2,
      )
    : '';
  return opening + sheet(rubble) + grate + sheet(props, 2);
}

/**
 * A cave floor piece's canvas: three tiles across. The piece has no ground of its own (every tile
 * gets a sheet of earth paper first, see `caveGround`), only see-through marks that spill freely
 * over its neighbours and blend where they overlap, so the floor never shows a tile edge.
 */
export const CAVE_FLOOR_CANVAS = { w: 144, h: 144, anchor: { x: 72, y: 72 } };
const { x: FX, y: FY } = CAVE_FLOOR_CANVAS.anchor;

/** How many looks a cave floor comes in: far more than its tiles' variants, so no look is seen repeating. */
export const CAVE_FLOOR_LOOKS = 12;

/**
 * A tile's sheet of earth paper, under the cave floor's marks: plain, so the grain is all that shows
 * of it and no edge between two tiles can be seen. Bleeds a pixel past the tile like the forest's.
 */
function caveGround(kind: 'normal' | 'item' | 'boss') {
  return `<rect x="${AX - H - 1}" y="${AY - H - 1}" width="${TILE + 2}" height="${TILE + 2}" fill="${kind === 'boss' ? C.bossEarth : C.earth}"/>`;
}

/**
 * The cave floor's marks: broad faint mottling in the earth, and one thing of note placed anywhere
 * (reaching well past the tile): a sunk slab, a long hairline crack, a scatter of grit. The item
 * room's floor is broken paving from some old shrine, stones lying at all angles; the boss room's
 * earth is darker, raked by long gouges and holed by burrows.
 */
function caveFloor(look: number, kind: 'normal' | 'item' | 'boss') {
  const r = pieceRng('caveFloor', kind, look);
  const anywhere = (reach: number) => ({ x: FX + (r.next() - 0.5) * 2 * reach, y: FY + (r.next() - 0.5) * 2 * reach });
  // Mottling: big soft stains, mostly past the tile, that pool with the neighbours' into one ground.
  const stains = kind === 'boss' ? [C.earthDark, C.gouge, C.earthPatch, C.gouge] : [C.earthPatch, C.earthDark, C.slab, C.earthDark];
  const mottle = stains.map((color, i) => {
    const p = anywhere(26);
    return fill(blob(r, p.x, p.y, 16 + r.next() * 20, 12 + r.next() * 14, 11, 0.3, r.next() * 3), color, `opacity="${n(0.12 + r.next() * (i === 2 ? 0.08 : 0.14))}"`);
  }).join('');
  const crack = (reach: number, len: number) => {
    const p = anywhere(reach);
    let a = r.next() * Math.PI * 2;
    let d = `M${n(p.x)} ${n(p.y)}`;
    const branch: string[] = [];
    for (let s = 0, x = p.x, y = p.y; s < len; s += 6) {
      a += (r.next() - 0.5) * 0.9;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      d += `L${n(x)} ${n(y)}`;
      if (r.next() < 0.15) branch.push(`M${n(x)} ${n(y)}l${n(Math.cos(a + 1.1) * 5)} ${n(Math.sin(a + 1.1) * 5)}`);
    }
    return `<path d="${d}${branch.join('')}" stroke="${C.crack}" stroke-width="0.9" fill="none" opacity="0.7" stroke-linejoin="round"/>`;
  };
  const grit = (count: number, near = anywhere(30), spread = 30) =>
    Array.from({ length: count }, () => {
      const p = { x: near.x + (r.next() - 0.5) * spread, y: near.y + (r.next() - 0.5) * spread * 0.7 };
      return fill(cutPoly(r, ring(p.x, p.y, 1 + r.next() * 1.8, 0.8 + r.next() * 1.2, 5, r.next() * 3), 0.4), r.next() < 0.5 ? C.gougeRim : C.slab);
    }).join('');
  const stone = (p: Pt, rx: number, ry: number, color: string) =>
    fill(cutPoly(r, ring(p.x, p.y, rx, ry, 5 + Math.floor(r.next() * 3), r.next() * 3), 1.4), color) +
    `<path d="M${n(p.x - rx * 0.6)} ${n(p.y - ry * 0.55)}l${n(rx * 0.9)} ${n(-ry * 0.25)}" stroke="${C.slabLight}" stroke-width="1" opacity="0.5"/>`;

  // Most looks are quiet ground; anything that catches the eye is rare, so no mark is seen repeating.
  let marks = '';
  if (kind === 'normal') {
    const slab = () => stone(anywhere(30), 6 + r.next() * 6, 4 + r.next() * 4, C.slab);
    marks = [
      () => '', () => grit(2), () => '', () => grit(3),
      slab, () => slab() + crack(20, 12),
      () => crack(24, 40 + r.next() * 30), () => crack(30, 24),
      () => grit(5 + Math.floor(r.next() * 5)), () => grit(3) + crack(26, 14),
      () => '', () => crack(30, 18) + grit(2),
    ][look % CAVE_FLOOR_LOOKS]();
  } else if (kind === 'item') {
    // Broken paving from some old shrine: worn stones at all angles, many gone, a crack or two through them.
    const count = [0, 1, 2, 1, 0, 3, 1, 2, 0, 1, 2, 1][look % CAVE_FLOOR_LOOKS];
    const stones = Array.from({ length: count }, () => {
      const p = anywhere(32);
      return stone(p, 6 + r.next() * 8, 5 + r.next() * 6, r.next() < 0.5 ? C.flagstone : C.flagstoneLight);
    }).join('');
    marks = (stones ? sheet(stones) : '') + (r.next() < 0.4 ? crack(28, 16 + r.next() * 20) : '');
  } else {
    const gouge = () => {
      // A long gouge raked through the earth by something huge, curving as it went.
      const p = anywhere(20);
      const a = r.next() * Math.PI;
      const len = 26 + r.next() * 30;
      const [dx, dy] = [Math.cos(a) * len, Math.sin(a) * len];
      const bend = { x: p.x + (r.next() - 0.5) * 50, y: p.y + (r.next() - 0.5) * 50 };
      const d = `M${n(p.x - dx)} ${n(p.y - dy)}Q${n(bend.x)} ${n(bend.y)} ${n(p.x + dx)} ${n(p.y + dy)}`;
      return `<path d="${d}" stroke="${C.gougeRim}" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.25"/>` +
        `<path d="${d}" stroke="${C.gouge}" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.45"/>`;
    };
    const burrow = () => {
      const p = anywhere(20);
      const rad = 5 + r.next() * 4;
      return fill(blob(r, p.x, p.y + 1, rad + 5, (rad + 5) * 0.75, 10, 0.25), C.gougeRim, 'opacity="0.6"') +
        fill(blob(r, p.x, p.y, rad, rad * 0.7, 9, 0.18), C.gouge) +
        fill(blob(r, p.x + 1, p.y + 1.5, rad * 0.6, rad * 0.4, 7, 0.2), '#000', 'opacity="0.6"') +
        sheet(grit(3 + Math.floor(r.next() * 3), p, rad * 3));
    };
    marks = [
      () => '', () => grit(2), () => '', () => grit(3), () => '', () => crack(26, 30),
      gouge, () => gouge() + grit(2),
      burrow, () => grit(4),
      () => crack(20, 16) + grit(2), () => '',
    ][look % CAVE_FLOOR_LOOKS]();
  }
  return mottle + marks;
}

// ---------------------------------------------------------------------------------------------
// Terrain in the caves
// ---------------------------------------------------------------------------------------------

/** A spire of rock rising from `foot`: a dark flank, a lit left face, growth rings; `snapped` breaks its tip off. */
function rockSpire(r: Rng, x: number, foot: number, h: number, w: number, tone: RockTone, snapped = false) {
  const lean = (r.next() - 0.5) * w * 0.6;
  const at = (k: number, s: number) => ({ x: x + lean * k + s * w * (1 - k) ** 0.8 + (r.next() - 0.5) * 1.6, y: foot - h * k });
  const top = snapped ? [at(0.84, -1), { x: x + lean * 0.9 + 1, y: foot - h * 0.8 }, at(0.88, 1)] : [{ x: x + lean, y: foot - h }];
  const left = [at(0, -1), at(0.3, -1), at(0.6, -1)];
  const right = [at(0.6, 1), at(0.3, 1), at(0, 1)];
  const ridge = [0.6, 0.3, 0].map((k) => ({ x: x + lean * k - w * 0.12 * (1 - k), y: foot - h * k }));
  const rings = [0.28, 0.52].map((k) => {
    const [a, b] = [at(k, -1), at(k, 1)];
    return `<path d="M${n(a.x + 1)} ${n(a.y)}Q${n((a.x + b.x) / 2)} ${n(a.y + 2.5)} ${n(b.x - 1)} ${n(b.y)}" stroke="${tone.light}" stroke-width="1" fill="none" opacity="0.45"/>`;
  }).join('');
  const broken = snapped ? fill(polyPath(top), tone.light, 'opacity="0.85"') : '';
  return sheet(fill(polyPath([...left, ...top, ...right]), tone.dark) + fill(polyPath([...left, top[0], ...ridge]), tone.main) + rings + broken, 2);
}

/** Standing rock: a spire's lit face in pale stalactite paper, so it reads against the earth. */
const SPIRE_ROCK: RockTone = { dark: C.rockDark, main: C.stalactite, light: C.stalactiteLight };

/** A low heap of dark rock the spires stand in, jagged all round. */
const rockBed = (r: Rng, x: number, y: number, rx: number, ry: number) => sheet(fill(polyPath(jagged(r, x, y, rx, ry, 14, 0.18)), C.rockDeep));

/** A stalagmite: rock spires rising from a heap of rock, rubble at their feet; neighbours fuse into one formation. */
function stalagmite(variant: number) {
  const r = pieceRng('stalagmite', variant);
  const spires = [
    [{ dx: 0, dy: 0, h: 46, w: 16 }],
    [{ dx: -7, dy: -1, h: 40, w: 14 }, { dx: 10, dy: 3, h: 26, w: 11 }],
    [{ dx: -12, dy: -2, h: 22, w: 10 }, { dx: 3, dy: 1, h: 36, w: 17, snapped: true }],
    [{ dx: -9, dy: -2, h: 32, w: 13 }, { dx: 6, dy: 0, h: 48, w: 15 }, { dx: 15, dy: 4, h: 15, w: 8 }],
  ][variant % 4];
  const foot = AY + 8;
  return (
    contact(21, 7, 12) +
    rockBed(r, AX, foot - 1, 19, 7) +
    spires.map((s, i) => rockSpire(r, AX + s.dx, foot + s.dy, s.h, s.w, i % 2 ? OCHRE_ROCK : SPIRE_ROCK, 'snapped' in s)).join('') +
    [-14, 13].map((dx, i) => crag(r, AX + dx + r.next() * 4, foot + 5 + i * 2, 3.5 + r.next() * 2.5, ROCK)).join('')
  );
}

/** Where two stalagmites fuse into one formation: a ridge of rock across the seam, a squat spire rising out of it. */
function stalagmiteJoin(dir: 'across' | 'down') {
  const r = pieceRng('stalagmiteJoin', dir);
  const foot = AY + 8;
  const across = dir === 'across';
  return (
    rockBed(r, AX, foot - 1, across ? 22 : 11, across ? 7 : 24) +
    rockSpire(r, AX + (across ? 0 : -2), foot + (across ? 0 : 2), across ? 24 : 20, across ? 14 : 11, SPIRE_ROCK) +
    crag(r, AX + (across ? -6 : 5), foot + (across ? 5 : 10), 4 + r.next() * 2, OCHRE_ROCK)
  );
}

/** Crags heaped at x,y over `spread`: the biggest towards the back, front ones drawn last. */
function cragHeap(r: Rng, x: number, y: number, spread: Pt, count: number, big: number) {
  return Array.from({ length: count }, (_, i) => ({
    x: x + (r.next() - 0.5) * spread.x,
    y: y + (r.next() - 0.5) * spread.y - (i < 2 ? 5 : 0),
    rad: i < 2 ? big + r.next() * 3 : 5 + r.next() * 6,
  }))
    .sort((a, b) => a.y - b.y)
    .map((s) => crag(r, s.x, s.y, s.rad, r.next() < 0.3 ? OCHRE_ROCK : ROCK))
    .join('');
}

/** Grit spilled round a heap of rock. */
function grit(r: Rng, x: number, y: number, spread: Pt, count: number) {
  return sheet(Array.from({ length: count }, () => {
    const p = { x: x + (r.next() - 0.5) * spread.x, y: y + (r.next() - 0.5) * spread.y };
    return fill(cutPoly(r, ring(p.x, p.y, 1.2 + r.next() * 1.4, 1 + r.next(), 5, r.next() * 3), 0.4), r.next() < 0.5 ? C.rockLight : C.ochre);
  }).join(''));
}

/**
 * Loose rock: a crumbly heap of crags on a dark bed that fills its tile and spills a little past it,
 * grit round its foot; breaks after a few shots. Neighbours fuse into one rubble wall.
 */
function looseRock(variant: number) {
  const r = pieceRng('looseRock', variant);
  return (
    contact(26, 8, 12) +
    rockBed(r, AX, AY + 2, 27, 17) +
    grit(r, AX, AY + 10, { x: 54, y: 16 }, 7) +
    cragHeap(r, AX, AY, { x: 40, y: 24 }, 7 + (variant % 3), 13)
  );
}

/**
 * Where two loose rocks fuse into a rubble wall: a ridge of crags across the seam, on a bed of its
 * own, so the run reads as one wall; it goes as soon as either rock breaks, leaving ragged ends.
 */
function rubbleJoin(dir: 'across' | 'down') {
  const r = pieceRng('rubbleJoin', dir);
  const across = dir === 'across';
  return (
    rockBed(r, AX, AY + 2, across ? 16 : 22, across ? 15 : 14) +
    cragHeap(r, AX, AY + (across ? 0 : 2), across ? { x: 14, y: 22 } : { x: 30, y: 20 }, 5, 11)
  );
}

/**
 * Where a rubble wall meets the cave wall on its `side`: a heap of dark wall rock and crags spread
 * along the seam and leaning into the wall, so the rubble grows out of the wall with no gap between.
 */
function rubbleWallJoin(side: Direction) {
  const r = pieceRng('rubbleWallJoin', side);
  const toWall = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[side];
  const along = toWall.y ? { x: 30, y: 12 } : { x: 14, y: 30 };
  const c = { x: AX + toWall.x * 4, y: AY + toWall.y * 4 };
  const bedPts = jagged(r, c.x, c.y, along.x * 0.9, along.y * 0.9, 16, 0.2);
  return (
    sheet(fill(polyPath(bedPts), C.rockDeep)) +
    Array.from({ length: 6 }, (_, i) => ({
      x: c.x + (r.next() - 0.5) * along.x * 1.2,
      y: c.y + (r.next() - 0.5) * along.y * 1.1,
      rad: i < 2 ? 11 + r.next() * 3 : 5 + r.next() * 5,
    }))
      .sort((a, b) => a.y - b.y)
      .map((s) => {
        const roll = r.next();
        return crag(r, s.x, s.y, s.rad, roll < 0.3 ? DEEP_ROCK : roll < 0.5 ? OCHRE_ROCK : ROCK);
      })
      .join('')
  );
}

/** A boulder: one heavy round rock, lit from up-left, cracked and flecked with lichen; the thing that rolls and crushes. */
function boulder(variant: number) {
  const r = (part: string) => pieceRng('boulder', variant, part);
  const cy = AY - 5;
  const cracks = [0, 1].map((i) => {
    const cr = r(`crack${i}`);
    let [x, y] = [AX - 6 + cr.next() * 14, cy - 12 + i * 10];
    let d = `M${n(x)} ${n(y)}`;
    for (let s = 0; s < 3; s++) d += `L${n((x += 3 + cr.next() * 3))} ${n((y += (cr.next() - 0.3) * 6))}`;
    return `<path d="${d}" stroke="${C.rockDeep}" stroke-width="1.3" fill="none" opacity="0.85"/>`;
  }).join('');
  const lichen = [0, 1, 2].map((i) => ellipse(AX + [-10, 8, -2][i] + variant, cy + [4, -8, 11][i], 2.6 - i * 0.5, 1.8, C.ochre, 'opacity="0.75"')).join('');
  return (
    contact(22, 7, 14) +
    sheet(
      fill(blob(r('body'), AX, cy, 21, 19, 11, 0.07), C.rockDark) +
        fill(blob(r('lit'), AX - 3, cy - 4, 16, 14, 10, 0.1), C.rock) +
        fill(cutPoly(r('facet'), [{ x: AX - 13, y: cy - 6 }, { x: AX - 7, y: cy - 15 }, { x: AX + 2, y: cy - 16 }, { x: AX - 5, y: cy - 8 }], 0.8), C.rockLight, 'opacity="0.9"') +
        cracks + lichen,
      2,
    )
  );
}

/**
 * A crystal cluster: quartz prisms fanned out of one root, a smaller spray beside them, both half
 * buried in a crust of rock and earth with cracks running out into the floor; bounces shots.
 */
function crystalCluster(variant: number) {
  const r = pieceRng('crystalCluster', variant);
  const foot = AY + 8;
  const [big, small] = [[30, 3], [26, 2], [34, 3], [28, 4]][variant % 4];
  const side = [11, -12, 10, -9][variant % 4];
  return (
    contact(19, 6, 12) +
    floorCracks(r, AX, foot + 3, 30, 3 + (variant % 2)) +
    ellipse(AX, foot - 4, 20, 10, C.crystal, 'opacity="0.12"') +
    rockBed(r, AX, foot, 17, 7) +
    sheet(shards(`cluster${variant}`, AX - 2 + (variant % 2) * 4, foot, big, small), 2) +
    sheet(shards(`clusterFront${variant}`, AX + side, foot + 4, 13, 2), 2) +
    crust(r, AX + side * 0.25, foot + 4, 19, 6)
  );
}

/** A crystal spire: a tall column of rock studded with prisms, a cluster at its foot breaking out of a crust of rock and earth. */
function crystalSpire(variant: number) {
  const r = pieceRng('crystalSpire', variant);
  const foot = AY + 8;
  const h = 46 + (variant % 3) * 3;
  const footAt = AX + (variant % 2 ? -11 : 11);
  const studs = [0.35, 0.6, 0.82].slice(0, 2 + (variant % 2)).map((k, i) => {
    const s = i % 2 ? 1 : -1;
    return shards(`spireStud${variant}${i}`, AX + s * (7 - k * 5), foot - h * k + 4, 11 - k * 4, 2);
  });
  return (
    contact(20, 7, 12) +
    floorCracks(r, AX, foot + 4, 30, 3) +
    rockBed(r, AX, foot - 1, 18, 7) +
    rockSpire(r, AX, foot, h, 15, ROCK) +
    sheet(studs.join(''), 2) +
    sheet(shards(`spireFoot${variant}`, footAt, foot + 3, 16, 3), 2) +
    crust(r, (AX + footAt) / 2, foot + 4, 17, 5.5)
  );
}

/**
 * A cave mushroom seen at 3/4: a pale stem and a violet cap tipped toward the camera, so its gills
 * show under the rim. `frill` waves the rim (the hollow's shelf fungi); `spots` pale flecks on top.
 */
type Fungus = { cap: string; light: string };
const GLOWING: Fungus = { cap: C.fungus, light: C.fungusLight };
/** The hollow's plain shelf fungi: a duller violet than the glowshrooms, so the hazard stands out. */
const DULL: Fungus = { cap: C.fungusShade, light: C.fungus };

function mushroom(r: Rng, x: number, foot: number, stem: number, cap: number, frill = 0, spots = 3, tone: Fungus = GLOWING) {
  const w = Math.max(2.5, cap * 0.22);
  const capY = foot - stem;
  const stemSvg = fill(cutPoly(r, [{ x: x - w * 1.15, y: foot }, { x: x - w, y: capY + 2 }, { x: x + w, y: capY + 2 }, { x: x + w * 1.2, y: foot }], 0.4), C.bone) +
    fill(polyPath([{ x: x + w * 0.2, y: foot }, { x: x + w * 0.3, y: capY + 2 }, { x: x + w, y: capY + 2 }, { x: x + w * 1.2, y: foot }]), C.boneShade, 'opacity="0.8"');
  // The gills: the cap's underside, a pale disc ribbed from its centre, peeking out below the dome.
  const under = { x, y: capY + cap * 0.12 };
  const gills = ellipse(under.x, under.y, cap * 0.92, cap * 0.3, C.fungusGill) +
    Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI * (0.12 + (i / 8) * 0.76);
      return `<path d="M${n(under.x)} ${n(under.y - cap * 0.05)}L${n(under.x + Math.cos(a) * cap * 0.86)} ${n(under.y + Math.sin(a) * cap * 0.27)}" stroke="${C.fungusShade}" stroke-width="0.8" opacity="0.8"/>`;
    }).join('');
  const arc = Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI + (i / 8) * Math.PI;
    return { x: x + Math.cos(a) * cap, y: capY + Math.sin(a) * cap * 0.72 };
  });
  const rim = Array.from({ length: 7 }, (_, i) => ({ x: x + cap * (1 - (i + 1) / 4), y: capY + (frill ? (i % 2 ? frill : -frill * 0.3) : cap * 0.08) })).filter((p) => Math.abs(p.x - x) < cap);
  const dome = fill(cutPoly(r, [...arc, ...rim], 0.4), tone.cap) +
    fill(cutPoly(r, arc.slice(1, 5).concat([{ x: x - cap * 0.1, y: capY - cap * 0.25 }]), 0.4), tone.light, 'opacity="0.55"') +
    Array.from({ length: spots }, () => ellipse(x + (r.next() - 0.5) * cap * 1.1, capY - cap * (0.2 + r.next() * 0.35), 1 + cap * 0.07, 0.8 + cap * 0.05, C.fungusGill, 'opacity="0.9"')).join('');
  return sheet(stemSvg) + sheet(gills + dome, 2);
}

/** A glowshroom: a clump of violet fungi with their gills showing, in a faint glow; bursts into a stun cloud. */
function glowshroom(variant: number) {
  const r = pieceRng('glowshroom', variant);
  const foot = AY + 10;
  const caps = [
    [{ dx: -2, dy: 0, stem: 16, cap: 12 }, { dx: 11, dy: 4, stem: 9, cap: 7 }],
    [{ dx: -10, dy: 2, stem: 11, cap: 8 }, { dx: 4, dy: -1, stem: 18, cap: 12 }, { dx: 13, dy: 5, stem: 6, cap: 5 }],
    [{ dx: 1, dy: 0, stem: 14, cap: 14 }, { dx: -12, dy: 5, stem: 7, cap: 6 }],
    [{ dx: -7, dy: -1, stem: 17, cap: 11 }, { dx: 8, dy: 1, stem: 13, cap: 10 }, { dx: -1, dy: 6, stem: 5, cap: 5 }],
  ][variant % 4];
  return (
    contact(16, 5, 12) +
    ellipse(AX, AY - 2, 23, 16, C.fungusGlow, 'opacity="0.16"') +
    ellipse(AX, AY - 4, 14, 10, C.fungusGlow, 'opacity="0.14"') +
    caps.map((c) => mushroom(r, AX + c.dx, foot + c.dy, c.stem, c.cap)).join('')
  );
}

/** A giant mushroom: a tall pale stalk under a broad frilled violet cap, shelf fungi stepping up its stem. */
function giantMushroom(variant: number) {
  const r = pieceRng('giantMushroom', variant);
  const foot = AY + 10;
  const stem = 32 + (variant % 3) * 3;
  const shelf = (y: number, s: number, size: number) =>
    sheet(fill(cutPoly(r, [{ x: AX + s * 4, y: y - size * 0.3 }, { x: AX + s * (4 + size), y: y - size * 0.1 }, { x: AX + s * (5 + size * 0.8), y: y + size * 0.3 }, { x: AX + s * 4, y: y + size * 0.25 }], 0.4), C.fungusLight) +
      `<path d="M${n(AX + s * 5)} ${n(y + size * 0.15)}L${n(AX + s * (4 + size * 0.8))} ${n(y + size * 0.15)}" stroke="${C.fungusShade}" stroke-width="0.8"/>`);
  return (
    contact(20, 7, 12) +
    mushroom(r, AX, foot, stem, 23, 2.2, 5) +
    shelf(foot - 10, variant % 2 ? 1 : -1, 7) +
    (variant > 1 ? shelf(foot - 19, variant % 2 ? -1 : 1, 5) : '') +
    mushroom(r, AX + (variant % 2 ? -14 : 14), foot + 4, 6, 6, 0, 1)
  );
}

/** A mushroom cap: a low clump of frilled violet shelf fungi; breaks after a few shots. */
function mushroomCap(variant: number) {
  const r = pieceRng('mushroomCap', variant);
  const foot = AY + 10;
  const caps = [
    [{ dx: -8, dy: -2, stem: 6, cap: 11 }, { dx: 8, dy: 0, stem: 4, cap: 10 }, { dx: 0, dy: 5, stem: 3, cap: 8 }],
    [{ dx: -2, dy: -1, stem: 8, cap: 13 }, { dx: 12, dy: 4, stem: 3, cap: 7 }],
    [{ dx: 6, dy: -2, stem: 7, cap: 12 }, { dx: -9, dy: 2, stem: 4, cap: 9 }, { dx: 12, dy: 6, stem: 2, cap: 5 }],
    [{ dx: -6, dy: -1, stem: 5, cap: 10 }, { dx: 7, dy: -3, stem: 7, cap: 9 }, { dx: -1, dy: 5, stem: 3, cap: 9 }],
  ][variant % 4];
  return contact(18, 6, 12) + rockBed(r, AX, foot - 2, 16, 6) + caps.map((c) => mushroom(r, AX + c.dx, foot + c.dy, c.stem, c.cap, 1.6, 1, DULL)).join('');
}

/** A cave thorn vine: dark creepers curling out from a knot, bristling with crimson spikes; it reaches into neighbouring vines. */
function thornVine(variant: number) {
  const r = pieceRng('thornVine', variant);
  const spike = (p: Pt, a: number, len = 6) =>
    fill(`M${n(p.x + Math.cos(a + 1.57) * 2)} ${n(p.y + Math.sin(a + 1.57) * 2)}L${n(p.x + Math.cos(a) * len)} ${n(p.y + Math.sin(a) * len)}L${n(p.x - Math.cos(a + 1.57) * 2)} ${n(p.y - Math.sin(a + 1.57) * 2)}Z`, C.thornSpike);
  const vines = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 + variant * 0.8 + (r.next() - 0.5) * 0.4;
    const end = { x: AX + Math.cos(a) * 23, y: AY + Math.sin(a) * 16 };
    const mid = { x: (end.x + AX) / 2 + (r.next() - 0.5) * 14, y: (end.y + AY) / 2 + (r.next() - 0.5) * 10 };
    // A curl at its tip, turning back on itself.
    const curl = { x: end.x + Math.cos(a + 2) * 5, y: end.y + Math.sin(a + 2) * 5 - 2 };
    const on = (t: number) => ({ x: (1 - t) ** 2 * AX + 2 * t * (1 - t) * mid.x + t * t * end.x, y: (1 - t) ** 2 * AY + 2 * t * (1 - t) * mid.y + t * t * end.y });
    const spikes = [0.35, 0.65, 0.92].map((t) => spike(on(t), -Math.PI / 2 + (r.next() - 0.5) * 1.6));
    return `<path d="M${AX} ${AY}Q${n(mid.x)} ${n(mid.y)} ${n(end.x)} ${n(end.y)}Q${n(end.x + Math.cos(a) * 4)} ${n(end.y + Math.sin(a) * 4)} ${n(curl.x)} ${n(curl.y)}" stroke="${C.vine}" stroke-width="4.5" fill="none" stroke-linecap="round"/>` +
      `<path d="M${AX} ${AY - 1}Q${n(mid.x)} ${n(mid.y - 1)} ${n(end.x)} ${n(end.y - 1)}" stroke="${C.vineLight}" stroke-width="1.2" fill="none" opacity="0.7"/>` + spikes.join('');
  });
  const knot = fill(blob(r, AX, AY - 2, 11, 9, 9, 0.22), C.vine) + fill(blob(r, AX - 2, AY - 5, 6, 4, 7, 0.2), C.vineLight, 'opacity="0.8"') +
    [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2 + variant;
      return spike({ x: AX + Math.cos(a) * 8, y: AY - 2 + Math.sin(a) * 6 }, a - 0.5, 7);
    }).join('');
  return contact(19, 6, 10) + sheet(vines.join('')) + sheet(knot, 2);
}

/**
 * A piece of chasm: a dark fall with a crumbly lip on every side that has no chasm beyond it and the
 * far wall's rock face dropping away under the top lip. Where the chasm carries on the piece runs
 * to the tile's edge, and every lip meets the tile's edge at a fixed inset, so pieces fit like a
 * pond's. The rift's lip is torn red, glowing faintly where it breaks.
 */
function chasm(variant: number, mask: Mask, rift: boolean) {
  const r = pieceRng(rift ? 'rift' : 'chasm', variant, mask);
  const open = (bit: number) => !(mask & bit);
  const STEPS = 8;
  // Each open side's wobble, shared by every outline so lip and fall stay parallel; none at its ends.
  const wobble = [0, 1, 2, 3].map(() => Array.from({ length: STEPS + 1 }, (_, k) => (k === 0 || k === STEPS ? 0 : (r.next() - 0.5) * 2)));
  const SIDES = [
    { bit: UP, from: { x: AX - H, y: AY - H }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } },
    { bit: RIGHT, from: { x: AX + H, y: AY - H }, along: { x: 0, y: 1 }, inward: { x: -1, y: 0 } },
    { bit: DOWN, from: { x: AX + H, y: AY + H }, along: { x: -1, y: 0 }, inward: { x: 0, y: -1 } },
    { bit: LEFT, from: { x: AX - H, y: AY + H }, along: { x: 0, y: -1 }, inward: { x: 1, y: 0 } },
  ];
  /** Each side's points, `inset` px in from the tile's edge where open (wobbling by `rough`), a pixel past it where the chasm carries on. */
  const outline = (inset: number, rough: number) =>
    SIDES.map((s, i) => {
      const at = (bit: number) => (open(bit) ? inset : -1);
      const [prev, next] = [SIDES[(i + 3) % 4].bit, SIDES[(i + 1) % 4].bit];
      // Where two open sides meet the corner is cut off.
      const [start, end] = [at(prev) + (open(prev) && open(s.bit) ? 7 : 0), TILE - at(next) - (open(next) && open(s.bit) ? 7 : 0)];
      return Array.from({ length: STEPS + 1 }, (_, k) => {
        const t = start + ((end - start) * k) / STEPS;
        const d = at(s.bit) + (open(s.bit) ? wobble[i][k] * rough : 0);
        return { x: s.from.x + s.along.x * t + s.inward.x * d, y: s.from.y + s.along.y * t + s.inward.y * d };
      });
    });
  const shape = (inset: number, rough: number) => polyPath(outline(inset, rough).flat());
  const [lip, lipLight] = rift ? [C.riftLip, C.riftLight] : [C.rock, C.rockLight];

  // Crumbs of the lip: chips of rock along each open side.
  const chips = SIDES.filter((s) => open(s.bit)).map((s) => Array.from({ length: 2 + Math.floor(r.next() * 2) }, () => {
    const t = 8 + r.next() * (TILE - 16);
    const d = 1 + r.next() * 3;
    const p = { x: s.from.x + s.along.x * t + s.inward.x * d, y: s.from.y + s.along.y * t + s.inward.y * d };
    return fill(cutPoly(r, ring(p.x, p.y, 1.8 + r.next() * 1.6, 1.4 + r.next() * 1.2, 5, r.next() * 3), 0.5), r.next() < 0.5 ? lipLight : lip);
  }).join('')).join('');

  // The far wall: rock strata under the top lip, dropping away into the dark.
  let face = '';
  if (open(UP)) {
    const edge = outline(6, 1.4)[0];
    const band = (from: number, to: number, color: string, extra = '') =>
      fill(polyPath([...edge.map((p) => ({ x: p.x, y: p.y + from })), ...[...edge].reverse().map((p) => ({ x: p.x, y: p.y + to }))]), color, extra);
    // Clipped to the fall, so it never pokes past a cut corner.
    face = `<clipPath id="fall"><path d="${shape(6, 1.4)}"/></clipPath><g clip-path="url(#fall)">` +
      band(0, 6, rift ? C.riftLip : C.strataLight) + band(5, 11, C.rockDark) + band(10, 16, C.rockDeep, 'opacity="0.8"') + '</g>';
  }
  // The rift's torn edge glows faintly along every open lip.
  const glow = rift
    ? outline(5.5, 1.4).map((side, i) => (open(SIDES[i].bit) ? `<path d="M${side.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}" stroke="${C.riftGlow}" stroke-width="1.3" fill="none" opacity="0.75"/>` : '')).join('')
    : '';
  // The fall darkens by steps away from its open lips.
  const core = fill(shape(12, 2.5), '#000', 'opacity="0.3"') + fill(shape(19, 3), '#000', 'opacity="0.3"');
  return sheet(fill(shape(1, 2.2), lip) + chips) + fill(shape(6, 1.4), C.chasm) + face + core + glow;
}

// ---------------------------------------------------------------------------------------------
// Dressing
// ---------------------------------------------------------------------------------------------

export const DECOR_CANVAS = { w: 28, h: 24, anchor: { x: 14, y: 16 } };
const DX = DECOR_CANVAS.anchor.x;
const DY = DECOR_CANVAS.anchor.y;

/** Small paper cutouts lying on the floor; each sub-theme's decor kinds map to one of these. */
const DECOR_ART: Readonly<Record<string, (variant: number) => string>> = {
  grass: (v) => {
    const r = pieceRng('grass', v);
    return sheet([-5, 0, 5].map((dx, i) => fill(cutPoly(r, [{ x: DX + dx - 2, y: DY + 3 }, { x: DX + dx + (i - 1) * 3, y: DY - 9 - (i === 1 ? 3 : 0) }, { x: DX + dx + 2, y: DY + 3 }], 0.4), i === 1 ? P.grassLight : P.grass)).join(''));
  },
  leaves: (v) => {
    const r = pieceRng('leaf', v);
    return sheet([0, 1].map((i) => `<g transform="rotate(${n(r.next() * 180)} ${DX + i * 7 - 3} ${DY - i * 3})">${fill(blob(r, DX + i * 7 - 3, DY - i * 3, 5, 2.6, 7, 0.08), i ? P.fallenLeafRed : P.fallenLeaf)}</g>`).join(''));
  },
  flowers: (v) => {
    const r = pieceRng('flower', v);
    return sheet([{ x: -4, y: 0 }, { x: 5, y: -3 }].map((p, i) => [0, 1, 2, 3, 4].map((k) => {
      const a = (k / 5) * Math.PI * 2 + r.next() * 0.3;
      return `<circle cx="${n(DX + p.x + Math.cos(a) * 2.6)}" cy="${n(DY + p.y + Math.sin(a) * 2.6)}" r="1.9" fill="${i ? P.flowerPink : P.flower}"/>`;
    }).join('') + `<circle cx="${DX + p.x}" cy="${DY + p.y}" r="1.3" fill="${P.scarf}"/>`).join(''));
  },
  puddle: (v) => sheet(fill(blob(pieceRng('puddle', v), DX, DY, 10, 5, 9, 0.12), P.pondLight, 'opacity="0.55"')),
  reeds: (v) => {
    const r = pieceRng('reeds', v);
    return sheet([-4, 0, 4].map((dx, i) => `<path d="M${DX + dx} ${DY + 3}q${n(r.next() * 4 - 2)} -8 ${n(i - 1)} -14" stroke="${P.leaf}" stroke-width="1.8" fill="none" stroke-linecap="round"/>` + (i === 1 ? `<ellipse cx="${DX + dx}" cy="${DY - 9}" rx="1.8" ry="3.8" fill="${P.boarShade}"/>` : '')).join(''));
  },
  lilypad: (v) => sheet(fill(blob(pieceRng('lilypad', v), DX, DY, 7, 5, 8, 0.06), P.lily)),
  thornLitter: (v) => {
    const r = pieceRng('thornLitter', v);
    return sheet(`<path d="M${DX - 8} ${DY + 2}q8 -6 16 -2" stroke="${P.thorn}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
      [-4, 3].map((dx) => fill(`M${DX + dx - 1.5} ${DY - 1}L${DX + dx + r.next()} ${DY - 6}L${DX + dx + 1.5} ${DY - 1}Z`, P.thornSpike)).join(''));
  },
  berries: () => sheet([{ x: -3, y: 0 }, { x: 2, y: -2 }, { x: 3, y: 3 }].map((p) => `<circle cx="${DX + p.x}" cy="${DY + p.y}" r="2.4" fill="${P.thornSpike}"/>`).join('') + `<path d="M${DX - 2} ${DY - 3}l6 -4" stroke="${P.leaf}" stroke-width="1.4"/>`),
  pebbles: (v) => {
    const r = pieceRng('pebbles', v);
    return sheet([{ x: -4, y: 1, s: 3.4 }, { x: 4, y: -1, s: 2.4 }, { x: 1, y: 4, s: 1.8 }].map((p) => fill(blob(r, DX + p.x, DY + p.y, p.s, p.s * 0.75, 7, 0.1), P.pebble)).join(''));
  },

  // The caves'.
  shards: (v) => {
    const r = pieceRng('caveShards', v);
    // Broken crystal lying flat, and now and then a stub still standing.
    const lying = [{ x: -5, y: 1 }, { x: 4, y: -2 }, { x: 1, y: 4 }].slice(0, 2 + (v % 2)).map((p) => sliver(r, DX + p.x, DY + p.y, 4 + r.next() * 3, r.next() * Math.PI));
    return sheet(lying.join('') + (v >= 2 ? shards(`decor${v}`, DX + (v === 2 ? 6 : -6), DY + 1, 7, 2, true) : ''));
  },
  glints: (v) => {
    const r = pieceRng('glints', v);
    const spots = [{ x: -5, y: -1 }, { x: 5, y: 2 }, { x: 0, y: -6 }, { x: -1, y: 4 }].filter((_, i) => (i + v) % 4 !== 3);
    return spots.map((p, i) => {
      const at = { x: DX + p.x + (r.next() - 0.5) * 3, y: DY + p.y + (r.next() - 0.5) * 2 };
      return ellipse(at.x, at.y, 3.6, 2.6, C.crystal, 'opacity="0.18"') + sheet(sparkle(at.x, at.y, i ? 2.6 : 4, i ? C.crystal : C.crystalLight));
    }).join('');
  },
  spores: (v) => {
    const r = pieceRng('spores', v);
    const puffs = Array.from({ length: 5 + (v % 3) }, () => ({ x: DX + (r.next() - 0.5) * 16, y: DY - 2 + (r.next() - 0.5) * 10, s: 0.9 + r.next() * 1.1 }));
    return puffs.map((p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.s * 2.4)}" fill="${C.fungusGlow}" opacity="0.18"/>`).join('') +
      sheet(puffs.map((p, i) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.s)}" fill="${i % 3 ? C.fungusGill : C.fungusGlow}"/>`).join(''));
  },
  caps: (v) => {
    const r = pieceRng('caveCaps', v);
    const caps = [
      [{ dx: -4, dy: 2, stem: 4, cap: 5 }, { dx: 4, dy: 4, stem: 2.5, cap: 3.5 }],
      [{ dx: 1, dy: 3, stem: 5, cap: 6 }],
      [{ dx: 3, dy: 2, stem: 4, cap: 5 }, { dx: -5, dy: 4, stem: 2, cap: 3 }, { dx: -1, dy: 5, stem: 1.5, cap: 2.5 }],
      [{ dx: -2, dy: 3, stem: 3.5, cap: 4.5 }, { dx: 5, dy: 1, stem: 3, cap: 4 }],
    ][v % 4];
    return caps.map((c) => mushroom(r, DX + c.dx, DY + c.dy, c.stem, c.cap, 0, 1, DULL)).join('');
  },
  moss: (v) => {
    const r = pieceRng('caveMoss', v);
    const tufts = Array.from({ length: 5 }, () => ({ x: DX + (r.next() - 0.5) * 12, y: DY + (r.next() - 0.5) * 4 }));
    return sheet(fill(ragged(r, DX, DY + 1, 10, 4.5, 11, 0.3), C.moss) + tufts.map((t) => fill(ragged(r, t.x, t.y, 2.4, 1.6, 6, 0.3), C.mossLight)).join(''));
  },
  cracks: (v) => {
    const r = pieceRng('caveCracks', v);
    // A split in the ground with a hairline or two running off it, its lower lip catching the light.
    const pts: Pt[] = Array.from({ length: 5 }, (_, i) => ({ x: DX - 11 + i * 5.5, y: DY + (r.next() - 0.5) * 6 + (v % 2 ? i - 2 : 2 - i) * 1.2 }));
    const line = (ps: Pt[]) => `M${ps.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}`;
    const branches = [1, 3].slice(0, 1 + (v % 2)).map((i) => line([pts[i], { x: pts[i].x + (r.next() - 0.5) * 6, y: Math.min(DY + 6, pts[i].y + (r.next() < 0.5 ? -5 : 5)) }]));
    return `<path d="${line(pts.map((p) => ({ x: p.x, y: p.y + 0.9 })))}" stroke="${C.slabLight}" stroke-width="1.2" fill="none" opacity="0.6"/>` +
      `<path d="${line(pts)}" stroke="${C.crack}" stroke-width="1.8" fill="none" stroke-linejoin="round"/>` +
      branches.map((d) => `<path d="${d}" stroke="${C.crack}" stroke-width="0.9" fill="none"/>`).join('');
  },
  dust: (v) => {
    const r = pieceRng('caveDust', v);
    const grit = Array.from({ length: 6 }, () => `<circle cx="${n(DX + (r.next() - 0.5) * 18)}" cy="${n(DY + (r.next() - 0.5) * 8)}" r="${n(0.5 + r.next() * 0.6)}" fill="${C.rockLight}"/>`);
    return fill(blob(r, DX, DY, 11, 5, 9, 0.2), C.stalactiteLight, 'opacity="0.16"') + fill(blob(r, DX + 2, DY - 1, 6, 3, 8, 0.2), C.stalactiteLight, 'opacity="0.16"') + grit.join('');
  },
  bones: (v) => {
    const r = pieceRng('bones', v);
    const pieces = [
      bone(r, DX - 1, DY + 1, 15, -0.3) + bone(r, DX + 2, DY + 2, 10, 0.9),
      skull(DX - 4, DY - 1, false) + bone(r, DX + 5, DY + 3, 11, 0.4),
      bone(r, DX, DY, 17, 0.15) + bone(r, DX - 6, DY + 4, 6, 1.8) + bone(r, DX + 6, DY - 4, 5, -0.9),
      skull(DX + 1, DY, true),
    ][v % 4];
    return sheet(pieces);
  },
  pick: (v) => {
    const r = pieceRng('pick', v);
    const angle = [-24, 18, 158, -150][v % 4] + (r.next() - 0.5) * 10;
    // Built lying along x, the haft's butt to the left and the iron head across its end.
    const haft = fill(cutPoly(r, [{ x: -11, y: -1.1 }, { x: 7, y: -1.4 }, { x: 7, y: 1.4 }, { x: -11, y: 1.2 }], 0.2), C.timberLight) +
      fill(polyPath([{ x: -11, y: 0.3 }, { x: 7, y: 0.4 }, { x: 7, y: 1.4 }, { x: -11, y: 1.2 }]), C.timberDark, 'opacity="0.8"');
    const head = fill('M5 -9.5Q12.5 0 5 9.5Q9.6 0 5 -9.5Z', C.iron) + fill('M5.6 -7.6Q11 0 5.6 7.6Q9 0 5.6 -7.6Z', C.rust, 'opacity="0.75"') +
      fill(polyPath([{ x: 6.4, y: -2 }, { x: 9.4, y: -2 }, { x: 9.4, y: 2 }, { x: 6.4, y: 2 }]), C.rustDark);
    return sheet(group(haft + head, `translate(${DX} ${DY - 3}) rotate(${n(angle)}) scale(0.9)`));
  },
};

/**
 * A broken prism lying flat: parallel sides running to a point at one end and snapped off at the
 * other, its upper face lit and its lower in shade, a hard ridge between them and a pale break.
 */
function sliver(r: Rng, x: number, y: number, len: number, angle: number) {
  // Seen from above at a slant, so its run across the screen is foreshortened up and down.
  const along = { x: Math.cos(angle), y: Math.sin(angle) * 0.6 };
  const across = { x: -Math.sin(angle), y: Math.cos(angle) * 0.6 };
  const w = len * 0.3;
  const at = (a: number, b: number) => ({ x: x + along.x * a + across.x * b, y: y + along.y * a + across.y * b });
  const [tail, shoulder] = [-len * 0.5, len * 0.55];
  const tip = at(len, (r.next() - 0.5) * w * 0.4);
  const brk =[at(tail, -w), at(tail - w * 0.5, -w * 0.2), at(tail + w * 0.2, w * 0.3), at(tail - w * 0.2, w)];
  return fill(polyPath([...brk, at(shoulder, w), tip, at(shoulder, -w)]), C.crystalDeep) +
    fill(polyPath([at(tail, -w * 0.75), at(shoulder, -w * 0.75), tip, at(shoulder, 0), at(tail, 0)]), C.crystal) +
    fill(polyPath([at(tail, 0), at(shoulder, 0), tip, at(shoulder, w * 0.8), at(tail, w * 0.8)]), C.crystalShade) +
    fill(polyPath(brk), C.crystalLight, 'opacity="0.85"') +
    `<path d="M${n(at(tail, 0).x)} ${n(at(tail, 0).y)}L${n(at(shoulder, 0).x)} ${n(at(shoulder, 0).y)}L${n(tip.x)} ${n(tip.y)}" stroke="${C.crystalLight}" stroke-width="0.7" fill="none" opacity="0.9"/>`;
}

/** A four-pointed glint of light. */
const sparkle = (x: number, y: number, s: number, color: string) =>
  fill(`M${n(x)} ${n(y - s)}L${n(x + s * 0.22)} ${n(y - s * 0.22)}L${n(x + s)} ${n(y)}L${n(x + s * 0.22)} ${n(y + s * 0.22)}L${n(x)} ${n(y + s)}L${n(x - s * 0.22)} ${n(y + s * 0.22)}L${n(x - s)} ${n(y)}L${n(x - s * 0.22)} ${n(y - s * 0.22)}Z`, color);

/** An old bone: a shaft with a knuckled knob at each end, turned `angle` radians. */
function bone(r: Rng, x: number, y: number, len: number, angle: number) {
  const k = len / 2;
  const knob = (end: number) => [-1, 1].map((s) => `<circle cx="${n(end)}" cy="${n(s * 1.2)}" r="${n(1.5 + r.next() * 0.3)}" fill="${C.bone}"/>`).join('');
  const shaft = fill(cutPoly(r, [{ x: -k, y: -0.9 }, { x: k, y: -0.9 }, { x: k, y: 0.9 }, { x: -k, y: 0.9 }], 0.15), C.bone);
  const shade = `<path d="M${n(-k + 1)} 0.8L${n(k - 1)} 0.8" stroke="${C.boneShade}" stroke-width="0.8"/>`;
  return group(knob(-k) + knob(k) + shaft + shade, `translate(${n(x)} ${n(y)}) rotate(${n((angle * 180) / Math.PI)})`);
}

/** A skull lying in the dirt, its sockets dark; `jaw` adds the jawbone fallen beside it. */
function skull(x: number, y: number, jaw: boolean) {
  const r = pieceRng('skull', x, y);
  return fill(blob(r, x, y - 1, 5, 4.2, 9, 0.05), C.bone) +
    fill(polyPath([{ x: x - 3, y: y + 2 }, { x: x + 3, y: y + 2 }, { x: x + 2.4, y: y + 4.5 }, { x: x - 2.4, y: y + 4.5 }]), C.bone) +
    ellipse(x - 1.9, y - 0.2, 1.4, 1.2, C.boneHollow) + ellipse(x + 1.9, y - 0.2, 1.4, 1.2, C.boneHollow) +
    fill(`M${n(x - 0.5)} ${n(y + 1.6)}L${n(x)} ${n(y + 2.6)}L${n(x + 0.5)} ${n(y + 1.6)}Z`, C.boneHollow) +
    `<path d="M${n(x - 2)} ${n(y + 4.4)}L${n(x + 2)} ${n(y + 4.4)}" stroke="${C.boneShade}" stroke-width="0.7"/>` +
    (jaw ? `<path d="M${n(x + 5)} ${n(y + 5)}q3 2.4 6 -0.4" stroke="${C.bone}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` : '');
}

export const DECOR_KINDS = Object.keys(DECOR_ART);

// ---------------------------------------------------------------------------------------------

const OAK: Foliage = { main: '#23421f', light: '#2f5628', dark: '#152a12' };
const WILLOW: Foliage = { main: '#3a5a32', light: '#4a6c3e', dark: '#283f22' };

/** Looks whose neighbours grow into each other across the seam, and how. */
const JOIN_ART: Readonly<Record<string, (dir: 'across' | 'down') => string>> = {
  tree: (d) => canopyJoin(TREE, d),
  oak: (d) => canopyJoin(OAK, d),
  willow: (d) => canopyJoin(WILLOW, d),
  'thorn bush': (d) => vineJoin(d),
  stalagmite: (d) => stalagmiteJoin(d),
  'loose rock': (d) => rubbleJoin(d),
  'thorn vine': (d) => vineJoin(d, { stem: C.vine, spike: C.thornSpike, key: 'caveVineJoin' }),
};
export const JOIN_LOOKS = Object.keys(JOIN_ART);
/** Looks that grow out of the room's wall where they touch it, one join per side the wall is on. */
const WALL_JOIN_ART: Readonly<Record<string, (side: Direction) => string>> = {
  'loose rock': (side) => rubbleWallJoin(side),
};
export const WALL_JOIN_LOOKS = Object.keys(WALL_JOIN_ART);
export const WALL_JOIN_SIDES: readonly Direction[] = ['up', 'right', 'down', 'left'];
/** Looks drawn as pieces that fit their neighbours (a pond's banks, a chasm's lip): each has a piece per neighbour mask. */
export const MASKED_LOOKS = ['pond', 'bog', 'chasm', 'rift'];

/** How each tile look is drawn, by its look name (the forest's, then the caves'). Looks sub-themes override get their own. */
type TileDraw = (variant: number, mask: Mask) => string;
const TILE_ART: Readonly<Record<string, TileDraw>> = {
  tree: (v) => tree(v),
  oak: (v) => tree(v, OAK),
  willow: (v) => tree(v, WILLOW),
  bush: (v) => bush(v),
  'reed clump': (v) => bush(v, { main: '#8a9a4a', light: '#a8b85a', dark: '#6a7a38' }),
  'bramble bush': (v) => bush(v, { main: '#4a6a2a', light: '#6a8a3a', dark: '#3a5020' }) + sheet([0, 1, 2].map((i) => `<circle cx="${AX - 8 + i * 8}" cy="${AY - 2 + (i % 2) * 5}" r="2.2" fill="${P.thornSpike}"/>`).join('')),
  pond: (v, m) => pond(v, m),
  bog: (v, m) => pond(v, m, { water: '#3a4a2a', light: '#5a6a3a', deep: '#2a361e' }),
  'thorn bush': (v) => thorn(v),
  'rolling log': (v) => log(v),
  'mirror stone': (v) => mirrorStone(v),
  puffball: (v) => puffball(v),
  stalagmite: (v) => stalagmite(v),
  'loose rock': (v) => looseRock(v),
  chasm: (v, m) => chasm(v, m, false),
  'thorn vine': (v) => thornVine(v),
  boulder: (v) => boulder(v),
  'crystal cluster': (v) => crystalCluster(v),
  glowshroom: (v) => glowshroom(v),
  'crystal spire': (v) => crystalSpire(v),
  'giant mushroom': (v) => giantMushroom(v),
  'mushroom cap': (v) => mushroomCap(v),
  rift: (v, m) => chasm(v, m, true),
};

/** Whether a tile look has paper art (anything else keeps its plain shape). */
export const hasTileArt = (look: string) => look in TILE_ART;
export const TILE_LOOKS = Object.keys(TILE_ART);

/** Every paper terrain SVG. */
export const terrainSvg = {
  tile: (look: string, variant: number, mask: Mask) => tileDoc(TILE_ART[look](variant, mask), 19 + variant),
  join: (look: string, dir: 'across' | 'down') => tileDoc(JOIN_ART[look](dir), 61),
  wallJoin: (look: string, side: Direction) => tileDoc(WALL_JOIN_ART[look](side), 63),
  wall: (side: WallSide, variant: number, style: WallStyle = 'hedge') =>
    style === 'hedge'
      ? tileDoc(hedge(side, variant), 23)
      : svgDoc(CAVE_WALL_CANVAS.w, CAVE_WALL_CANVAS.h, rockWall(side, variant, style === 'veined'), 23),
  door: (side: 'top' | 'bottom' | 'left' | 'right', locked: boolean, shell: Shell = 'forest') =>
    tileDoc(shell === 'caves' ? mineDoor(side, locked) : doorway(side, locked), 29),
  floor: (kind: 'normal' | 'item' | 'boss', variant: number, shell: Shell = 'forest') =>
    shell === 'caves'
      ? svgDoc(CAVE_FLOOR_CANVAS.w, CAVE_FLOOR_CANVAS.h, caveFloor(variant, kind), 31 + variant, CAVE_FLOOR_GRAIN)
      : tileDoc(floorTile(variant, kind), 31 + variant),
  /** The paper ground under a floor that has one (`hasGround`). */
  ground: (kind: 'normal' | 'item' | 'boss') => tileDoc(caveGround(kind), 43, CAVE_FLOOR_GRAIN),
  decor: (kind: string, variant: number) => svgDoc(DECOR_CANVAS.w, DECOR_CANVAS.h, (DECOR_ART[kind] ?? DECOR_ART.pebbles)(variant), 37),
};
