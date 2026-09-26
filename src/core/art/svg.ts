import { createRng, type Rng } from '../rng';

/**
 * The papercut drawing pieces: every sprite is built from these, as an SVG string. Nothing here
 * knows about Phaser, and the same input always gives the same SVG (edges are jittered by a
 * seeded stream, never Math.random).
 */

export interface Pt {
  x: number;
  y: number;
}

/** Fixed, short number output, so the same drawing always prints the same text. */
export const n = (v: number) => String(Math.round(v * 10) / 10);

/** A stream for one piece of one sprite: its cut edges stay put from frame to frame. */
export const pieceRng = (...key: (string | number)[]): Rng => createRng(0x5eed).fork(key.join('|'));

/** A closed, smooth outline through `pts` (Catmull-Rom turned into cubic curves). */
export function smoothPath(pts: readonly Pt[]): string {
  const p = (i: number) => pts[(i + pts.length) % pts.length];
  let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 0; i < pts.length; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return `${d}Z`;
}

/** A closed outline of straight cuts through `pts`. */
export function polyPath(pts: readonly Pt[]): string {
  return `M${pts.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`;
}

/**
 * A scissor-cut blob: an ellipse whose outline wanders a little, as if cut by hand.
 * `jitter` is the share of the radius an outline point may stray.
 */
export function blob(rng: Rng, cx: number, cy: number, rx: number, ry: number, points = 9, jitter = 0.08, turn = 0): string {
  const pts = Array.from({ length: points }, (_, i) => {
    const a = turn + (i / points) * Math.PI * 2;
    const k = 1 + (rng.next() * 2 - 1) * jitter;
    return { x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k };
  });
  return smoothPath(pts);
}

/** Foliage snipped into sharp points: `points` tips round an ellipse, notched `depth` of the radius between them. */
export function ragged(rng: Rng, cx: number, cy: number, rx: number, ry: number, points = 12, depth = 0.22): string {
  const pts = Array.from({ length: points * 2 }, (_, i) => {
    const a = (i / (points * 2)) * Math.PI * 2 + rng.next() * 0.08;
    const k = i % 2 ? 1 - depth * (0.6 + rng.next() * 0.8) : 1 + (rng.next() - 0.5) * 0.14;
    return { x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k };
  });
  return polyPath(pts);
}

/** Straight cuts through `pts`, each corner nudged up to `jitter` px: paper cut with a knife. */
export function cutPoly(rng: Rng, pts: readonly Pt[], jitter = 0.8): string {
  return polyPath(pts.map((p) => ({ x: p.x + (rng.next() * 2 - 1) * jitter, y: p.y + (rng.next() * 2 - 1) * jitter })));
}

/** Points round an ellipse, for building shapes out of. */
export function ring(cx: number, cy: number, rx: number, ry: number, count: number, turn = 0): Pt[] {
  return Array.from({ length: count }, (_, i) => {
    const a = turn + (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
}

/** A filled outline. */
export const fill = (d: string, color: string, extra = '') => `<path d="${d}" fill="${color}"${extra ? ` ${extra}` : ''}/>`;

/**
 * One sheet of paper laid over the one below: its contents cast a small soft shadow down and
 * to the right. `lift` 1 is a thin sheet, 2 a thicker stack.
 */
export const sheet = (content: string, lift: 1 | 2 | 3 = 1) => `<g filter="url(#lift${lift})">${content}</g>`;

/** Rotates, flips or moves a group. */
export const group = (content: string, transform: string) => `<g transform="${transform}">${content}</g>`;

/** The shadow each sheet throws: always down-right, whatever lights the room. */
export const SHADOW = { dx: 1.6, dy: 2.2, blur: 0.9, opacity: 0.45 };

/** Filters every papercut SVG carries: sheet shadows at three thicknesses, and the paper grain. */
function defs(grainSeed: number): string {
  const lift = (i: number) =>
    `<filter id="lift${i}" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="${n(SHADOW.dx * i)}" dy="${n(SHADOW.dy * i)}" stdDeviation="${n(SHADOW.blur * (0.7 + i * 0.3))}" flood-color="#060805" flood-opacity="${SHADOW.opacity}"/></filter>`;
  // Faint fibres: grey noise soft-lit into the colours (a little lighter and darker, never speckled),
  // kept only on solid paper so soft shadows stay clean.
  const grain =
    `<filter id="grain" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${grainSeed}" result="noise"/>` +
    `<feColorMatrix in="noise" type="matrix" values="0.5 0.5 0.5 0 -0.25  0.5 0.5 0.5 0 -0.25  0.5 0.5 0.5 0 -0.25  0 0 0 0 1" result="grey"/>` +
    `<feBlend in="grey" in2="SourceGraphic" mode="soft-light" result="textured"/>` +
    `<feComponentTransfer in="SourceAlpha" result="solid"><feFuncA type="linear" slope="8" intercept="-7"/></feComponentTransfer>` +
    `<feComposite in="textured" in2="solid" operator="in" result="paper"/>` +
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="paper"/></feMerge></filter>`;
  return `<defs>${lift(1)}${lift(2)}${lift(3)}${grain}</defs>`;
}

/** A whole papercut SVG, `w`×`h` px, with its grain laid over everything drawn in `body`. */
export function svgDoc(w: number, h: number, body: string, grainSeed = 3): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `${defs(grainSeed)}<g filter="url(#grain)">${body}</g></svg>`
  );
}
