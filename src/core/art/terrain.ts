import { PAPER as P } from './palette';
import { DOWN, LEFT, RIGHT, UP, type Mask } from './autotile';
import { blob, cutPoly, fill, n, pieceRng, polyPath, ragged, ring, sheet, svgDoc } from './svg';

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
const tileDoc = (body: string, seed: number) => svgDoc(TILE_CANVAS.w, TILE_CANVAS.h, body, seed);


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

function vineJoin(dir: 'across' | 'down') {
  const r = pieceRng('vineJoin', dir);
  const [dx, dy] = dir === 'across' ? [26, 0] : [0, 26];
  const bend = (r.next() - 0.5) * 10;
  const spikes = [-0.4, 0.3].map((k) => {
    const s = { x: AX + dx * k + (dir === 'down' ? bend / 2 : 0), y: AY + dy * k + (dir === 'across' ? bend / 2 : 0) };
    return fill(`M${n(s.x - 2)} ${n(s.y)}L${n(s.x)} ${n(s.y - 6)}L${n(s.x + 2)} ${n(s.y)}Z`, P.thornSpike);
  });
  return sheet(
    `<path d="M${AX - dx} ${AY - dy}Q${n(AX + (dir === 'down' ? bend : 0))} ${n(AY + (dir === 'across' ? bend : 0))} ${AX + dx} ${AY + dy}" stroke="${P.thorn}" stroke-width="4.5" fill="none" stroke-linecap="round"/>` + spikes.join(''),
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

/** A few hard-cut crystal shards: an icy body, a pale facet and a deep shaded side. */
function shards(key: string, x: number, y: number, size: number, count: number) {
  const r = pieceRng('shards', key);
  return Array.from({ length: count }, (_, i) => {
    const lean = (i - (count - 1) / 2) * 0.45 + (r.next() - 0.5) * 0.3;
    const h = size * (0.7 + r.next() * 0.5) * (i === Math.floor(count / 2) ? 1.25 : 1);
    const w = size * 0.32;
    const bx = x + (i - (count - 1) / 2) * w * 1.4;
    const tip = { x: bx + Math.sin(lean) * h, y: y - Math.cos(lean) * h };
    const body = cutPoly(r, [{ x: bx - w, y }, { x: bx - w * 0.8, y: y - h * 0.55 }, tip, { x: bx + w * 0.8, y: y - h * 0.5 }, { x: bx + w, y }], 0.3);
    const facet = polyPath([{ x: bx - w * 0.2, y }, tip, { x: bx + w * 0.8, y: y - h * 0.5 }, { x: bx + w, y }]);
    const glint = polyPath([{ x: bx - w * 0.6, y: y - h * 0.15 }, { x: bx - w * 0.5, y: y - h * 0.5 }, { x: tip.x - w * 0.15, y: tip.y + h * 0.18 }, { x: bx - w * 0.15, y: y - h * 0.2 }]);
    return fill(body, C.crystal) + fill(facet, C.crystalShade) + fill(glint, C.crystalLight, 'opacity="0.85"');
  }).join('');
}

/** A jagged crystal vein across rock: a dark seam with the icy crystal showing along it. */
function vein(r: ReturnType<typeof pieceRng>, from: { x: number; y: number }, to: { x: number; y: number }) {
  const steps = 4;
  const pts = Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps + (i % steps ? (r.next() - 0.5) * 7 : 0),
    y: from.y + ((to.y - from.y) * i) / steps + (i % steps ? (r.next() - 0.5) * 7 : 0),
  }));
  const d = `M${pts.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}`;
  return `<path d="${d}" stroke="${C.crystalDeep}" stroke-width="2.8" fill="none" stroke-linejoin="bevel"/>` +
    `<path d="${d}" stroke="${C.crystal}" stroke-width="1.1" fill="none" stroke-linejoin="bevel"/>`;
}

/**
 * A cave wall tile: a mass of layered rock slabs seen from above. The top wall also shows its
 * front face, stacked bands of rock strata, with the odd stalactite hanging from the lip.
 * `veined` rock has crystal seams running through it and shards breaking out of it.
 */
