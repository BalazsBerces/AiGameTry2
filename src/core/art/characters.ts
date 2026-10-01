import { PAPER as P } from './palette';
import { blob, cutPoly, fill, group, n, pieceRng, polyPath, ragged, sheet, smoothPath, svgDoc } from './svg';

/** What every character does, each drawn as a short stop-motion loop. */
export type BaseAction = 'idle' | 'move' | 'attack' | 'hurt';
/** Base actions plus the ones only some characters have: a goblin healing its partner, being healed, a ghoul catching its breath. */
export type Action = BaseAction | 'heal' | 'healed' | 'recover';
/** The way a character faces: `side` looks right (left is the mirror image), `down` at the camera, `up` away. */
export type View = 'side' | 'down' | 'up';

/** Frames per base action, the same for every character. */
export const FRAMES: Readonly<Record<BaseAction, number>> = { idle: 2, move: 4, attack: 3, hurt: 1 };
/** Frames of the extra actions a character may add. */
const EXTRA_FRAMES: Readonly<Record<Exclude<Action, BaseAction>, number>> = { heal: 2, healed: 2, recover: 2 };

export interface CharacterArt {
  /** Canvas size in game px. */
  w: number;
  h: number;
  /** Where the feet are on the canvas: this point sits on the physics body's centre. */
  anchor: { x: number; y: number };
  views: readonly View[];
  /** Every action it has and its frame count: the base four, plus any extras. */
  actions: Readonly<Partial<Record<Action, number>>>;
  draw(action: Action, frame: number, view: View, champion: boolean): string;
}

/** The flat dark oval a character stands on, thrown down-right like every shadow. */
const contact = (x: number, y: number, rx: number, ry: number) =>
  `<ellipse cx="${n(x + 1.5)}" cy="${n(y + 1)}" rx="${n(rx)}" ry="${n(ry)}" fill="${P.shadow}" opacity="0.38"/>`;

const eye = (x: number, y: number, rx: number, ry: number, color: string = P.ink) =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${color}"/>` +
  `<circle cx="${n(x + rx * 0.35)}" cy="${n(y - ry * 0.4)}" r="${n(Math.max(0.5, rx * 0.4))}" fill="${P.white}"/>`;

/** A narrow glowing eye slit, `w` px long, tilted `tilt` degrees: how the forest's creatures look back. */
const slit = (x: number, y: number, w: number, tilt: number, color: string) =>
  `<path d="M${n(x - w)} ${n(y)}Q${n(x)} ${n(y - w * 0.55)} ${n(x + w)} ${n(y)}Q${n(x)} ${n(y + w * 0.3)} ${n(x - w)} ${n(y)}Z" fill="${color}" transform="rotate(${n(tilt)} ${n(x)} ${n(y)})"/>`;

/** Squeezed-shut eyes: the hurt pose. */
const shutEye = (x: number, y: number, s: number) =>
  `<path d="M${n(x - s)} ${n(y - s * 0.7)}L${n(x + s * 0.6)} ${n(y)}L${n(x - s)} ${n(y + s * 0.7)}" stroke="${P.ink}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;

const circle = (x: number, y: number, r: number, color: string) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${color}"/>`;
const ellipse = (x: number, y: number, rx: number, ry: number, color: string, extra = '') =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${color}"${extra ? ` ${extra}` : ''}/>`;

/** A champion's gold paper trim: a thin gold sheet cut a little larger, behind the body. */
const trim = (d: string, on: boolean) => (on ? `<path d="${d}" fill="none" stroke="${P.champion}" stroke-width="2.6" stroke-linejoin="round"/>` : '');

/** How a body moves in each frame: its bob, stride (-1..1), lean in degrees and squash. */
interface Pose {
  bob: number;
  stride: number;
  lean: number;
  squash: number;
  /** 0 at rest, 1 wound up, 2 striking. */
  strike: 0 | 1 | 2;
  hurt: boolean;
}

function pose(action: Action, frame: number): Pose {
  const base: Pose = { bob: 0, stride: 0, lean: 0, squash: 1, strike: 0, hurt: false };
  switch (action) {
    case 'idle':
      return { ...base, bob: frame ? 0.8 : 0, squash: frame ? 0.97 : 1 };
    case 'move':
      return { ...base, bob: [0, -2, 0, -2][frame], stride: [1, 0, -1, 0][frame], lean: 4 };
    case 'attack':
      return [
        { ...base, lean: -8, squash: 1.04, strike: 1 as const },
        { ...base, lean: 10, squash: 0.94, strike: 2 as const },
        { ...base, lean: 3, strike: 0 as const },
      ][frame];
    case 'hurt':
      return { ...base, squash: 0.86, lean: -6, hurt: true };
    case 'heal':
      return { ...base, bob: frame ? -0.8 : 0, lean: -3 };
    case 'healed':
      return { ...base, bob: frame ? -1.2 : 0, squash: frame ? 1.03 : 1, lean: -2 };
    case 'recover':
      return { ...base, bob: frame ? 1 : 0.4, squash: frame ? 0.95 : 0.97, lean: 6 };
  }
}

/** Scales a pose's body about the feet: squash flattens and widens, lean tips it. */
const posed = (p: Pose, x: number, y: number, body: string) =>
  group(body, `translate(${n(x)} ${n(y + p.bob)}) rotate(${n(p.lean)}) scale(${n(2 - p.squash)} ${n(p.squash)}) translate(${n(-x)} ${n(-y)})`);

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

const PLAYER = { w: 44, h: 58, foot: { x: 22, y: 51 } };

