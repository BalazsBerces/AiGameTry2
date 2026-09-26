import { PAPER as P } from './palette';
import { blob, cutPoly, fill, n, pieceRng, sheet, smoothPath, svgDoc } from './svg';

/** A heart outline centred in a `s`-px square. */
const heartPath = (cx: number, cy: number, s: number) =>
  smoothPath([
    { x: cx, y: cy - s * 0.22 },
    { x: cx + s * 0.22, y: cy - s * 0.45 },
    { x: cx + s * 0.48, y: cy - s * 0.3 },
    { x: cx + s * 0.42, y: cy + s * 0.05 },
    { x: cx, y: cy + s * 0.46 },
    { x: cx - s * 0.42, y: cy + s * 0.05 },
    { x: cx - s * 0.48, y: cy - s * 0.3 },
    { x: cx - s * 0.22, y: cy - s * 0.45 },
  ]);

export const HEART_CANVAS = 28;

/** A paper heart: `full`, `half` (the left half red) or `empty` (just its dark container). */
function heart(fillLevel: 'full' | 'half' | 'empty') {
  const c = HEART_CANVAS / 2 - 1;
  const d = heartPath(c, c, 22);
  const clip = `<clipPath id="half"><rect x="0" y="0" width="${c}" height="${HEART_CANVAS}"/></clipPath>`;
  const red = fill(d, P.heart) + fill(blob(pieceRng('heart', 'shine'), c - 5, c - 4, 3.2, 2.2, 7, 0.1), P.heartLight);
  return (
    sheet(fill(d, P.heartEmpty)) +
    (fillLevel === 'full' ? sheet(red) : fillLevel === 'half' ? `${clip}<g clip-path="url(#half)">${sheet(red)}</g>` : '')
  );
}

export const ICON_CANVAS = 26;

function key() {
  const r = pieceRng('key');
  return sheet(
    `<circle cx="9" cy="9" r="6" fill="${P.key}"/><circle cx="9" cy="9" r="2.6" fill="${P.heartEmpty}"/>` +
      fill(cutPoly(r, [{ x: 12, y: 11 }, { x: 22, y: 21 }, { x: 20, y: 23 }, { x: 10, y: 13 }], 0.3), P.key) +
      fill(cutPoly(r, [{ x: 17, y: 16 }, { x: 20, y: 13 }, { x: 22, y: 15 }, { x: 19, y: 18 }], 0.3), P.keyShade),
  );
}

function bomb() {
  const r = pieceRng('bomb');
  return (
    sheet(fill(blob(r, 12, 15, 8.5, 8.5, 10, 0.03), P.bomb) + fill(blob(r, 9, 12, 3, 2.2, 7, 0.1), P.bombLight)) +
    sheet(`<path d="M16 8q3 -5 7 -3" stroke="${P.creamShade}" stroke-width="1.8" fill="none" stroke-linecap="round"/>` +
      fill(cutPoly(r, [{ x: 22, y: 1 }, { x: 24, y: 4 }, { x: 25.5, y: 2 }, { x: 25, y: 6 }, { x: 21, y: 6 }], 0.3), P.fuse))
  );
}

/** The torn scrap of paper the minimap is drawn on: straight cut sides, ragged top and bottom. */
function scrap(w: number, h: number) {
  const r = pieceRng('scrap', w, h);
  const top = Array.from({ length: 12 }, (_, i) => ({ x: 4 + (i / 11) * (w - 8), y: 4 + r.next() * 3 }));
  const bottom = Array.from({ length: 12 }, (_, i) => ({ x: w - 4 - (i / 11) * (w - 8), y: h - 5 - r.next() * 3 }));
  const d = `M${[...top, ...bottom].map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`;
  return sheet(fill(d, P.scrap) + `<path d="${d}" fill="none" stroke="${P.scrapShade}" stroke-width="1"/>`, 2);
}

/** A glowing paper shot: the player's a pale blue four-point star, an enemy's an orange seed. */
function shot(kind: 'player' | 'enemy', radius: number) {
  const s = SHOT_CANVAS / 2;
  const r = pieceRng('shot', kind);
  if (kind === 'player') {
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const k = i % 2 ? radius * 0.55 : radius * 1.25;
      return { x: s + Math.cos(a) * k, y: s + Math.sin(a) * k };
    });
    return sheet(fill(cutPoly(r, pts, 0.3), P.shot) + `<circle cx="${s}" cy="${s}" r="${n(radius * 0.4)}" fill="${P.shotCore}"/>`);
  }
  return sheet(fill(blob(r, s, s, radius * 1.1, radius * 0.85, 8, 0.05), P.enemyShot) + fill(blob(r, s - radius * 0.3, s - radius * 0.3, radius * 0.45, radius * 0.3, 7, 0.1), P.enemyShotCore));
}

export const SHOT_CANVAS = 28;
/** The minimap's paper scrap: a little larger than the map window, which sits inside it. */
export const SCRAP_SIZE = { w: 166, h: 100 };

/** Pickups and status marks are drawn on this square canvas, centred on the pickup. */
export const PICKUP_CANVAS = 48;
const C = PICKUP_CANVAS / 2;