function rockWall(side: WallSide, variant: number, veined: boolean) {
  const r = (part: string) => pieceRng('rockWall', side, variant, part);
  const [x0, x1] = [AX - H - 5, AX + H + 5];
  let face = '';
  if (side === 'top') {
    // Stacked strata, each layer a ledge over the one below; drawn bottom up so each casts its shadow down.
    const tops = [AY - 6, AY + 1, AY + 7, AY + 13, AY + 18];
    const tones = [C.strataDark, C.strataLight, C.strata, C.ochre, C.strataLight];
    const bands = tops.map((top, i) => {
      const br = r(`band${i}`);
      const bottom = i + 1 < tops.length ? tops[i + 1] + 2 : AY + H;
      const edge = Array.from({ length: 11 }, (_, k) => ({ x: x0 + (k * (x1 - x0)) / 10, y: top + (br.next() - 0.5) * 3.5 }));
      return sheet(fill(polyPath([...edge, { x: x1, y: bottom }, { x: x0, y: bottom }]), tones[i]) +
        `<path d="M${x0 + 3} ${n(top + 2.5)}h${x1 - x0 - 6}" stroke="${C.strataDark}" stroke-width="0.8" stroke-dasharray="${5 + i} ${3 + i}" opacity="0.5"/>`);
    });
    // Where the face meets the floor, it throws a dark line.
    const foot = fill(`M${x0} ${AY + H - 2.5}L${x1} ${AY + H - 2.5}L${x1} ${AY + H}L${x0} ${AY + H}Z`, C.rockDeep);
    // Stalactites hang from the lip of the rock on odd variants, over the face.
    const drips = variant % 2
      ? [-13 + (variant % 3) * 4, 8].map((dx, i) => {
          const len = 18 + i * 5 + variant;
          const top = AY - 7;
          return fill(cutPoly(r(`drip${i}`), [{ x: AX + dx - 5, y: top }, { x: AX + dx + 5, y: top }, { x: AX + dx + 2, y: top + len * 0.55 }, { x: AX + dx + 0.5, y: top + len }], 0.4), C.stalactite) +
            fill(`M${n(AX + dx - 3)} ${top}L${n(AX + dx - 0.5)} ${top}L${n(AX + dx + 0.3)} ${n(top + len * 0.85)}Z`, C.stalactiteLight);
        }).join('')
      : '';
    const faceVeins = veined ? sheet(vein(r('faceVein'), { x: AX - 20, y: AY + 20 }, { x: AX + 14, y: AY + 3 }) + shards(`face${variant}`, AX + 12, AY + 21, 11, 3)) : '';
    face = [...bands].reverse().join('') + sheet(foot) + faceVeins + (drips ? sheet(drips, 2) : '');
  }
  const cy = side === 'top' ? AY - 13 : AY;
  // A bed of rock under the slabs, reaching into the neighbouring wall tiles so the wall reads as one mass.
  const bed = fill(cutPoly(r('bed'), [
    { x: x0, y: AY - H - 4 }, { x: AX, y: AY - H - 5 }, { x: x1, y: AY - H - 4 },
    { x: x1, y: side === 'top' ? AY - 5 : AY + H + 3 }, { x: AX, y: side === 'top' ? AY - 4 : AY + H + 4 }, { x: x0, y: side === 'top' ? AY - 5 : AY + H + 3 },
  ], 2.5), C.rockDeep);
  const slabs = [
    { x: -14, y: 2, rx: 19, ry: 16, c: C.rockDark, turn: 0.2 },
    { x: 14, y: 2, rx: 19, ry: 16, c: C.rockDark, turn: 0.7 },
    { x: 0, y: -3, rx: 21, ry: 16, c: C.rock, turn: variant * 0.4 },
    { x: -9 + (variant % 3) * 6, y: -9, rx: 11, ry: 7, c: C.rockLight, turn: 0.3 + variant },
  ];
  const mass = slabs.map((s, i) => sheet(fill(cutPoly(r(`s${i}`), ring(AX + s.x, cy + s.y, s.rx, s.ry, i < 2 ? 8 : 7, s.turn), 2.4), s.c), i < 2 ? 1 : 2)).join('');
  // Strata lines scored across the top slab.
  const lines = [-2, 5].map((dy, i) => `<path d="M${AX - 15} ${cy + dy}q${8 + i * 3} ${-3 + i * 2} ${16} 0t14 ${1 - i * 2}" stroke="${C.rockDark}" stroke-width="1.4" fill="none" opacity="0.7"/>`).join('');
  const crystal = veined
    ? sheet(vein(r('vein'), { x: AX - 18, y: cy + 8 }, { x: AX + 16, y: cy - 6 }) + (variant % 2 ? '' : shards(`top${side}${variant}`, AX + 5 - (variant % 3) * 5, cy + 2, 12, 3)))
    : '';
  return face + sheet(bed) + mass + sheet(lines) + crystal;
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

/** A bone: a shaft with a knuckle at each end. */
const bone = (x: number, y: number, len: number, angle: number) => {
  const [dx, dy] = [Math.cos(angle) * len / 2, Math.sin(angle) * len / 2];
  return `<path d="M${n(x - dx)} ${n(y - dy)}L${n(x + dx)} ${n(y + dy)}" stroke="${C.bone}" stroke-width="2.2" stroke-linecap="round"/>` +
    [-1, 1].map((s) => `<circle cx="${n(x + s * dx)}" cy="${n(y + s * dy)}" r="1.9" fill="${C.bone}"/>`).join('');
};

/**
 * The cave floor, kept inside its tile so any mix of variants tiles seamlessly: packed earth with
 * stone slabs and hairline cracks; the item room's a worn flagstone patch, an old shrine; the boss
 * room's darker earth gouged by tunnel trails and strewn with bones and crystal shards.
 */
function caveFloor(variant: number, kind: 'normal' | 'item' | 'boss') {
  const r = (part: string) => pieceRng('caveFloor', kind, variant, part);
  const x0 = AX - H;
  const y0 = AY - H;
  const base = kind === 'boss' ? C.bossEarth : C.earth;
  const patches = [0, 1].map((i) => {
    const pr = r(`p${i}`);
    return fill(blob(pr, x0 + 12 + pr.next() * 24, y0 + 12 + pr.next() * 24, 8 + pr.next() * 5, 6 + pr.next() * 4, 8, 0.15), i ? C.earthDark : C.earthPatch, 'opacity="0.7"');
  });
  const crack = (cr: ReturnType<typeof pieceRng>) => {
    const sx = x0 + 8 + cr.next() * 18;
    const sy = y0 + 10 + cr.next() * 26;
    return `<path d="M${n(sx)} ${n(sy)}l${n(5 + cr.next() * 4)} ${n(cr.next() * 4 - 2)}l${n(4 + cr.next() * 3)} ${n(3 + cr.next() * 3)}m-4 -2l2 -5" stroke="${C.crack}" stroke-width="0.9" fill="none" opacity="0.75"/>`;
  };
  let marks = '';
  if (kind === 'normal') {
    // A flat stone slab sunk in the earth on half the tiles, cut to a different shape each time.
    const sr = r('slab');
    const [sx, sy] = [x0 + 15 + sr.next() * 18, y0 + 15 + sr.next() * 18];
    const [rx, ry] = [6 + sr.next() * 5, 4 + sr.next() * 3];
    const slab = variant % 2 === 0
      ? fill(cutPoly(sr, ring(sx, sy, rx, ry, 5 + (variant % 3), sr.next() * 3), 1.4), C.slab, 'opacity="0.85"') +
        `<path d="M${n(sx - rx * 0.6)} ${n(sy - ry * 0.55)}l${n(rx * 0.9)} ${n(-ry * 0.25)}" stroke="${C.slabLight}" stroke-width="1" opacity="0.6"/>`
      : '';
    marks = slab + crack(r('crack0')) + (variant === 3 ? crack(r('crack1')) : '');
  } else if (kind === 'item') {
    // Four worn flagstones with earth between them, their edges rounded off by feet.
    marks = [0, 1].flatMap((i) => [0, 1].map((j) => {
      const fr = r(`flag${i}${j}`);
      const [fx, fy] = [x0 + 3 + i * 22, y0 + 3 + j * 22];
      return fill(cutPoly(fr, [{ x: fx, y: fy }, { x: fx + 19, y: fy }, { x: fx + 19, y: fy + 19 }, { x: fx, y: fy + 19 }], 1.3), (i + j + variant) % 2 ? C.flagstone : C.flagstoneLight) +
        (fr.next() < 0.5 ? `<path d="M${n(fx + 2 + fr.next() * 6)} ${n(fy + 3 + fr.next() * 6)}l${n(4 + fr.next() * 4)} ${n(3 + fr.next() * 3)}l${n(fr.next() * 3)} ${n(4 + fr.next() * 3)}" stroke="${C.crack}" stroke-width="0.9" fill="none" opacity="0.6"/>` : '');
    })).join('');
  } else {
    const gr = r('gouge');
    const trail = variant % 2 === 0
      ? (() => {
          const y = y0 + 14 + gr.next() * 20;
          const d = `M${x0 + 3} ${n(y)}q${n(12 + gr.next() * 6)} ${n(-8 + gr.next() * 4)} 21 -1t21 ${n(gr.next() * 6 - 3)}`;
          return `<path d="${d}" stroke="${C.gougeRim}" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.6"/>` +
            `<path d="${d}" stroke="${C.gouge}" stroke-width="5.5" fill="none" stroke-linecap="round" opacity="0.85"/>`;
        })()
      : '';
    const litter = variant % 2 === 1 || variant === 2
      ? bone(x0 + 14 + gr.next() * 8, y0 + 12 + gr.next() * 8, 10, gr.next() * Math.PI) +
        (variant === 3 ? bone(x0 + 30, y0 + 32, 7, 0.4) : '') +
        shards(`floor${variant}`, x0 + 32 + gr.next() * 6, y0 + 36, 5, 2)
      : '';
    marks = trail + crack(r('crack0')) + (litter ? sheet(litter) : '');
  }
  return `<rect x="${x0 - 1}" y="${y0 - 1}" width="${TILE + 2}" height="${TILE + 2}" fill="${base}"/>` + patches.join('') + marks;
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
};

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
};
export const JOIN_LOOKS = Object.keys(JOIN_ART);
/** Looks drawn as pieces that fit their neighbours (a pond's banks): each has a piece per neighbour mask. */
export const MASKED_LOOKS = ['pond', 'bog'];