function drawPlayer(action: Action, frame: number, view: View): string {
  const p = pose(action, frame);
  const r = (part: string) => pieceRng('player', view, part);
  const { x: fx, y: fy } = PLAYER.foot;
  const side = view === 'side';
  const step = p.stride * 3;
  const feet = side
    ? ellipse(fx - 3 - step, fy - 1.5, 4, 2.6, P.boot) + ellipse(fx + 3 + step, fy - 1.5 - Math.abs(p.stride), 4, 2.6, P.boot)
    : ellipse(fx - 5, fy - 1.5 - Math.max(0, p.stride) * 2, 3.6, 2.6, P.boot) + ellipse(fx + 5, fy - 1.5 - Math.max(0, -p.stride) * 2, 3.6, 2.6, P.boot);

  const cloakPts = side
    ? [{ x: 21, y: 30 }, { x: 28, y: 33 }, { x: 30, y: 40 }, { x: 30, y: 48 }, { x: 20, y: 49 }, { x: 12, y: 48 }, { x: 13, y: 40 }, { x: 16, y: 33 }]
    : [{ x: 22, y: 30 }, { x: 30, y: 33 }, { x: 33, y: 41 }, { x: 32, y: 48 }, { x: 22, y: 49.5 }, { x: 12, y: 48 }, { x: 11, y: 41 }, { x: 14, y: 33 }];
  const cloak = fill(smoothPath(cloakPts), P.cloak);
  const fold = view === 'up'
    ? fill(`M22 33L25 48L19 48Z`, P.cloakShade)
    : side
      ? fill(`M14 36Q13 44 13 48L19 48Q17 42 17 36Z`, P.cloakShade)
      : fill(`M20 38L24 38L25 48L19 48Z`, P.cloakShade, 'opacity="0.7"');
  const scarfTail = side
    ? fill(cutPoly(r('tail'), [{ x: 16, y: 32 }, { x: 8, y: 34 + p.bob }, { x: 7, y: 39 + p.bob }, { x: 15, y: 36 }], 0.4), P.scarf)
    : view === 'down'
      ? fill(cutPoly(r('tail'), [{ x: 25, y: 33 }, { x: 29, y: 34 }, { x: 28, y: 42 }, { x: 25.5, y: 41 }], 0.4), P.scarf)
      : '';
  const scarf = ellipse(22, 33, 9.5, 3.4, P.scarf) + scarfTail;

  // Hands: at the sides, or out front in the strike.
  const reach = p.strike === 2 ? 1 : p.strike === 1 ? -0.4 : 0;
  const hands = side
    ? circle(29 + reach * 7, 42 - reach * 4, 2.8, P.cream)
    : view === 'down'
      ? circle(11, 41, 2.7, P.cream) + circle(33 - reach * 5, 41 - reach * 6, 2.7, P.cream)
      : circle(11, 40, 2.7, P.cream) + circle(33, 40 - reach * 5, 2.7, P.cream);
  const spark = p.strike === 2
    ? fill(cutPoly(r('spark'), side
      ? [{ x: 36, y: 34 }, { x: 38, y: 37 }, { x: 41, y: 37.5 }, { x: 38.5, y: 39.5 }, { x: 39.5, y: 43 }, { x: 36, y: 41 }, { x: 33, y: 43 }, { x: 34, y: 39.5 }, { x: 31.5, y: 37.5 }, { x: 34.5, y: 37 }]
      : [{ x: 28, y: 26 }, { x: 30, y: 29 }, { x: 33, y: 29.5 }, { x: 30.5, y: 31.5 }, { x: 31.5, y: 35 }, { x: 28, y: 33 }, { x: 25, y: 35 }, { x: 26, y: 31.5 }, { x: 23.5, y: 29.5 }, { x: 26.5, y: 29 }], 0.3), P.shot)
    : '';

  // The hood, and the face inside it.
  const hoodTip = side ? { x: 13, y: 12 } : { x: 22, y: 9.5 };
  const hood =
    fill(blob(r('hood'), 22, 23, 12.5, 11.5, 10, 0.05), P.cloak) +
    fill(cutPoly(r('tip'), [{ x: hoodTip.x - 4, y: 17 }, hoodTip, { x: hoodTip.x + 5, y: 16 }], 0.3), P.cloak);
  let face = '';
  if (view === 'down') {
    face =
      fill(blob(r('face'), 22, 25.5, 8.8, 7.8, 9, 0.04), P.cream) +
      (p.hurt ? shutEye(18.5, 25.5, 2) + shutEye(25.5, 25.5, -2) : eye(18.6, 25.2, 1.7, 2.3) + eye(25.4, 25.2, 1.7, 2.3)) +
      circle(16.2, 28.6, 1.5, P.blush) + circle(27.8, 28.6, 1.5, P.blush);
  } else if (side) {
    face =
      fill(blob(r('face'), 26.5, 25.5, 6.6, 7.5, 8, 0.04), P.cream) +
      (p.hurt ? shutEye(28, 25, 2) : eye(28.4, 25, 1.7, 2.3)) +
      circle(29.5, 28.6, 1.4, P.blush);
  } else {
    face = fill(`M22 14Q23 23 22 32`, 'none', `stroke="${P.cloakShade}" stroke-width="1.2"`);
  }
  const body =
    sheet(feet) +
    sheet(cloak + fold) +
    sheet(scarf) +
    sheet(hands + spark) +
    sheet(hood + sheet(face), 2);
  return contact(fx, fy, 11, 3.4) + posed(p, fx, fy, body);
}

// ---------------------------------------------------------------------------------------------
// Goblin
// ---------------------------------------------------------------------------------------------

const GOBLIN = { w: 50, h: 52, foot: { x: 24, y: 46 } };