/** A chest seen at 3/4: its lid's top and the box's front face, bound in iron (gold when locked); open, its lid thrown back. */
function chest(kind: 'plain' | 'locked' | 'open') {
  const r = pieceRng('chest', kind);
  const wood = kind === 'locked' ? '#8a6a2a' : '#6a4a2a';
  const band = kind === 'locked' ? P.key : '#3a3a42';
  const box = cutPoly(r, [{ x: C - 16, y: C - 2 }, { x: C + 16, y: C - 2 }, { x: C + 15, y: C + 13 }, { x: C - 15, y: C + 13 }], 0.5);
  const lid = kind === 'open'
    ? cutPoly(r, [{ x: C - 16, y: C - 14 }, { x: C + 16, y: C - 14 }, { x: C + 16, y: C - 4 }, { x: C - 16, y: C - 4 }], 0.5)
    : cutPoly(r, [{ x: C - 17, y: C - 11 }, { x: C + 17, y: C - 11 }, { x: C + 16, y: C - 1 }, { x: C - 16, y: C - 1 }], 0.5);
  const inside = kind === 'open' ? fill(`M${C - 14} ${C - 4}L${C + 14} ${C - 4}L${C + 13} ${C + 1}L${C - 13} ${C + 1}Z`, P.ink) : '';
  const bands = [-9, 9].map((dx) => fill(`M${C + dx - 2} ${C - 11}L${C + dx + 2} ${C - 11}L${C + dx + 2} ${C + 13}L${C + dx - 2} ${C + 13}Z`, band)).join('');
  const lock = kind === 'locked'
    ? sheet(fill(`M${C - 4} ${C - 4}L${C + 4} ${C - 4}L${C + 4} ${C + 5}L${C - 4} ${C + 5}Z`, P.key) + `<circle cx="${C}" cy="${C}" r="1.4" fill="${P.ink}"/>`)
    : '';
  return sheet(fill(box, wood) + inside, 2) + sheet(fill(lid, kind === 'open' ? '#4a3420' : wood) + bands) + lock;
}

/** The Treant's heart container: a heart with a gold-green rim and two leaves sprouting from it. */
function heartContainer() {
  const r = pieceRng('heartContainer');
  const leaves = [-1, 1].map((s) => fill(blob(r, C + s * 6, C - 13, 6, 3.2, 7, 0.08, s * -0.5), '#4fae34')).join('');
  return sheet(leaves) + sheet(fill(heartPath(C, C + 2, 30), '#c8d84a') + fill(heartPath(C, C + 2, 24), P.heart) + fill(blob(r, C - 6, C - 3, 3.5, 2.4, 7, 0.1), P.heartLight), 2);
}

/** A white paper star on a small stand, tinted to its passive's colour. */
function passive() {
  const r = pieceRng('passive');
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 ? 7 : 16;
    return { x: C + Math.cos(a) * k, y: C - 2 + Math.sin(a) * k };
  });
  return sheet(fill(cutPoly(r, pts, 0.5), '#ffffff'), 2) + sheet(`<circle cx="${C}" cy="${C - 2}" r="3.5" fill="#fffbe8"/>`);
}

/** A cut-out arrow pointing up: a stat going up (white, tinted). */
function arrowUp() {
  const r = pieceRng('arrow');
  return sheet(fill(cutPoly(r, [{ x: C, y: C - 14 }, { x: C + 12, y: C }, { x: C + 5, y: C }, { x: C + 5, y: C + 12 }, { x: C - 5, y: C + 12 }, { x: C - 5, y: C }, { x: C - 12, y: C }], 0.4), '#ffffff'), 2);
}

/** A torn paper puff (white, tinted): a poison tick. */
function puff() {
  const r = pieceRng('puff');
  return sheet([{ x: -5, y: 2, s: 7 }, { x: 5, y: 1, s: 6 }, { x: 0, y: -4, s: 7 }].map((b) => fill(blob(r, C + b.x, C + b.y, b.s, b.s * 0.85, 8, 0.14), '#ffffff')).join(''));
}

/** The four-point star spinning over a stunned head. */
function stunStar() {
  const r = pieceRng('stun');
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    const k = i % 2 ? 4 : 12;
    return { x: C + Math.cos(a) * k, y: C + Math.sin(a) * k };
  });
  return sheet(fill(cutPoly(r, pts, 0.3), '#ffe066') + `<circle cx="${C}" cy="${C}" r="2.4" fill="#fff8d0"/>`);
}

/** An orbital: a pale paper orb (white, tinted). */
function orb() {
  const r = pieceRng('orb');
  return sheet(fill(blob(r, C, C, 10, 10, 10, 0.04), '#ffffff') + fill(blob(r, C - 3, C - 3, 4, 3, 7, 0.1), '#ffffff', 'opacity="0.6"'), 2);
}

export const PICKUP_ART = {
  chest: () => chest('plain'),
  lockedChest: () => chest('locked'),
  openChest: () => chest('open'),
  heartContainer,
  passive,
  statUp: arrowUp,
  heart: () => `<g transform="translate(${C - HEART_CANVAS / 2 + 1} ${C - HEART_CANVAS / 2 + 1})">${heart('full')}</g>`,
  key: () => `<g transform="translate(${C - ICON_CANVAS / 2} ${C - ICON_CANVAS / 2})">${key()}</g>`,
  bomb: () => `<g transform="translate(${C - ICON_CANVAS / 2} ${C - ICON_CANVAS / 2})">${bomb()}</g>`,
  puff,
  stun: stunStar,
  orb,
} as const;

export type PickupArt = keyof typeof PICKUP_ART;
export const pickupSvg = (kind: PickupArt) => svgDoc(PICKUP_CANVAS, PICKUP_CANVAS, PICKUP_ART[kind](), 67);

export const hudSvg = {
  heart: (level: 'full' | 'half' | 'empty') => svgDoc(HEART_CANVAS, HEART_CANVAS, heart(level), 41),
  key: () => svgDoc(ICON_CANVAS, ICON_CANVAS, key(), 43),
  bomb: () => svgDoc(ICON_CANVAS, ICON_CANVAS, bomb(), 47),
  scrap: (w: number, h: number) => svgDoc(w, h, scrap(w, h), 53),
  shot: (kind: 'player' | 'enemy', radius: number) => svgDoc(SHOT_CANVAS, SHOT_CANVAS, shot(kind, radius), 59),
};
