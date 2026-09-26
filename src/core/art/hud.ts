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

export const hudSvg = {
  heart: (level: 'full' | 'half' | 'empty') => svgDoc(HEART_CANVAS, HEART_CANVAS, heart(level), 41),
  key: () => svgDoc(ICON_CANVAS, ICON_CANVAS, key(), 43),
  bomb: () => svgDoc(ICON_CANVAS, ICON_CANVAS, bomb(), 47),
  scrap: (w: number, h: number) => svgDoc(w, h, scrap(w, h), 53),
  shot: (kind: 'player' | 'enemy', radius: number) => svgDoc(SHOT_CANVAS, SHOT_CANVAS, shot(kind, radius), 59),
};