function drawGoblin(action: Action, frame: number, champion: boolean): string {
  const p = pose(action, frame);
  const r = (part: string) => pieceRng('goblin', part);
  const { x: fx, y: fy } = GOBLIN.foot;
  const step = p.stride * 3.5;
  const feet = ellipse(fx - 4 - step, fy - 1.5, 3.8, 2.3, P.goblinShade) + ellipse(fx + 4 + step, fy - 1.5 - Math.abs(p.stride), 3.8, 2.3, P.goblinShade);
  const tunicD = cutPoly(r('tunic'), [{ x: 16, y: 31 }, { x: 32, y: 31 }, { x: 34, y: 44 }, { x: 30, y: 42 }, { x: 27, y: 45 }, { x: 23, y: 42 }, { x: 19, y: 45 }, { x: 15, y: 42 }], 0.5);
  const tunic = trim(tunicD, champion) + fill(tunicD, P.goblinTunic) + fill(`M17 34L31 34L31 36L17 36Z`, P.goblinTunicShade);
  // The dagger: held low, raised in the wind-up, thrust in the strike.
  const healing = action === 'heal';
  const mended = action === 'healed';
  const knife = p.strike === 1 ? { x: 34, y: 22, a: -60 } : p.strike === 2 ? { x: 40, y: 36, a: 20 } : healing ? { x: 16, y: 40, a: 110 } : { x: 34, y: 38, a: 50 };
  const dagger = group(
    fill(cutPoly(r('blade'), [{ x: 0, y: -1.6 }, { x: 11, y: -0.6 }, { x: 13, y: 0 }, { x: 11, y: 0.6 }, { x: 0, y: 1.6 }], 0.2), P.blade) +
      fill(`M-3 -1.5L0 -1.5L0 1.5L-3 1.5Z`, P.goblinTunicShade),
    `translate(${knife.x} ${knife.y}) rotate(${knife.a})`,
  );
  // Healing: it lowers the knife and holds a sickly green glow out toward its partner, pulsing.
  const glow = healing
    ? circle(38, 27 - frame, 6 + frame * 1.5, P.heal) + circle(38, 27 - frame, 3, P.healCore) + circle(34, 30, 2.6, P.goblin)
    : '';
  const hand = circle(knife.x, knife.y, 2.6, P.goblin) + glow;
  // Being healed: green motes rise off it.
  const motes = mended
    ? [{ x: 14, y: 30 }, { x: 36, y: 24 }, { x: 22, y: 12 }, { x: 31, y: 36 }]
        .map((m, i) => fill(`M${m.x} ${m.y - frame * 4 - 3}l1.4 3l3 1.4l-3 1.4l-1.4 3l-1.4 -3l-3 -1.4l3 -1.4Z`, i % 2 ? P.heal : P.healCore))
        .join('')
    : '';
  // A gaunt, angular skull thrust forward: a hunched stalker, not a mascot.
  const headD = cutPoly(r('head'), [{ x: 17, y: 17 }, { x: 24, y: 12 }, { x: 32, y: 14 }, { x: 35, y: 21 }, { x: 33, y: 29 }, { x: 27, y: 32 }, { x: 20, y: 29 }, { x: 16, y: 23 }], 0.5);
  const earL = cutPoly(r('earL'), [{ x: 18, y: 18 }, { x: 11, y: 15 }, { x: 3, y: 9 + p.bob * 0.5 }, { x: 9, y: 17 }, { x: 7, y: 19 }, { x: 17, y: 24 }], 0.5);
  const earR = cutPoly(r('earR'), [{ x: 32, y: 17 }, { x: 40, y: 13 }, { x: 47, y: 7 + p.bob * 0.5 }, { x: 43, y: 16 }, { x: 45, y: 18 }, { x: 34, y: 23 }], 0.5);
  const brow = fill(`M19 16.5L25.5 20L31 17L33.5 19L26 22.5L19 19.5Z`, P.goblinShade);
  const snarl = fill(cutPoly(r('snarl'), [{ x: 21, y: 26 }, { x: 31, y: 25 }, { x: 29.5, y: 29 }, { x: 22.5, y: 29.5 }], 0.3), P.ink) +
    fill(`M23 26L24.4 26L23.8 29Z`, P.tusk) + fill(`M28.2 25.7L29.6 25.6L28.8 28.6Z`, P.tusk);
  const head =
    trim(headD, champion) +
    fill(earL, P.goblinShade) + fill(earR, P.goblinShade) +
    fill(headD, P.goblin) +
    fill(`M18 24L20 29L27 32L33 29L31 27L26 29.5Z`, P.goblinShade, 'opacity="0.7"') +
    // The hooked nose juts toward the way it faces.
    fill(cutPoly(r('nose'), [{ x: 28, y: 20 }, { x: 37, y: 24.5 }, { x: 33, y: 25 }, { x: 29, y: 25 }], 0.3), P.goblinShade) +
    brow +
    (p.hurt ? shutEye(23.5, 20.5, 1.8) + shutEye(30, 20, -1.8)
      : slit(23.3, 20.6, 3, 16, healing || mended ? P.heal : P.eyeGlow) + slit(30.3, 20.2, 3, -16, healing || mended ? P.heal : P.eyeGlow)) +
    snarl;
  const aura = mended ? ellipse(25, 30, 15 + frame * 2, 17 + frame * 2, P.heal, 'opacity="0.22"') : '';
  const body = aura + sheet(feet) + sheet(tunic) + sheet(dagger + hand) + sheet(head, 2) + motes;
  return contact(fx, fy, 11, 3.2) + posed(p, fx, fy, body);
}

// ---------------------------------------------------------------------------------------------
// Seed spitter
// ---------------------------------------------------------------------------------------------

const SPITTER = { w: 56, h: 58, foot: { x: 27, y: 48 } };

function drawSeedSpitter(action: Action, frame: number, champion: boolean): string {
  const p = pose(action, frame);
  const r = (part: string) => pieceRng('seedSpitter', part);
  const { x: fx, y: fy } = SPITTER.foot;
  // It is rooted: "moving" is a sway, attacking swells the bulb then spits.
  const sway = action === 'move' ? [0, 3, 0, -3][frame] : action === 'idle' ? frame * 1.2 - 0.6 : 0;
  const swell = p.strike === 1 ? 1.14 : p.strike === 2 ? 0.9 : action === 'hurt' ? 0.88 : 1;
  const leaves = [-1, 1]
    .map((s) => fill(cutPoly(r(`leaf${s}`), [{ x: fx, y: fy - 2 }, { x: fx + s * 22, y: fy - 9 }, { x: fx + s * 26, y: fy - 3 }, { x: fx + s * 14, y: fy + 2 }], 0.6), s < 0 ? P.leafShade : P.leaf))
    .join('');
  const stem = fill(`M${fx - 3} ${fy}L${fx + 3} ${fy}L${fx + 2 + sway * 0.5} ${fy - 14}L${fx - 2 + sway * 0.5} ${fy - 14}Z`, P.leafShade);
  const cx = fx + sway;
  const cy = fy - 24;
  const bulbD = blob(r('bulb'), cx, cy, 15 * swell, 14 * swell, 10, 0.05);
  // No face: a carnivorous pod split down the front by a fanged maw, which gapes to spit.
  const gape = p.strike === 2 ? 6 : p.strike === 1 ? 1 : action === 'hurt' ? 1.5 : 2.6;
  const mawTop = cy - 9 * swell;
  const mawBottom = cy + 10 * swell;
  const maw = `M${n(cx)} ${n(mawTop)}Q${n(cx + gape * 1.3)} ${n(cy)} ${n(cx)} ${n(mawBottom)}Q${n(cx - gape * 1.3)} ${n(cy)} ${n(cx)} ${n(mawTop)}Z`;
  const fangs = [-6, -2, 2, 6]
    .flatMap((dy) =>
      [-1, 1].map((s) => {
        const y = cy + dy * swell;
        const edge = cx + s * gape * 1.3 * (1 - (dy / 10) ** 2) * 0.75;
        return fill(`M${n(edge)} ${n(y - 1.3)}L${n(edge - s * 2.6)} ${n(y + 0.4)}L${n(edge)} ${n(y + 1.3)}Z`, P.tusk);
      }),
    )
    .join('');
  const bulb =
    trim(bulbD, champion) +
    fill(bulbD, P.spitter) +
    fill(blob(r('shade'), cx - 4, cy + 5, 10 * swell, 7 * swell, 8, 0.05), P.spitterShade, 'opacity="0.6"') +
    // Ridges running down the pod, and the lips of its maw.
    [-1, 1].map((s) => `<path d="M${n(cx + s * 8 * swell)} ${n(cy - 11 * swell)}Q${n(cx + s * 13 * swell)} ${n(cy)} ${n(cx + s * 8 * swell)} ${n(cy + 11 * swell)}" stroke="${P.spitterShade}" stroke-width="1.6" fill="none"/>`).join('') +
    sheet(fill(maw, P.spitterLip, `transform="translate(${n(cx)} ${n(cy)}) scale(1.35 1.08) translate(${n(-cx)} ${n(-cy)})"`) + fill(maw, P.ink) + fangs);
  // Barbed husk leaves round its crown.
  const petals = [-1, 0, 1]
    .map((s) =>
      fill(
        cutPoly(r(`barb${s}`), [{ x: cx + s * 4 - 3, y: cy - 11 * swell }, { x: cx + s * 12, y: cy - 22 * swell - (s ? 0 : 3) }, { x: cx + s * 4 + 3, y: cy - 11 * swell }], 0.4),
        s ? P.leafShade : P.leaf,
      ),
    )
    .join('');
  return contact(fx, fy, 16, 4) + sheet(leaves) + sheet(stem) + sheet(petals) + sheet(bulb, 2);
}