/** How each forest tile look is drawn, by its look name. Looks sub-themes override get their own. */
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
};

/** Whether a tile look has paper art (anything else keeps its plain shape). */
export const hasTileArt = (look: string) => look in TILE_ART;
export const TILE_LOOKS = Object.keys(TILE_ART);

/** Every paper terrain SVG. */
export const terrainSvg = {
  tile: (look: string, variant: number, mask: Mask) => tileDoc(TILE_ART[look](variant, mask), 19 + variant),
  join: (look: string, dir: 'across' | 'down') => tileDoc(JOIN_ART[look](dir), 61),
  wall: (side: WallSide, variant: number, style: WallStyle = 'hedge') =>
    tileDoc(style === 'hedge' ? hedge(side, variant) : rockWall(side, variant, style === 'veined'), 23),
  door: (side: 'top' | 'bottom' | 'left' | 'right', locked: boolean, shell: Shell = 'forest') =>
    tileDoc(shell === 'caves' ? mineDoor(side, locked) : doorway(side, locked), 29),
  floor: (kind: 'normal' | 'item' | 'boss', variant: number, shell: Shell = 'forest') =>
    tileDoc(shell === 'caves' ? caveFloor(variant, kind) : floorTile(variant, kind), 31 + variant),
  decor: (kind: string, variant: number) => svgDoc(DECOR_CANVAS.w, DECOR_CANVAS.h, (DECOR_ART[kind] ?? DECOR_ART.pebbles)(variant), 37),
};