// ---------------------------------------------------------------------------------------------
// Boar
// ---------------------------------------------------------------------------------------------

const BOAR = { w: 62, h: 46, foot: { x: 30, y: 40 } };

function drawBoar(action: Action, frame: number, champion: boolean): string {
  const p = pose(action, frame);
  const r = (part: string) => pieceRng('boar', part);
  const { x: fx, y: fy } = BOAR.foot;
  // The attack is the charge: head down (wind-up), then flat out.
  const charge = p.strike === 2 || (action === 'attack' && frame === 2);
  const gallop = action === 'move' || charge ? p.stride || (charge ? 1 : 0) : 0;
  const legs = [
    { x: fx - 12, a: gallop * 18 },
    { x: fx - 6, a: -gallop * 18 },
    { x: fx + 8, a: -gallop * 18 },
    { x: fx + 13, a: gallop * 18 },
  ]
    .map((l, i) => group(fill(`M-2.4 0L2.4 0L2 9L-2 9Z`, i % 2 ? P.boarShade : P.boarMane), `translate(${l.x} ${fy - 9}) rotate(${n(l.a)})`))
    .join('');
  const headDown = p.strike === 1 ? 4 : 0;
  const bodyD = blob(r('body'), fx - 2, fy - 16, 17, 10.5, 10, 0.06);
  const body =
    trim(bodyD, champion) +
    fill(bodyD, P.boar) +
    fill(cutPoly(r('mane'), [{ x: fx - 16, y: fy - 23 }, { x: fx - 10, y: fy - 29 }, { x: fx - 5, y: fy - 25 }, { x: fx, y: fy - 30 }, { x: fx + 5, y: fy - 25 }, { x: fx + 9, y: fy - 28 }, { x: fx + 11, y: fy - 21 }, { x: fx - 14, y: fy - 19 }], 0.6), P.boarMane) +
    fill(`M${fx - 19} ${fy - 17}q-5 -2 -4 -6`, 'none', `stroke="${P.boarMane}" stroke-width="1.6" stroke-linecap="round"`);
  const hx = fx + 17;
  const hy = fy - 16 + headDown;
  const headD = blob(r('head'), hx, hy, 9, 8, 8, 0.06);
  const head =
    trim(headD, champion) +
    fill(cutPoly(r('ear'), [{ x: hx - 5, y: hy - 5 }, { x: hx - 3, y: hy - 13 }, { x: hx + 1, y: hy - 6 }], 0.3), P.boarShade) +
    fill(headD, P.boar) +
    sheet(ellipse(hx + 8, hy + 2, 4, 3.6, P.snout) + circle(hx + 9, hy + 1.2, 0.8, P.ink) + circle(hx + 9, hy + 3.4, 0.8, P.ink)) +
    fill(cutPoly(r('tusk'), [{ x: hx + 4, y: hy + 5 }, { x: hx + 9, y: hy + 4 }, { x: hx + 14, y: hy - 3 }, { x: hx + 10, y: hy + 7 }], 0.2), P.tusk) +
    `<path d="M${n(fx - 8)} ${n(fy - 22)}l6 5M${n(fx - 4)} ${n(fy - 23)}l5 5" stroke="${P.boarMane}" stroke-width="1.2" opacity="0.8"/>` +
    (p.hurt ? shutEye(hx + 2, hy - 2, 1.6) : slit(hx + 2, hy - 2.2, 2.4, 14, '#e8452a'));
  const dust = charge
    ? [0, 1, 2].map((i) => ellipse(fx - 24 - i * 5, fy - 2 - i * 2, 3 - i * 0.6, 2 - i * 0.4, P.creamShade, 'opacity="0.55"')).join('')
    : '';
  return contact(fx, fy, 19, 3.6) + dust + posed({ ...p, lean: charge ? 3 : p.hurt ? -6 : 0 }, fx, fy, sheet(legs) + sheet(body) + sheet(head, 2));
}

// ---------------------------------------------------------------------------------------------
// Wasp
// ---------------------------------------------------------------------------------------------

const WASP = { w: 34, h: 40, foot: { x: 17, y: 36 } };

function drawWasp(action: Action, frame: number, champion: boolean): string {
  const r = (part: string) => pieceRng('wasp', part);
  const { x: fx, y: fy } = WASP.foot;
  // It flies: the body hovers well above its shadow and the wings beat every frame.
  const hover = [0, -1.5, 0, 1][frame % 4] ?? 0;
  const y = fy - 16 + hover;
  const up = frame % 2 === 0;
  const hurt = action === 'hurt';
  const dive = action === 'attack' ? [-6, 10, 2][frame] : 0;
  const wings = [-1, 1]
    .map((s) =>
      fill(blob(r(`wing${s}`), fx + s * 6, y - (up ? 8 : 3), 4.5, up ? 7 : 4, 7, 0.05, s * (up ? 0.5 : 1.1)), P.wing, 'opacity="0.78"'),
    )
    .join('');
  const abdomenD = blob(r('abdomen'), fx - 4, y + 2, 7, 5, 8, 0.05);
  const body =
    trim(abdomenD, champion) +
    fill(abdomenD, P.wasp) +
    fill(`M${fx - 7} ${y - 2}L${fx - 5} ${y - 2}L${fx - 5} ${y + 6.5}L${fx - 7} ${y + 6}Z`, P.waspStripe) +
    fill(`M${fx - 3} ${y - 2.7}L${fx - 1} ${y - 2.7}L${fx - 1} ${y + 6.8}L${fx - 3} ${y + 6.8}Z`, P.waspStripe) +
    fill(`M${fx - 11} ${y + 1.5}L${fx - 18} ${y + 4.5}L${fx - 11} ${y + 4.2}Z`, P.waspStripe) +
    fill(blob(r('head'), fx + 5, y, 5, 4.6, 7, 0.05), P.wasp) +
    (hurt ? shutEye(fx + 7, y - 1, 1.5) : slit(fx + 7, y - 1.2, 2, 18, '#e8452a'));
  return contact(fx, fy, 7, 2.2) + group(sheet(wings) + sheet(body, 2), `rotate(${dive} ${fx} ${y})`);
}

// ---------------------------------------------------------------------------------------------
// Ghoul
// ---------------------------------------------------------------------------------------------

const GHOUL = { w: 76, h: 58, foot: { x: 24, y: 52 } };
const C = P.caves;

/** A limb cut from `from` through a joint to `to`, the joint pushed `bend` px off the straight line between them. */
const limb = (from: { x: number; y: number }, to: { x: number; y: number }, bend: number, thick: number, tip: number) => {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const joint = { x: (from.x + to.x) / 2 - ((to.y - from.y) / len) * bend, y: (from.y + to.y) / 2 + ((to.x - from.x) / len) * bend };
  return taper([from, joint, to], thick, tip);
};

/** Three hooked claws off a hand at x,y, pointing `a` degrees. */
const claws = (x: number, y: number, a: number, color: string) =>
  group(
    [-24, 0, 24].map((d) => group(fill(taper([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 7, y: 1.6 }], 1.8, 0.3), color), `rotate(${d})`)).join(''),
    `translate(${n(x)} ${n(y)}) rotate(${n(a)})`,
  );

function drawGhoul(action: Action, frame: number, champion: boolean): string {
  const p = pose(action, frame);
  const r = (part: string) => pieceRng('ghoul', part);
  const { x: fx, y: fy } = GHOUL.foot;
  // The attack is the lunge: crouched and drawn back with its eyes flared (the wind-up, held for the tell), then flung forward.
  const windUp = action === 'attack' && frame === 0;
  const lunging = action === 'attack' && frame > 0;
  const winded = action === 'recover';
  const crouch = windUp ? 4 : winded ? 2.5 : p.hurt ? 1 : 0;
  const step = action === 'move' ? p.stride * 4 : lunging ? (frame === 1 ? 5 : 7) : 0;
  const hip = { x: fx - 2, y: fy - 15 + crouch };
  // Thin legs bent at the knee, feet splayed.
  const lift = Math.abs(p.stride);
  const legs =
    fill(limb(hip, { x: fx - 4 - step, y: fy - 1 }, -3.5, 4.2, 2.4), C.ghoulShade) + ellipse(fx - 3 - step, fy - 1, 3.4, 1.6, C.ghoulShade) +
    fill(limb({ x: hip.x + 2, y: hip.y }, { x: fx + 4 + step, y: fy - 1 - lift }, -3.5, 4.6, 2.6), C.ghoul) + ellipse(fx + 5 + step, fy - 1 - lift, 3.6, 1.7, C.ghoul);
  // A hunched, starved torso: the spine bowed high over the hips, the chest sunk forward.
  const top = fy - 33 + crouch;
  const torsoD = cutPoly(r('torso'), [
    { x: hip.x - 4, y: hip.y - 1 }, { x: hip.x - 6, y: top + 10 }, { x: hip.x - 2, y: top + 2 }, { x: hip.x + 5, y: top - 1 },
    { x: hip.x + 11, y: top + 4 }, { x: hip.x + 9, y: top + 9 }, { x: hip.x + 3, y: top + 13 }, { x: hip.x + 2, y: hip.y - 1 },
  ], 0.5);
  const ribs = [0, 1, 2]
    .map((i) => `<path d="M${n(hip.x + i)} ${n(top + 5 + i * 3)}q${n(3.5 - i)} 1.2 ${n(5.5 - i * 1.5)} -1" stroke="${C.ghoulDark}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.8"/>`)
    .join('');
  // Knobs of spine standing out along its back.
  const spine = [0, 1, 2, 3]
    .map((i) => {
      const x = hip.x - 6.5 + i * 3.3;
      const y = top + 9 - i * 3.2 + (i === 3 ? 1 : 0);
      return fill(`M${n(x - 1.3)} ${n(y + 0.6)}L${n(x - 1.6)} ${n(y - 2.2)}L${n(x + 1.3)} ${n(y - 0.4)}Z`, C.ghoulMilk);
    })
    .join('');
  const torso =
    trim(torsoD, champion) +
    fill(torsoD, C.ghoul) +
    fill(`M${n(hip.x - 4)} ${n(hip.y - 1)}L${n(hip.x - 5.5)} ${n(top + 10)}L${n(hip.x - 1)} ${n(top + 14)}L${n(hip.x + 1)} ${n(hip.y - 1)}Z`, C.ghoulShade, 'opacity="0.7"') +
    ribs +
    spine;
  // Long arms that drag their knuckles along the ground; pulled back in the wind-up, flung out in the lunge.
  const shoulder = { x: hip.x + 8, y: top + 4 };
  // The arms swing a beat behind the legs, so no two steps look alike.
  const sway = action === 'move' ? [3, 1.2, -3, -1.2][frame] : action === 'idle' ? frame * 1.5 : 0;
  const hands = windUp
    ? { near: { x: fx - 12, y: fy - 12 }, far: { x: fx - 9, y: fy - 16 }, a: 150 }
    : lunging
      ? frame === 1
        ? { near: { x: fx + 33, y: fy - 26 }, far: { x: fx + 30, y: fy - 20 }, a: -10 }
        : { near: { x: fx + 34, y: fy - 16 }, far: { x: fx + 31, y: fy - 11 }, a: 22 }
      : p.hurt
        ? { near: { x: fx - 4, y: fy - 10 }, far: { x: fx - 1, y: fy - 13 }, a: 120 }
        : winded
          ? { near: { x: fx + 15, y: fy - 1 - frame }, far: { x: fx + 11, y: fy - 1 }, a: 95 }
          : { near: { x: fx + 13 + sway, y: fy - 2 }, far: { x: fx + 9 - sway, y: fy - 2.5 }, a: 80 };
  const armBend = lunging ? 2 : windUp ? -4 : 4;
  const farArm = fill(limb({ x: shoulder.x - 2, y: shoulder.y - 1 }, hands.far, armBend, 4, 2.4), C.ghoulShade) + claws(hands.far.x, hands.far.y, hands.a, C.ghoulDark);
  const nearArm = fill(limb(shoulder, hands.near, armBend, 4.6, 2.6), C.ghoul) + claws(hands.near.x, hands.near.y, hands.a, C.ghoulShade);
  // A long, gaunt skull thrust forward on its neck, the jaw hanging open.
  const hx = shoulder.x + (lunging ? 9 : 7);
  const hy = top + (windUp ? 4 : winded ? 9 : 6);
  const gape = lunging ? 4 : winded ? 1.5 + frame * 1.5 : windUp ? 2 : 1;
  const headD = cutPoly(r('head'), [
    { x: hx - 5, y: hy - 3 }, { x: hx, y: hy - 6.5 }, { x: hx + 6, y: hy - 5.5 }, { x: hx + 10, y: hy - 2 },
    { x: hx + 10.5, y: hy + 1.5 }, { x: hx + 5, y: hy + 2 }, { x: hx - 2, y: hy + 4 }, { x: hx - 5, y: hy + 2 },
  ], 0.35);
  const jawD = cutPoly(r('jaw'), [{ x: hx - 1, y: hy + 2.5 }, { x: hx + 9, y: hy + 1.5 + gape }, { x: hx + 7, y: hy + 4 + gape }, { x: hx - 1, y: hy + 5 }], 0.25);
  const maw =
    fill(`M${n(hx)} ${n(hy + 1.6)}L${n(hx + 10)} ${n(hy + 1)}L${n(hx + 9)} ${n(hy + 1.5 + gape)}L${n(hx)} ${n(hy + 3.5)}Z`, P.ink) +
    [2, 4.5, 7].map((dx) => fill(`M${n(hx + dx)} ${n(hy + 1.4)}L${n(hx + dx + 1.4)} ${n(hy + 1.3)}L${n(hx + dx + 0.6)} ${n(hy + 3)}Z`, C.ghoulMilk)).join('');
  // Milky, pupil-less eyes; they flare crystal cyan through the wind-up and the lunge.
  const eyeAt = { x: hx + 5, y: hy - 2.2 };
  const eyes = p.hurt
    ? shutEye(eyeAt.x, eyeAt.y, 1.6)
    : action === 'attack'
      ? ellipse(eyeAt.x, eyeAt.y, 4.5, 4.5, C.crystal, 'opacity="0.3"') + slit(eyeAt.x, eyeAt.y, 2.4, 10, C.crystal) + circle(eyeAt.x + 0.3, eyeAt.y - 0.2, 0.8, C.crystalLight)
      : ellipse(eyeAt.x, eyeAt.y, 1.9, 1.5, C.ghoulMilk) + ellipse(eyeAt.x + 0.4, eyeAt.y + 0.2, 0.9, 0.7, C.ghoulShade, 'opacity="0.5"');
  const head =
    trim(headD, champion) +
    fill(jawD, C.ghoulShade) +
    maw +
    fill(headD, C.ghoul) +
    fill(`M${n(hx + 2)} ${n(hy - 4)}L${n(hx + 8)} ${n(hy - 3.6)}L${n(hx + 7)} ${n(hy - 1.6)}L${n(hx + 3)} ${n(hy - 1.8)}Z`, C.ghoulDark, 'opacity="0.75"') +
    fill(`M${n(hx - 3)} ${n(hy + 1)}L${n(hx + 1)} ${n(hy - 0.5)}L${n(hx + 1)} ${n(hy + 2.5)}Z`, C.ghoulShade) +
    eyes;
  const lean = windUp ? -7 : lunging ? (frame === 1 ? 14 : 18) : p.hurt ? -8 : winded ? 9 : action === 'move' ? 6 : 4;
  const body = sheet(farArm) + sheet(legs) + sheet(torso) + sheet(head, 2) + sheet(nearArm);
  return contact(fx + 2, fy, 13, 3.4) + posed({ ...p, lean }, fx, fy, body);
}

// ---------------------------------------------------------------------------------------------
// Bat
// ---------------------------------------------------------------------------------------------

const BAT = { w: 64, h: 46, foot: { x: 32, y: 42 } };

/**
 * One leathery wing off the shoulder at x,y on side `s` (1 right, -1 left): `lift` radians above
 * level, `span` px long, its trailing edge scalloped between three finger bones.
 */
function batWing(x: number, y: number, s: number, lift: number, span: number, champion: boolean, membrane: string, bone: string): string {
  const at = (k: number, da: number) => ({ x: x + s * span * k * Math.cos(lift + da), y: y - span * k * Math.sin(lift + da) });
  const wrist = at(0.45, 0.4);
  const tip = at(1, 0);
  const fingers = [at(0.82, -0.55), at(0.6, -1)];
  const root = { x: x - s, y: y + 4 };
  /** The membrane sags between two finger ends, pulled back toward the shoulder. */
  const notch = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2 + (x - (a.x + b.x) / 2) * 0.22, y: (a.y + b.y) / 2 + (y - (a.y + b.y) / 2) * 0.22 });
  const d = polyPath([{ x, y }, wrist, tip, notch(tip, fingers[0]), fingers[0], notch(fingers[0], fingers[1]), fingers[1], notch(fingers[1], root), root]);
  const bones = [tip, ...fingers].map((q) => `M${n(wrist.x)} ${n(wrist.y)}L${n(q.x)} ${n(q.y)}`).join('');
  return (
    trim(d, champion) +
    fill(d, membrane) +
    `<path d="M${n(x)} ${n(y)}L${n(wrist.x)} ${n(wrist.y)}${bones}" stroke="${bone}" stroke-width="1" fill="none" stroke-linecap="round"/>` +
    fill(`M${n(wrist.x)} ${n(wrist.y)}l${n(s * 1.6)} -2.4l${n(s * 0.4)} 2.4Z`, bone)
  );
}

function drawBat(action: Action, frame: number, champion: boolean): string {
  const { x: fx, y: fy } = BAT.foot;
  // It flies: the body flutters well above its shadow and the wings beat every frame.
  const hover = action === 'move' ? [0, -1.5, 0, 1][frame] : action === 'idle' ? -frame : 0;
  const telegraph = action === 'attack' && frame === 0;
  const swoop = action === 'attack' && frame > 0;
  const hurt = action === 'hurt';
  const bx = fx - 1;
  const by = fy - 20 + hover;
  // Wing lift and span per frame: a fast beat, spread flat and wide for the tell, swept back in the swoop.
  const [lift, span] = telegraph
    ? [0.2, 26]
    : swoop
      ? frame === 1 ? [1.05, 14] : [0.75, 13]
      : hurt
        ? [-0.35, 12]
        : action === 'move'
          ? [[1.1, 17], [0.35, 18], [-0.6, 16], [0.15, 18]][frame]
          : [[0.9, 17], [-0.4, 16]][frame];
  const wing = (s: number) => batWing(bx + s * 2.5, by - 1.5, s, lift, span, champion, s < 0 ? C.batWingShade : C.batWing, s < 0 ? C.batShade : C.batWingShade);
  const bodyD = blob(pieceRng('bat', 'body'), bx, by + 1, 5, 6.2, 9, 0.06);
  const hx = bx + 2.5;
  const hy = by - 5.5;
  // Big pink ears, pricked up taller as it hangs for the tell.
  const ears = [-1, 1]
    .map((s) => {
      const base = hx + s * 2.2;
      const tipX = base + s * (telegraph ? 3.5 : 2.5);
      const tipY = hy - (telegraph ? 10.5 : 9);
      return fill(`M${n(base - 2.2)} ${n(hy - 1.5)}L${n(tipX)} ${n(tipY)}L${n(base + 2.2)} ${n(hy - 1)}Z`, C.batEar) +
        fill(`M${n(base - 1)} ${n(hy - 2)}L${n(tipX)} ${n(tipY + 2.5)}L${n(base + 1.1)} ${n(hy - 1.8)}Z`, C.batEarInner);
    })
    .join('');
  const face = hurt
    ? shutEye(hx - 1.6, hy, 1.1) + shutEye(hx + 2, hy, -1.1)
    : eye(hx - 1.6, hy - 0.2, 0.9, 1.1, C.batEye) + eye(hx + 2, hy - 0.2, 0.9, 1.1, C.batEye);
  const snout =
    ellipse(hx + 0.2, hy + 2.4, 1.8, 1.2, C.batEarInner) +
    [-1, 0.6].map((dx) => fill(`M${n(hx + dx)} ${n(hy + 3)}L${n(hx + dx + 0.6)} ${n(hy + 4.8)}L${n(hx + dx + 1.2)} ${n(hy + 3)}Z`, P.white)).join('');
  const feet = [-1.5, 1.5]
    .map((dx) => fill(`M${n(bx + dx - 0.8)} ${n(by + 6)}L${n(bx + dx + (swoop ? 2.5 : 0))} ${n(by + 9.5)}L${n(bx + dx + 0.8)} ${n(by + 6)}Z`, C.batShade))
    .join('');
  const body =
    trim(bodyD, champion) +
    feet +
    fill(bodyD, C.bat) +
    fill(blob(pieceRng('bat', 'belly'), bx + 1, by + 2.5, 3, 3.6, 7, 0.05), C.batShade, 'opacity="0.55"') +
    ears +
    fill(blob(pieceRng('bat', 'head'), hx, hy, 4.4, 4, 8, 0.05), C.bat) +
    face +
    snout;
  // The swoop pitches it head-first at its target; a hit knocks it askew.
  const tilt = swoop ? (frame === 1 ? 24 : 30) : hurt ? -18 : 0;
  return contact(fx, fy, telegraph ? 9 : 7, 2.2) + group(sheet(wing(-1)) + sheet(body, 2) + sheet(wing(1)), `rotate(${tilt} ${n(bx)} ${n(by)})`);
}

// ---------------------------------------------------------------------------------------------
// Treant
// ---------------------------------------------------------------------------------------------

const TREANT = { w: 168, h: 176, foot: { x: 84, y: 150 } };

/** A branch cut to taper along `pts`, `from` px wide at its base down to `to` at its tip. */
function taper(pts: readonly { x: number; y: number }[], from: number, to: number): string {
  const side = (sign: number) =>
    pts.map((q, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const w = (from + ((to - from) * i) / (pts.length - 1)) / 2;
      return { x: q.x - ((b.y - a.y) / len) * w * sign, y: q.y + ((b.x - a.x) / len) * w * sign };
    });
  const tip = pts[pts.length - 1];
  const out = [...side(1), tip, ...side(-1).reverse()];
  return `M${out.map((q) => `${n(q.x)} ${n(q.y)}`).join('L')}Z`;
}

/** A strand of grey moss hanging `length` px from a branch, swaying by `kink` (0..1). */
const hangingMoss = (x: number, y: number, length: number, kink: number) =>
  `<path d="M${n(x)} ${n(y)}q${n(kink * 6 - 3)} ${n(length / 2)} ${n(kink * 2 - 1)} ${n(length)}" stroke="${P.moss}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.85"/>`;

function drawTreant(action: Action, frame: number): string {
  const p = pose(action, frame);
  const r = (part: string) => pieceRng('treant', part);
  const { x: fx, y: fy } = TREANT.foot;
  const sway = action === 'idle' ? (frame ? 1.5 : -1.5) : action === 'move' ? [0, 2, 0, -2][frame] : 0;
  // Its arms: hanging, raised overhead (wind-up), slammed down (strike).
  const arm = p.strike === 1 ? -70 : p.strike === 2 ? 35 : action === 'move' ? [10, 0, -10, 0][frame] : 5;
  const rootStep = action === 'move' ? p.stride * 5 : 0;
  const roots = [-1, 1]
    .flatMap((s) => [
      fill(cutPoly(r(`root${s}a`), [{ x: fx + s * 8, y: fy - 16 }, { x: fx + s * (34 + rootStep * s), y: fy - 2 - (s * rootStep > 0 ? 3 : 0) }, { x: fx + s * (36 + rootStep * s), y: fy + 3 }, { x: fx + s * 14, y: fy - 4 }], 0.8), P.barkShade),
      fill(cutPoly(r(`root${s}b`), [{ x: fx + s * 4, y: fy - 12 }, { x: fx + s * 18, y: fy + 4 }, { x: fx + s * 10, y: fy + 4 }], 0.6), P.bark),
    ])
    .join('');
  const tx = fx + sway;
  // A hunched dead-wood giant: broad split shoulders over a narrow waist, flaring into its roots.
  const trunkD = cutPoly(r('trunk'), [
    { x: tx - 24, y: fy - 6 }, { x: tx - 20, y: fy - 36 }, { x: tx - 26, y: fy - 62 }, { x: tx - 34, y: fy - 82 }, { x: tx - 26, y: fy - 94 },
    { x: tx - 10, y: fy - 90 }, { x: tx, y: fy - 97 }, { x: tx + 11, y: fy - 91 }, { x: tx + 27, y: fy - 95 }, { x: tx + 35, y: fy - 81 },
    { x: tx + 26, y: fy - 60 }, { x: tx + 21, y: fy - 36 }, { x: tx + 24, y: fy - 6 },
  ], 1.6);
  // Cracks in the bark with the same ember glowing through them as in its eyes; they flare as it strikes.
  const heat = p.strike === 2 ? 1 : p.strike === 1 ? 0.8 : 0.55;
  const cracks = [
    [{ x: -14, y: -22 }, { x: -9, y: -34 }, { x: -13, y: -44 }, { x: -7, y: -52 }],
    [{ x: 12, y: -18 }, { x: 8, y: -30 }, { x: 13, y: -40 }],
    [{ x: 18, y: -74 }, { x: 24, y: -84 }],
  ]
    .map((line) => {
      const d = `M${line.map((q) => `${n(tx + q.x)} ${n(fy + q.y)}`).join('L')}`;
      return `<path d="${d}" stroke="${P.eyeGlow}" stroke-width="4" fill="none" opacity="${n(heat * 0.3)}" stroke-linejoin="round"/>` +
        `<path d="${d}" stroke="${P.eyeGlow}" stroke-width="1.4" fill="none" opacity="${n(heat)}" stroke-linejoin="round"/>`;
    })
    .join('');
  const grooves = [-10, 1, 11]
    .map((dx, i) => fill(`M${tx + dx} ${fy - 10}Q${tx + dx + (i - 1) * 4} ${fy - 40} ${tx + dx - 2} ${fy - 60}`, 'none', `stroke="${P.barkShade}" stroke-width="2.4" stroke-linecap="round"`))
    .join('');
  const faceY = fy - 64;
  const eyes = p.hurt
    ? shutEye(tx - 10, faceY, 4) + shutEye(tx + 10, faceY, -4)
    : [-1, 1]
        .map((s) =>
          // Hollow knot sockets with an ember burning deep inside; they narrow in the wind-up.
          fill(cutPoly(r(`socket${s}`), [{ x: tx + s * 4, y: faceY - 4 }, { x: tx + s * 16, y: faceY - 7 }, { x: tx + s * 15, y: faceY + 5 }, { x: tx + s * 5, y: faceY + 4 }], 0.6), P.ink) +
          slit(tx + s * 10, faceY, 4, s * (p.strike === 1 ? 22 : 12), P.eyeGlow))
        .join('');
  const mouthOpen = p.strike === 2 ? 9 : p.strike === 1 ? 5 : 3;
  const face =
    fill(cutPoly(r('brow'), [{ x: tx - 19, y: faceY - 9 }, { x: tx + 19, y: faceY - 9 }, { x: tx + 17, y: faceY - 5 }, { x: tx - 17, y: faceY - 5 }], 0.6), P.barkShade) +
    fill(`M${tx - 16} ${faceY - 6}L${tx + 16} ${faceY - 6}L${tx + 16} ${faceY + 5}L${tx - 16} ${faceY + 5}Z`, P.barkShade) +
    eyes +
    fill(cutPoly(r('mouth'), [{ x: tx - 13, y: faceY + 12 }, { x: tx - 4, y: faceY + 15 }, { x: tx + 5, y: faceY + 12 }, { x: tx + 13, y: faceY + 14 }, { x: tx + 9, y: faceY + 16 + mouthOpen }, { x: tx - 9, y: faceY + 15 + mouthOpen }], 0.5), P.ink) +
    // Splintered teeth along the top of its maw.
    [-9, -4, 1, 6].map((dx) => fill(`M${tx + dx} ${faceY + 13.5}L${tx + dx + 3.5} ${faceY + 13.5}L${tx + dx + 1.5} ${faceY + 17 + mouthOpen * 0.3}Z`, P.barkLight)).join('');
  // Long gnarled arms that end in three twig claws, moss hanging off them.
  const arms = [-1, 1]
    .map((s) => {
      const limb = taper([{ x: 0, y: 0 }, { x: 24, y: 3 }, { x: 46, y: -2 }, { x: 58, y: 2 }], 9, 4);
      const claws = [-26, 4, 30]
        .map((a) => group(fill(taper([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 15, y: 3 }], 3.2, 0.4), P.barkShade), `translate(56 2) rotate(${a})`))
        .join('');
      const moss = [14, 34].map((x, i) => hangingMoss(x, 4, 10 + i * 6, r(`armMoss${s}${i}`).next())).join('');
      return group(claws + fill(limb, P.bark) + moss, `translate(${n(tx + s * 28)} ${n(fy - 82)}) scale(${s} 1) rotate(${n(arm)})`);
    })
    .join('');
  // No leafy dome: a crown of bare, forking branches like antlers, a few dark tufts clinging to them.
  const crown = [
    [{ x: -8, y: -90 }, { x: -26, y: -112 }, { x: -34, y: -136 }, { x: -30, y: -148 }],
    [{ x: -26, y: -112 }, { x: -50, y: -122 }, { x: -66, y: -118 }],
    [{ x: 9, y: -90 }, { x: 26, y: -116 }, { x: 30, y: -142 }],
    [{ x: 26, y: -116 }, { x: 48, y: -128 }, { x: 64, y: -138 }],
    [{ x: 0, y: -94 }, { x: -3, y: -118 }, { x: 5, y: -134 }],
    [{ x: -34, y: -136 }, { x: -44, y: -144 }],
    [{ x: 30, y: -142 }, { x: 40, y: -150 }],
  ]
    .map((line, i) => fill(taper(line.map((q) => ({ x: tx + q.x, y: fy + q.y })), i < 5 ? 10 : 4, 1.5), i % 2 ? P.barkShade : P.bark))
    .join('');
  const tufts = [
    { x: -38, y: -120, rx: 14, ry: 8 },
    { x: 34, y: -128, rx: 13, ry: 8 },
    { x: 2, y: -126, rx: 9, ry: 6 },
  ]
    .map((t, i) => fill(ragged(r(`tuft${i}`), tx + t.x, fy + t.y, t.rx, t.ry, 10, 0.35), i === 2 ? P.canopy : P.canopyShade))
    .join('');
  const drapes = [{ x: -44, y: -118 }, { x: -20, y: -106 }, { x: 22, y: -110 }, { x: 44, y: -126 }]
    .map((m, i) => hangingMoss(tx + m.x, fy + m.y, 14 + (i % 2) * 9, r(`moss${i}`).next()))
    .join('');
  const body = sheet(roots) + sheet(crown + tufts + drapes, 2) + sheet(arms, 2) + sheet(fill(trunkD, P.bark) + grooves + cracks + sheet(face), 2);
  return contact(fx, fy, 42, 9) + posed({ ...p, lean: p.lean * 0.3, bob: p.bob }, fx, fy, body);
}

// ---------------------------------------------------------------------------------------------

const art = (
  size: { w: number; h: number; foot: { x: number; y: number } },
  views: readonly View[],
  draw: (action: Action, frame: number, view: View, champion: boolean) => string,
  grainSeed: number,
  extras: readonly Exclude<Action, BaseAction>[] = [],
): CharacterArt => ({
  w: size.w,
  h: size.h,
  anchor: size.foot,
  views,
  actions: { ...FRAMES, ...Object.fromEntries(extras.map((a) => [a, EXTRA_FRAMES[a]])) },
  draw: (action, frame, view, champion) => svgDoc(size.w, size.h, draw(action, frame, view, champion), grainSeed),
});

/** Every character with paper art, by entity kind. */
export const CHARACTERS: Readonly<Record<string, CharacterArt>> = {
  player: art(PLAYER, ['side', 'down', 'up'], (a, f, v) => drawPlayer(a, f, v), 3),
  goblin: art(GOBLIN, ['side'], (a, f, _v, c) => drawGoblin(a, f, c), 5, ['heal', 'healed']),
  seedSpitter: art(SPITTER, ['down'], (a, f, _v, c) => drawSeedSpitter(a, f, c), 7),
  boar: art(BOAR, ['side'], (a, f, _v, c) => drawBoar(a, f, c), 11),
  wasp: art(WASP, ['side'], (a, f, _v, c) => drawWasp(a, f, c), 13),
  ghoul: art(GHOUL, ['side'], (a, f, _v, c) => drawGhoul(a, f, c), 19, ['recover']),
  bat: art(BAT, ['side'], (a, f, _v, c) => drawBat(a, f, c), 23),
  treantBoss: art(TREANT, ['down'], (a, f) => drawTreant(a, f), 17),
};
