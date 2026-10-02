import { PAPER as P } from './palette';
import { blob, cutPoly, fill, group, n, pieceRng, polyPath, ragged, sheet, smoothPath, svgDoc } from './svg';
import { TILE } from './terrain';
import { WORM_PLATE_CELLS } from './castPoses';

/** What every character does, each drawn as a short stop-motion loop. */
export type BaseAction = 'idle' | 'move' | 'attack' | 'hurt';
/**
 * Base actions plus the ones only some characters have: a goblin healing its partner, being
 * healed, a ghoul catching its breath, a slime splatting down; the worm boss spitting, charging
 * up a lunge and lunging, lobbing an egg, torn open at its split and blowing apart as it dies.
 */
export type Action = BaseAction | 'heal' | 'healed' | 'recover' | 'land' | 'spit' | 'charge' | 'lunge' | 'lob' | 'split' | 'die';
/**
 * The way a character faces: `side` looks right (left is the mirror image), `down` at the camera,
 * `up` away; `top` is seen from straight above, pointing right, and turned whichever way its pose says.
 */
export type View = 'side' | 'down' | 'up' | 'top';

/** Frames per base action, the same for every character. */
export const FRAMES: Readonly<Record<BaseAction, number>> = { idle: 2, move: 4, attack: 3, hurt: 1 };
/** Frames of the extra actions a character may add. */
const EXTRA_FRAMES: Readonly<Record<Exclude<Action, BaseAction>, number>> = { heal: 2, healed: 2, recover: 2, land: 2, spit: 2, charge: 2, lunge: 2, lob: 2, split: 2, die: 2 };

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
    case 'land':
      return { ...base, squash: frame ? 0.92 : 0.8 };
    default:
      // The worm boss's own actions: it is drawn its own way (drawWorm).
      return base;
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
// Slime
// ---------------------------------------------------------------------------------------------

/** Drawn at the big slime's size: the medium and small ones are the same art, scaled down. */
const SLIME = { w: 58, h: 56, foot: { x: 29, y: 48 } };

/**
 * How a slime's goo is shaped in one frame: half its width, its height, how far its top draws up
 * into a point (`peak`) or its bottom down (`sag`), how flat it sits (near 0 spread on the floor,
 * 1 rounded off underneath in the air), and which way its top leans.
 */
interface Goo {
  w: number;
  h: number;
  peak: number;
  sag: number;
  flat: number;
  lean: number;
}

/** The outline of a body of goo standing on `base`, shaped by `g`. */
function gooOutline(rng: ReturnType<typeof pieceRng>, cx: number, base: number, g: Goo): string {
  const cy = base - g.h / 2;
  const pts = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2;
    const sin = Math.sin(a);
    const wobble = 1 + (rng.next() - 0.5) * 0.05;
    if (sin >= 0) return { x: cx + g.w * Math.cos(a) * (1 - g.sag * sin) * wobble, y: cy + (g.h / 2) * Math.pow(sin, g.flat) };
    const t = -sin;
    return { x: cx + g.w * Math.cos(a) * (1 - g.peak * t) * wobble + g.lean * t, y: cy - (g.h / 2) * t };
  });
  return smoothPath(pts);
}

function drawSlime(action: Action, frame: number, champion: boolean): string {
  const r = (part: string) => pieceRng('slime', action, frame, part);
  const { x: cx, y: fy } = SLIME.foot;
  const grounded = action !== 'move';
  // Squashed down ever lower through the tell (leaning back off where it will jump), stretched
  // tall through the jump, splatted flat where it lands; at rest it breathes.
  const g: Goo =
    action === 'attack'
      ? [{ w: 19, h: 19, peak: 0, sag: 0, flat: 0.3, lean: -1 }, { w: 20.5, h: 16.5, peak: 0, sag: 0, flat: 0.28, lean: -1.8 }, { w: 22, h: 14, peak: 0, sag: 0, flat: 0.25, lean: -2.6 }][frame]
      : action === 'move'
        ? [
            { w: 12.5, h: 31, peak: 0.35, sag: 0.25, flat: 0.8, lean: 3 },
            { w: 13.5, h: 29, peak: 0.25, sag: 0.1, flat: 0.9, lean: 2 },
            { w: 16, h: 25, peak: 0.08, sag: 0, flat: 1, lean: 0.6 },
            { w: 13, h: 29.5, peak: 0, sag: 0.35, flat: 1, lean: -1 },
          ][frame]
        : action === 'land'
          ? [{ w: 24, h: 12, peak: 0, sag: 0, flat: 0.2, lean: 0 }, { w: 19.5, h: 19.5, peak: 0.05, sag: 0, flat: 0.3, lean: 0.5 }][frame]
          : action === 'hurt'
            ? { w: 19, h: 20, peak: 0, sag: 0, flat: 0.3, lean: -2.5 }
            : [{ w: 17, h: 24, peak: 0.1, sag: 0, flat: 0.35, lean: 0 }, { w: 17.8, h: 22.6, peak: 0.05, sag: 0, flat: 0.32, lean: 0.6 }][frame];
  const base = grounded ? fy : fy - 2;
  const bodyD = gooOutline(r('body'), cx, base, g);
  const top = base - g.h;
  // The milky core hangs low in the goo; it shrinks and pales when hit.
  const coreS = action === 'hurt' ? 0.7 : 1;
  const coreX = cx + g.lean * 0.5 - (action === 'attack' ? 1 : 0);
  const coreY = base - g.h * (action === 'move' ? 0.5 : 0.4);
  const core =
    fill(blob(r('core'), coreX, coreY, g.w * 0.42 * coreS, g.h * 0.24 * coreS, 9, 0.14), C.slimeCore, `opacity="${action === 'hurt' ? 0.45 : 0.55}"`) +
    fill(blob(r('nucleus'), coreX + 0.8, coreY + 0.4, g.w * 0.24 * coreS, g.h * 0.14 * coreS, 8, 0.12), C.slimeCore, 'opacity="0.85"');
  // Grit and bubbles held in the goo.
  const specks = [{ x: -0.5, y: 0.62, s: 1.1 }, { x: 0.42, y: 0.55, s: 0.8 }, { x: 0.15, y: 0.25, s: 0.7 }, { x: -0.3, y: 0.3, s: 0.6 }]
    .map((q, i) => circle(cx + q.x * g.w + g.lean * (1 - q.y), base - q.y * g.h, q.s, i % 2 ? C.slimeLight : C.slimeDeep))
    .join('');
  // A soft wet sheen, never a facet: one curved gleam high on its shoulder.
  const shine =
    `<path d="M${n(cx - g.w * 0.62 + g.lean * 0.6)} ${n(base - g.h * 0.55)}Q${n(cx - g.w * 0.5 + g.lean * 0.8)} ${n(top + g.h * 0.12)} ${n(cx - g.w * 0.05 + g.lean)} ${n(top + g.h * 0.1)}" stroke="${C.slimeShine}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.6"/>` +
    circle(cx + g.w * 0.22 + g.lean, top + g.h * 0.2, 0.9, C.slimeShine);
  // Drips and droplets: running down its side at rest, flung out as it lands, trailing as it drops.
  const drop = (x: number, y: number, s: number) => fill(blob(r(`drop${n(x)}:${n(y)}`), x, y, s, s * 1.25, 7, 0.08), C.slime, 'opacity="0.9"');
  const drips =
    action === 'idle'
      ? drop(cx + g.w * 0.72, base - g.h * 0.28 + frame * 2, 1.4)
      : action === 'land' && frame === 0
        ? drop(cx - g.w - 3, base - 5, 1.6) + drop(cx + g.w + 3.5, base - 6, 1.4) + drop(cx - g.w + 1, base - 9, 1) + drop(cx + g.w - 1, base - 10, 1.1)
        : action === 'move' && frame === 3
          ? drop(cx - 3, top - 4, 1.4) + drop(cx + 2, top - 8, 1.1) + drop(cx - 1, top - 12, 0.8)
          : action === 'move' && frame === 0
            ? drop(cx - 6, base + 1.5, 1.6) + drop(cx + 5, base + 1, 1.3)
            : '';
  // A hit sends ripples through the goo.
  const ripples =
    action === 'hurt'
      ? [0.35, 0.6]
          .map((k) => `<path d="M${n(cx - g.w * k)} ${n(base - g.h * 0.5)}Q${n(cx)} ${n(base - g.h * (0.5 + k * 0.4))} ${n(cx + g.w * k)} ${n(base - g.h * 0.5)}" stroke="${C.slimeLight}" stroke-width="1" fill="none" opacity="0.7"/>`)
          .join('')
      : '';
  const body =
    trim(bodyD, champion) +
    fill(bodyD, C.slime, 'opacity="0.92"') +
    fill(blob(r('deep'), cx, base - g.h * 0.2, g.w * 0.8, g.h * 0.16, 9, 0.08), C.slimeDeep, 'opacity="0.55"') +
    core +
    specks +
    ripples +
    `<path d="${bodyD}" stroke="${C.slimeLight}" stroke-width="1.3" fill="none" opacity="0.7"/>` +
    shine;
  // In the air its shadow is the scene's, left on the floor below it.
  return (grounded ? contact(cx, fy, g.w * 0.92, 2.8) : '') + sheet(body, 2) + sheet(drips);
}

// ---------------------------------------------------------------------------------------------
// Geode
// ---------------------------------------------------------------------------------------------

const GEODE = { w: 66, h: 64, foot: { x: 33, y: 52 } };

/** One faceted crystal growing from x,y, `a` degrees off straight up, `len` long and `wide` across: a lit face and a shaded one. */
function prism(x: number, y: number, a: number, len: number, wide: number): string {
  const rad = (a * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = -Math.cos(rad);
  const at = (along: number, across: number) => ({ x: x + ux * along - uy * across, y: y + uy * along + ux * across });
  const tip = at(len, 0);
  const shoulderL = at(len * 0.72, -wide / 2);
  const shoulderR = at(len * 0.72, wide / 2);
  const mid = at(len * 0.7, 0);
  return (
    fill(polyPath([at(0, -wide / 2), shoulderL, tip, shoulderR, at(0, wide / 2)]), C.crystalShade) +
    fill(polyPath([at(0, -wide / 2), shoulderL, tip, mid, at(0, 0)]), C.crystal) +
    fill(polyPath([shoulderL, tip, mid]), C.crystalLight)
  );
}

/**
 * How a geode looks in a frame: `open`, how far it has split (its core shows past 0.5), and `glow`,
 * how bright the light through its seam and off its core burns. Its art and its light pool both read it.
 */
export function geodeLook(action: Action, frame: number): { open: number; glow: number } {
  const charging = action === 'attack';
  return {
    // Shut at rest, cracking along its seam as it charges, split open on its core, flung wide as it fires.
    open: charging ? [0.3, 1, 1.25][frame] : action === 'hurt' ? 0.1 : 0,
    // A faint pulse at rest, swelling through the charge, flaring as it fires.
    glow: charging ? [0.9, 1, 1.4][frame] : action === 'hurt' ? 0.2 : action === 'move' ? [0.3, 0.45, 0.38, 0.22][frame] : [0.25, 0.42][frame],
  };
}

function drawGeode(action: Action, frame: number, champion: boolean): string {
  const r = (part: string) => pieceRng('geode', part);
  const { x: cx, y: fy } = GEODE.foot;
  const base = fy - 1;
  const top = base - 30;
  const charging = action === 'attack';
  const { open, glow } = geodeLook(action, frame);
  // The seam it splits along, zigzagging down its face.
  const seam = [{ x: cx + 1, y: top }, { x: cx - 2, y: top + 7 }, { x: cx + 2, y: top + 14 }, { x: cx - 1.5, y: top + 21 }, { x: cx + 1, y: base - 1 }];
  const half = (s: number) => {
    const outer = [
      { x: cx + s * 9, y: base + 1 }, { x: cx + s * 17, y: base - 2 }, { x: cx + s * 20, y: base - 11 }, { x: cx + s * 18.5, y: top + 9 },
      { x: cx + s * 13, y: top + 2.5 }, { x: cx + s * 6, y: top - 0.5 },
    ];
    const d = cutPoly(r(`half${s}`), [...outer, ...seam], 0.5);
    // Its rough rind: lit facets up top, darker rock low down, bands of ochre strata, a crystal nub poking through.
    const rind =
      fill(cutPoly(r(`facet${s}`), [{ x: cx + s * 6, y: top + 0.5 }, { x: cx + s * 13, y: top + 3 }, { x: cx + s * 16, y: top + 9 }, { x: cx + s * 8, y: top + 8 }, { x: cx + s * 2, y: top + 4 }], 0.4), C.rockLight) +
      fill(cutPoly(r(`low${s}`), [{ x: cx + s * 2, y: base - 7 }, { x: cx + s * 18, y: base - 9 }, { x: cx + s * 17, y: base - 2 }, { x: cx + s * 9, y: base + 0.5 }, { x: cx + s * 1.5, y: base - 1 }], 0.4), C.rockDark, 'opacity="0.85"') +
      [0, 1]
        .map((i) => `<path d="M${n(cx + s * 3)} ${n(top + 14 + i * 6)}Q${n(cx + s * 11)} ${n(top + 12 + i * 6)} ${n(cx + s * (18 - i))} ${n(top + 16 + i * 6)}" stroke="${C.ochre}" stroke-width="1.2" fill="none" opacity="0.6"/>`)
        .join('') +
      fill(polyPath([{ x: cx + s * 14, y: top + 10 }, { x: cx + s * 16.5, y: top + 6.5 }, { x: cx + s * 16, y: top + 11 }]), C.crystalShade) +
      circle(cx + s * 15.6, top + 8.6, 0.6, C.crystalLight);
    // Where it split: crystal teeth lining the broken edge, seen once it opens.
    const lining =
      open > 0.5
        ? seam
            .slice(0, 4)
            .map((q, i) => fill(polyPath([{ x: q.x - s * 0.5, y: q.y + 1 }, { x: q.x + s * (3 + (i % 2) * 1.5), y: q.y + 3 }, { x: q.x - s * 0.5, y: q.y + 5 }]), i % 2 ? C.crystal : C.crystalShade))
            .join('')
        : '';
    const pivot = { x: cx + s * 15, y: base };
    return group(trim(d, champion) + fill(d, C.rock) + rind + lining, `translate(${n(s * open * 3.5)} 0) rotate(${n(s * open * 17)} ${n(pivot.x)} ${n(pivot.y)})`);
  };
  // The hollow and its crystal heart, behind the two halves: hidden while they're shut.
  const k = Math.min(1, open);
  const heart =
    open > 0.5
      ? fill(blob(r('hollow'), cx, base - 13, 6 + open * 7, 13, 9, 0.08), C.rockDeep) +
        `<ellipse cx="${cx}" cy="${n(base - 12)}" rx="${n(5 + glow * 4)}" ry="${n(7 + glow * 3)}" fill="${C.crystal}" opacity="${n(0.3 * glow)}"/>` +
        (charging && frame === 2 ? `<ellipse cx="${cx}" cy="${n(top + 8)}" rx="8" ry="6" fill="${C.crystalLight}" opacity="0.5"/>` : '') +
        prism(cx - 4, base - 6, -28, 13 * k, 5) + prism(cx + 4.5, base - 5, 30, 12 * k, 4.5) + prism(cx, base - 5, 2, 20 * k, 6.5) +
        prism(cx - 7, base - 3, -55, 8 * k, 3.5) + prism(cx + 7.5, base - 3, 58, 7 * k, 3)
      : '';
  // Light leaking through the seam: the first of the tell, and a faint pulse at rest.
  const seamD = `M${seam.map((q) => `${n(q.x)} ${n(q.y)}`).join('L')}`;
  const leak =
    open <= 0.5
      ? (charging ? `<ellipse cx="${cx}" cy="${n(top + 15)}" rx="9" ry="16" fill="${C.crystal}" opacity="0.22"/>` : '') +
        `<path d="${seamD}" stroke="${C.crystal}" stroke-width="${n(2 + glow * 3)}" fill="none" opacity="${n(glow * 0.45)}" stroke-linejoin="round"/>` +
        `<path d="${seamD}" stroke="${action === 'hurt' ? P.ink : C.crystalLight}" stroke-width="1.1" fill="none" opacity="${n(Math.min(1, 0.3 + glow))}" stroke-linejoin="round"/>`
      : '';
  // Firing: the core flares and splinters of light fly off it.
  const flare =
    charging && frame === 2
      ? [-50, -20, 15, 45]
          .map((a, i) => group(fill(polyPath([{ x: 0, y: -2 }, { x: 1.3, y: -7 - (i % 2) * 2 }, { x: -1.3, y: -7 - (i % 2) * 2 }]), C.crystalLight), `translate(${cx} ${n(top + 4)}) rotate(${a}) translate(0 -6)`))
          .join('')
      : '';
  // A hit knocks chips off its rind and jolts it.
  const chips =
    action === 'hurt'
      ? [{ x: -24, y: -18, a: 20 }, { x: 23, y: -22, a: -35 }, { x: 19, y: -8, a: 60 }]
          .map((c, i) => group(fill(cutPoly(r(`chip${i}`), [{ x: -2, y: -1.5 }, { x: 2, y: -1 }, { x: 1, y: 2 }, { x: -1.5, y: 1.2 }], 0.3), C.rockLight), `translate(${n(cx + c.x)} ${n(base + c.y)}) rotate(${c.a})`))
          .join('')
      : '';
  const body = heart + sheet(half(-1)) + sheet(half(1)) + leak;
  return contact(cx, fy, 21, 4) + group(sheet(body, 2) + flare + chips, `translate(0 ${action === 'hurt' ? -2 : 0})`);
}

// ---------------------------------------------------------------------------------------------
// Worm
// ---------------------------------------------------------------------------------------------

type Pt = { x: number; y: number };
type PieceRng = (part: string) => ReturnType<typeof pieceRng>;
type WormPieceArt = 'head' | 'body' | 'tail';

/**
 * A centipede's piece seen from above, pointing right and turned along its spine by its pose,
 * centred on its canvas. Its plate is longer than a cell (WORM_PLATE_CELLS) so neighbours overlap
 * at every bend, the one nearer the head on top.
 */
const CENTIPEDE = { w: 124, h: 72, foot: { x: 62, y: 36 } };
/** Half a plate's length, in px: a little over half a cell. */
const PLATE_HALF = (WORM_PLATE_CELLS * TILE) / 2;

/** The colours a centipede's plates are cut from. */
interface PlateLook {
  plate: string;
  light: string;
  dark: string;
  edge: string;
  mandible: string;
  mandibleTip: string;
  /** How opaque its plates are, if they are half-translucent (a hatchling's), its gut showing through. */
  veil?: number;
}
/** The regular worm: matte brown-black chitin, no glow. */
const MATTE: PlateLook = { plate: C.matte, light: C.matteLight, dark: C.matteDark, edge: C.matteEdge, mandible: C.mandible, mandibleTip: C.mandibleTip };
/** A hatchling: pale, soft, half-translucent plates, no glow. */
const PALE: PlateLook = { plate: C.pale, light: C.paleLight, dark: C.paleDark, edge: C.paleEdge, mandible: C.paleMandible, mandibleTip: C.paleMandibleTip, veil: 0.78 };
/**
 * What the worm boss, the Molten Centipede, shatters into at its split and as it blows apart:
 * mostly obsidian slivers, a chunk of basalt among them, with ember sparks and small blobs of magma.
 */
export const WORM_BOSS_BURST = { shards: [C.obsidian, C.obsidianLight, C.obsidian, C.crustDark, C.obsidianEdge], sparks: C.lavaCore, blobs: C.lava } as const;

/**
 * How a centipede piece moves in one frame: stretched along its spine and squeezed across it as
 * the crawl ripples through, wobbling a few degrees off it, its mandibles open `gape` wide.
 */
interface Ripple {
  stretch: number;
  squeeze: number;
  wobble: number;
  gape: number;
  hurt: boolean;
  /** How bright the light in its seams burns, flaring past 1; dark on a worm. */
  glow?: number;
  /** Torn open at its split: its loose end (the head's front, else its back) broken off in jagged glass. */
  torn?: boolean;
  /** Its plate parted down its keel this many px either way, and whether an egg is heaving out between. */
  parted?: { by: number; egg: boolean };
  /** Light splintering through its plate, just before it pops. */
  splinter?: boolean;
}

function ripple(action: Action, frame: number): Ripple {
  const base = { stretch: 1, squeeze: 1, wobble: 0, gape: 0.35, hurt: false };
  switch (action) {
    case 'move':
      return { ...base, stretch: [1, 1.04, 1.01, 0.96][frame], squeeze: [1, 0.96, 0.99, 1.04][frame], wobble: [0, 2.5, 0, -2.5][frame], gape: [0.3, 0.5, 0.4, 0.2][frame] };
    case 'attack':
      return { ...base, stretch: [0.96, 1.05, 0.98][frame], squeeze: [1.04, 0.97, 1.02][frame], gape: [0.8, 1.3, 0.5][frame] };
    case 'hurt':
      return { ...base, stretch: 0.95, squeeze: 1.05, wobble: -6, gape: 0.1, hurt: true };
    default:
      return { ...base, stretch: [1, 0.99][frame], squeeze: [1.01, 1.03][frame], gape: [0.3, 0.4][frame] };
  }
}

/** Points about the canvas's centre, along the spine (x) and across it (y). */
const along = (list: readonly (readonly [number, number])[], sx = 1, sy = 1): Pt[] =>
  list.map(([x, y]) => ({ x: CENTIPEDE.foot.x + x * sx, y: CENTIPEDE.foot.y + y * sy }));

/** A hooked mandible on side `s` (1 below the spine, -1 above), from x,y forward and curling in, opened `gape` wide. */
function mandible(x: number, y: number, s: 1 | -1, gape: number, look: PlateLook): string {
  const hook = taper([{ x: 0, y: 0 }, { x: 9, y: 2.5 * s }, { x: 17, y: 1.5 * s }, { x: 21, y: -2.5 * s }], 5.5, 0.6);
  const tip = taper([{ x: 14, y: 2 * s }, { x: 17, y: 1.5 * s }, { x: 21, y: -2.5 * s }], 2.4, 0.4);
  return group(fill(hook, look.mandible) + fill(tip, look.mandibleTip), `translate(${n(x)} ${n(y)}) rotate(${n(s * (gape * 24 - 4))})`);
}

/** An open line through `pts`. */
const linePath = (pts: readonly Pt[]) => `M${pts.map((q) => `${n(q.x)} ${n(q.y)}`).join('L')}`;

/**
 * A centipede piece's `plate` torn open at its split: its loose end (`off` 1 its front, -1 its
 * back) snapped off along a jagged break, `edge` drawn along the break and `shard` the splinters
 * left sticking out of it. Stretched `s` along its spine and `w` across it.
 */
function tearOff(plate: string, off: 1 | -1, s: number, w: number, edge: (d: string) => string, shard: (pts: Pt[], i: number) => string): string {
  const half = PLATE_HALF;
  const cut = off > 0 ? half - 17 : -half + 7;
  const jag = [-24, -15, -10, -5, 0, 5, 10, 15, 24].map((y, i) => [cut + off * ((i % 2 ? 3.5 : -1.5) + ((i * 7) % 3) * 0.8), y] as const);
  const kept = [...jag, [cut - off * 80, 24], [cut - off * 80, -24]] as const;
  const shards = [[-12, 6, 4], [-2, 4.5, -3], [9, 5.5, 5]]
    .map(([y, len, tilt], i) => {
      const at = jag[2 + i * 2];
      return shard(along([[at[0] - off * 1, y - 2], [at[0] + off * len, y + tilt * 0.3], [at[0] - off * 1, y + 2]], s, w), i);
    })
    .join('');
  return `<clipPath id="torn"><path d="${polyPath(along(kept, s, w))}"/></clipPath><g clip-path="url(#torn)">${plate}</g>` + edge(linePath(along(jag.slice(1, -1), s, w))) + shards;
}

/**
 * A centipede piece's `plate` parted down its keel `by` px either way as an egg heaves out of it:
 * `gap` showing between the halves, and the egg's shell in it if it is still there. Stretched `s`
 * along its spine.
 */
function partOpen(plate: string, { by, egg }: { by: number; egg: boolean }, s: number, gap: string): string {
  const { x: cx, y: cy } = CENTIPEDE.foot;
  const side = (id: string, y: number, h: number, dy: number) =>
    `<clipPath id="${id}"><rect x="-40" y="${n(y)}" width="${CENTIPEDE.w + 80}" height="${n(h)}"/></clipPath>` + group(`<g clip-path="url(#${id})">${plate}</g>`, `translate(0 ${n(dy)})`);
  const shell = egg
    ? ellipse(cx, cy, 9 * s, by + 1.5, C.egg) + ellipse(cx + 2, cy + by * 0.4, 6 * s, by * 0.6, C.eggShade, 'opacity="0.7"') + ellipse(cx - 3, cy - by * 0.3, 3, by * 0.35, C.eggLight, 'opacity="0.8"')
    : '';
  return gap + shell + side('upper', -40, 40 + cy, -by) + side('lower', cy, 40 + CENTIPEDE.h, by);
}

/**
 * One piece of a centipede from above, pointing right: a body plate with flanged sides and a keel
 * down its middle, its back rim lapped over the plate behind; the head's rounder plate with dull
 * eye pits and hooked mandibles; the tail's tapering plate trailing one long stinger. No legs.
 * `breadth` widens it across its spine. A half-translucent look (a hatchling's) shows its gut.
 */
function centipedePiece(piece: WormPieceArt, c: Ripple, champion: boolean, look: PlateLook, r: PieceRng, breadth = 1): string {
  const s = c.stretch;
  const w = c.squeeze * breadth;
  const half = PLATE_HALF;
  const { x: cx, y: cy } = CENTIPEDE.foot;
  const outline =
    piece === 'head'
      ? ([[half - 12, 0], [half - 15, -9], [half - 24, -13.5], [-6, -15], [-half + 8, -13], [-half + 2, -7], [-half, 0], [-half + 2, 7], [-half + 8, 13], [-6, 15], [half - 24, 13.5], [half - 15, 9]] as const)
      : piece === 'tail'
        ? ([[half, 0], [half - 4, -9], [half - 14, -13.5], [0, -13], [-half + 14, -9], [-half + 8, -4], [-half + 6, 0], [-half + 8, 4], [-half + 14, 9], [0, 13], [half - 14, 13.5], [half - 4, 9]] as const)
        : ([[half, 0], [half - 4, -9], [half - 14, -14], [0, -15.5], [-half + 10, -15], [-half + 2, -10], [-half, 0], [-half + 2, 10], [-half + 10, 15], [0, 15.5], [half - 14, 14], [half - 4, 9]] as const);
  const plateD = smoothPath(along(outline, s, w));
  // Its back corners swept back into spikes over the plate behind: what it has instead of legs.
  const spikes = [-1, 1]
    .map((side) => {
      const reach = piece === 'tail' ? 11 : piece === 'head' ? 12 : 13.5;
      const tip: [number, number] = [-half - (piece === 'tail' ? 1 : 5), side * (reach + 6)];
      const pts = along([[-half + 15, side * (reach - 1)], tip, [-half + 3, side * (reach - 4)]], s, w);
      return fill(cutPoly(r(`spike${side}`), pts, 0.4), look.plate, look.veil ? `opacity="${look.veil}"` : '') + `<path d="M${n(pts[0].x)} ${n(pts[0].y)}L${n(pts[1].x)} ${n(pts[1].y)}" stroke="${look.edge}" stroke-width="0.9" opacity="0.7"/>`;
    })
    .join('');
  // The shadow it throws over the plate behind, past its back rim.
  const seam = `<path d="M${n(cx - (half - 8) * s)} ${n(cy - 14 * w)}Q${n(cx - (half + 9) * s)} ${n(cy)} ${n(cx - (half - 8) * s)} ${n(cy + 14 * w)}" stroke="${look.dark}" stroke-width="4" fill="none" opacity="0.7"/>`;
  const shadow = ellipse(cx, cy, half * s + 3, 18 * w, P.shadow, 'opacity="0.35"');
  const shade = fill(polyPath(along([[half, 4], [-half, 4], [-half, 16], [half, 16]], s, w)), look.dark, 'opacity="0.4"');
  const keelEnd = piece === 'head' ? half - 16 : half - 4;
  const keel = `<path d="M${n(cx - (half - 6) * s)} ${n(cy)}L${n(cx + keelEnd * s)} ${n(cy)}" stroke="${look.light}" stroke-width="1.6" opacity="0.7"/>`;
  // A groove across its back, and the rim of its back edge lapped over the plate behind.
  const groove = piece === 'head' ? '' : `<path d="M${n(cx + 6 * s)} ${n(cy - 13 * w)}Q${n(cx + 1 * s)} ${n(cy)} ${n(cx + 6 * s)} ${n(cy + 13 * w)}" stroke="${look.dark}" stroke-width="1.4" fill="none"/>`;
  const rim = `<path d="M${n(cx - (half - 9) * s)} ${n(cy - 13 * w)}Q${n(cx - (half + 1) * s)} ${n(cy)} ${n(cx - (half - 9) * s)} ${n(cy + 13 * w)}" stroke="${look.edge}" stroke-width="1.6" fill="none"/>`;
  const sheen = `<path d="M${n(cx - (half - 12) * s)} ${n(cy - 9 * w)}Q${n(cx)} ${n(cy - 13 * w)} ${n(cx + (half - 16) * s)} ${n(cy - 8 * w)}" stroke="${look.light}" stroke-width="1.2" fill="none" opacity="0.55"/>`;
  // Half-translucent, the floor and its gut showing dimly through.
  const veil = look.veil ? `opacity="${look.veil}"` : '';
  const gut = look.veil ? ellipse(cx - 2 * s, cy + 1, (half - 9) * s, 4.5 * w, look.dark, 'opacity="0.3"') : '';
  const plate = seam + trim(plateD, champion) + spikes + fill(plateD, look.plate, veil) + gut + shade + keel + groove + rim + sheen;
  let ends = '';
  if (piece === 'head') {
    const front = cx + (half - 14) * s;
    const eye = (side: number) => ellipse(front - 6, cy + side * 7 * w, 1.6, 1.2, look.dark) + ellipse(front - 6.4, cy + side * 7 * w - 0.4, 0.6, 0.5, look.edge, 'opacity="0.6"');
    ends = mandible(front, cy - 5 * w, -1, c.gape, look) + mandible(front, cy + 5 * w, 1, c.gape, look) + [-1, 1].map(eye).join('');
  }
  if (piece === 'tail') {
    const root = cx - (half - 8) * s;
    ends = fill(taper([{ x: root + 4, y: cy }, { x: root - 12, y: cy + 1 }, { x: root - 26, y: cy - 0.5 }, { x: root - 36, y: cy - 3.5 }], 7, 0.5), look.mandible) +
      fill(taper([{ x: root - 24, y: cy - 0.4 }, { x: root - 30, y: cy - 1.5 }, { x: root - 36, y: cy - 3.5 }], 2.6, 0.4), look.mandibleTip);
  }
  const body = shadow + ends + plate;
  const chips = c.hurt
    ? [[-14, -20, 25], [12, 19, -40], [20, -18, 70]].map(([x, y, a], i) => group(fill(cutPoly(r(`chip${i}`), [{ x: -2, y: -1.4 }, { x: 2, y: -1 }, { x: 1, y: 1.8 }, { x: -1.5, y: 1.2 }], 0.3), look.edge), `translate(${n(cx + x)} ${n(cy + y)}) rotate(${a})`)).join('')
    : '';
  return group(body, `rotate(${n(c.wobble)} ${cx} ${cy})`) + chips;
}

function drawWorm(piece: WormPieceArt, action: Action, frame: number, champion: boolean): string {
  return centipedePiece(piece, ripple(action, frame), champion, MATTE, (part) => pieceRng('worm', piece, part));
}

/** A hatchling's piece: the worm's own build, a little slighter, in pale, soft, half-translucent plates. */
function drawHatchling(piece: WormPieceArt, action: Action, frame: number): string {
  return centipedePiece(piece, ripple(action, frame), false, PALE, (part) => pieceRng('hatchling', piece, part), 0.9);
}

/**
 * The worm boss, the Obsidian Centipede, drawn on a canvas of its own at its own size: its plates
 * as long as a worm's and as broad as its segments, its stinger and splayed mandibles reaching
 * past them.
 */
const WORM_BOSS = { w: 140, h: 88, foot: { x: 70, y: 44 } };
/** How much broader its plates are than a worm's: as broad as its segments (38 px to the worm's 31). */
const BOSS_BREADTH = 1.22;

/**
 * How a piece of the worm boss moves in a frame, and how bright its seams burn: they pulse dimly
 * as it crawls and at rest; its mandibles splay and its whole body blazes as it roars. Charging
 * up its mandibles spread wide and its seams brighten, shuddering; lunging they snap shut, its
 * body taut. Spitting, its maw pulses and a segment's seams flare as its shot leaves it. Lobbing,
 * its plates part as an egg heaves out between them, then close. Torn at the split, its loose
 * end is broken glass leaking light, twitching. Dying it holds dim, then blazes, light
 * splintering through its plates, just before it pops.
 */
function bossRipple(action: Action, frame: number): Ripple {
  const base = { ...ripple(action, frame), glow: [0.35, 0.45][frame] ?? 0.4 };
  switch (action) {
    case 'move':
      return { ...base, glow: [0.4, 0.55, 0.47, 0.32][frame] };
    case 'attack':
      return { ...base, gape: [1.1, 2, 1.7][frame], glow: [1.1, 1.9, 1.6][frame] };
    case 'hurt':
      return { ...base, glow: 0.15 };
    case 'spit':
      return { ...base, stretch: [1, 0.97][frame], squeeze: [1, 1.05][frame], gape: [0.9, 1.3][frame], glow: [0.6, 1.5][frame] };
    case 'charge':
      return { ...base, stretch: [0.94, 0.92][frame], squeeze: [1.05, 1.07][frame], wobble: [1.5, -1.5][frame], gape: [1.5, 1.7][frame], glow: [1, 1.2][frame] };
    case 'lunge':
      return { ...base, stretch: [1.06, 1.08][frame], squeeze: [0.95, 0.93][frame], wobble: [1, -1][frame], gape: [-0.25, -0.3][frame], glow: [0.2, 0.25][frame] };
    case 'lob':
      return { ...base, squeeze: [1.08, 1.03][frame], gape: [0.5, 0.4][frame], glow: [0.9, 0.6][frame], parted: { by: [5, 2.5][frame], egg: frame === 0 } };
    case 'split':
      return { ...base, wobble: [3, -3][frame], gape: [0.25, 0.15][frame], glow: [1, 0.8][frame], torn: true };
    case 'die':
      return { ...base, stretch: [0.98, 1.03][frame], gape: [0.1, 0.05][frame], glow: [0.5, 2.4][frame], splinter: frame === 1 };
    default:
      return base;
  }
}

/** A crack wandering from `from` (along the spine, across it) the way `dir` points, for `steps` steps of about `len`, kept within `reach` of the plate's middle. */
function crackLine(r: ReturnType<typeof pieceRng>, from: readonly [number, number], dir: readonly [number, number], steps: number, len: number, reach: Pt): [number, number][] {
  const pts: [number, number][] = [[from[0], from[1]]];
  let [x, y] = from;
  for (let i = 0; i < steps; i++) {
    const a = Math.atan2(dir[1], dir[0]) + (r.next() - 0.5) * 1.1;
    x = Math.max(-reach.x, Math.min(reach.x, x + Math.cos(a) * len * (0.7 + r.next() * 0.6)));
    y = Math.max(-reach.y, Math.min(reach.y, y + Math.sin(a) * len * (0.7 + r.next() * 0.6)));
    pts.push([x, y]);
  }
  return pts;
}

/**
 * The cracks across one of the Molten Centipede's plates, by piece and (for its body) which of
 * its three patterns: a few running out from its keel to its flanks, each branching once.
 */
function moltenCracks(piece: WormPieceArt, variant: number): [number, number][][] {
  const r = pieceRng('wormBossMolten', piece, variant, 'cracks');
  const reach = { x: PLATE_HALF - 7, y: 11.5 };
  const starts = piece === 'head' ? [-14, -2] : piece === 'tail' ? [-12, 2] : [-18, -6, 6, 16];
  return starts.flatMap((x, i) => {
    const side = (i + variant) % 2 ? 1 : -1;
    const main = crackLine(r, [x + (r.next() - 0.5) * 4, (r.next() - 0.5) * 2], [(r.next() - 0.5) * 1.4, side], piece === 'body' ? 4 : 3, 3, reach);
    const branch = crackLine(r, main[2], [r.next() > 0.5 ? 1 : -1, side * 0.4], 2, 3, reach);
    return [main, branch];
  });
}

/**
 * One piece of the Molten Centipede from above, pointing right: obsidian, all edges. A slim,
 * angular core pointed fore and aft, broken into facets of black glass (lit above, dark below,
 * glinting along their ridges), grown out of a mass of basalt crust showing at its flanks.
 * Backswept blades of glass off its flanks and a ridge of raked shards down its keel, each split
 * into a lit face and a dark one. Lava runs in the joints between its facets and in cracks across
 * them, a deep red rim round orange round a yellow-hot core, opening as wide as its `glow` says,
 * and wells up as a thin seam under its back rim, dripping. The head: slanted molten eyes under a
 * crown of blades, and long serrated mandibles edged in lava; the tail: a long obsidian spike of a
 * stinger with a lava vein. Its mandibles and stinger end in pale glass points.
 */
function moltenPiece(piece: WormPieceArt, c: Ripple, variant: number, r: PieceRng): string {
  const s = c.stretch;
  const w = c.squeeze * BOSS_BREADTH;
  const half = PLATE_HALF;
  const { x: cx, y: cy } = CENTIPEDE.foot;
  const heat = c.glow ?? 0.4;
  type P2 = readonly [number, number];
  const at = (list: readonly P2[]) => along(list, s, w);
  const poly = (list: readonly P2[]) => polyPath(at(list));
  // A crack of lava, layered from its rim in: the hotter, the wider it runs.
  const crack = (d: string, k = 1) => {
    const width = (0.45 + heat * 1) * k;
    const line = (color: string, wide: number, extra = '') => `<path d="${d}" stroke="${color}" stroke-width="${n(width * wide)}" fill="none" stroke-linejoin="miter" stroke-linecap="round"${extra}/>`;
    return line(C.obsidianDark, 3.2, ' opacity="0.8"') + line(C.lavaDeep, 2.2, ' opacity="0.9"') + line(C.lava, 1.3) + line(C.lavaCore, 0.55) + (heat > 1.4 ? line(C.lavaHot, 0.22) : '');
  };
  // A blade of obsidian from `root` (its two base corners) out to `tip`: split down its length
  // into a lit face and a dark one, its leading edge glinting.
  const blade = (a: P2, b: P2, tip: P2, glint = true) => {
    const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [pa, pb, pt] = at([a, b, tip]);
    return (
      fill(poly([a, tip, mid]), C.obsidianLight) + fill(poly([mid, tip, b]), C.obsidianDark) +
      `<path d="${polyPath([pa, pt, pb])}" fill="none" stroke="${C.obsidian}" stroke-width="0.5" stroke-linejoin="miter"/>` +
      (glint ? `<path d="${linePath([pa, pt])}" stroke="${C.obsidianGlint}" stroke-width="0.7" opacity="0.85"/>` : '')
    );
  };
  // Its core: slim and angular, pointed fore and aft, broken into facets of glass.
  const nose = piece === 'head' ? half - 2 : piece === 'tail' ? half + 2 : half + 3;
  const tailEnd = piece === 'tail' ? -half + 4 : -half - 3;
  const core: P2[] = [[nose, 0], [half - 9, -9.5], [-5, -11], [-half + 5, -8.5], [tailEnd, 0], [-half + 5, 8.5], [-5, 11], [half - 9, 9.5]];
  const keel: P2[] = [[nose - 1, 0], [1, -0.5], [tailEnd + 1, 0]];
  const panes = [
    { pts: [keel[0], core[1], core[2], keel[1]], color: C.obsidianLight },
    { pts: [keel[1], core[2], core[3], keel[2]], color: C.obsidian },
    { pts: [keel[0], keel[1], core[6], core[7]], color: C.obsidian },
    { pts: [keel[1], keel[2], core[5], core[6]], color: C.obsidianDark },
  ];
  // Under the glass, a mass of basalt crust it grew out of, showing at its flanks.
  const rock = fill(cutPoly(r('rock'), at(core.map(([x, y]) => [x * 0.96, y * 1.18 + 1.8] as const)), 0.9), C.crustDark) +
    fill(cutPoly(r('rockLip'), at([[half - 10, 9], [-4, 12.5], [-half + 6, 10], [-half + 8, 12], [-4, 14], [half - 12, 11.5]]), 0.6), C.crust) +
    `<path d="${linePath(at([[half - 11, 11.6], [-4, 14], [-half + 8, 12]]))}" stroke="${C.crustLight}" stroke-width="0.8" fill="none" opacity="0.8"/>`;
  const glass = panes.map(({ pts, color }) => fill(poly(pts), color)).join('') + fill(poly([[half - 12, -7.5], [-2, -9], [4, -3.5]]), C.obsidianEdge, 'opacity="0.35"');
  const facetEdges = `<path d="${linePath(at([core[1], keel[0], core[7]]))}" stroke="${C.obsidianGlint}" stroke-width="0.8" fill="none" opacity="0.8" stroke-linejoin="miter"/>` +
    `<path d="${linePath(at([core[1], core[2], core[3]]))}" stroke="${C.obsidianEdge}" stroke-width="0.7" fill="none" opacity="0.8"/>`;
  // Lava in the joints between its facets: down its keel and across its middle.
  const joints = crack(linePath(at(keel)), 0.8) + crack(linePath(at([core[2], keel[1], core[6]])), 0.6);
  // And its own cracks running out across the panes.
  const cracks = moltenCracks(piece, variant).map((line, i) => crack(linePath(at(line)), i % 2 ? 0.5 : 0.75)).join('');
  // Backswept blades off its flanks, longer toward the front; the tail's shorter.
  const reach = piece === 'tail' ? 0.75 : 1;
  const flanks = [-1, 1]
    .map((side) =>
      (piece === 'head' ? [[half - 16, 18, 1.1]] : [[half - 9, 19, 1], [-5, 15, 0.85]]).map(([x, len, k], i) =>
        blade([x + 7, side * 8], [x - 6, side * 10.5], [x - len * 0.95 * reach, side * (10 + len * 0.6 * k * reach)], i === 0),
      ).join(''),
    )
    .join('');
  // A ridge of shards down its keel, raked back, tallest toward the head, each throwing a shadow.
  const ridgeAt = piece === 'head' ? [-6, -18] : piece === 'tail' ? [2, -12] : [12, 0, -12];
  const tall = piece === 'tail' ? 0.75 : 1;
  const ridge = ridgeAt
    .map((x, i) => {
      const len = (12 - i * 1.5) * tall;
      const shade = fill(poly([[x + 2, 2], [x - len + 1, 3.5], [x - 1, 5]]), P.shadow, 'opacity="0.45"');
      return shade + blade([x + 3, -3.8], [x + 3, 3.8], [x - len, -0.5]);
    })
    .join('');
  // Lava welling up from under its back rim, a thin bright seam, a drip trailing off it.
  const ooze = 0.5 + Math.min(heat, 2) * 0.3;
  const back = tailEnd;
  const welling = at([[-half + 7, -9.5], [back - 1.2 * ooze, -4], [back - 1.8 * ooze, 0], [back - 1.2 * ooze, 4], [-half + 7, 9.5]]);
  const seam =
    `<path d="${linePath(welling)}" stroke="${C.lavaDeep}" stroke-width="${n(2.4 + ooze * 1.6)}" fill="none" stroke-linecap="round" stroke-linejoin="miter"/>` +
    `<path d="${linePath(welling)}" stroke="${C.lava}" stroke-width="${n(1 + ooze * 1.1)}" fill="none" stroke-linecap="round" stroke-linejoin="miter"/>` +
    `<path d="${linePath(welling.slice(1, 4))}" stroke="${C.lavaCore}" stroke-width="${n(0.4 + ooze * 0.5)}" fill="none" stroke-linecap="round"/>`;
  const [dripFrom, dripTo] = at([[back - 1.8 * ooze, 1], [back - 1.8 * ooze - 5 * ooze, 1.6]]);
  const drip = `<path d="${linePath([dripFrom, dripTo])}" stroke="${C.lava}" stroke-width="0.9" stroke-linecap="round"/>` + ellipse(dripTo.x, dripTo.y, 1.1 * ooze, 0.9 * ooze, C.lava) + ellipse(dripTo.x + 0.2, dripTo.y - 0.1, 0.5 * ooze, 0.4 * ooze, C.lavaCore);
  const shadow = ellipse(cx + 2, cy + 3.5, half * s + 4, 16 * w, P.shadow, 'opacity="0.38"');
  // About to pop: lava floods up through a second web of cracks.
  const flood = c.splinter ? moltenCracks(piece, variant + 3).map((line, i) => crack(linePath(at(line)), i % 2 ? 0.8 : 1.1)).join('') : '';
  let plate = seam + drip + flanks + rock + glass + joints + cracks + flood + facetEdges + ridge;
  // Broken off at its split, its raw molten core showing at the break, splinters of glass sticking out.
  if (c.torn) {
    const splinter = (pts: Pt[], i: number) => fill(polyPath(pts), i % 2 ? C.obsidianLight : C.obsidian, `stroke="${C.obsidianEdge}" stroke-width="0.5"`);
    plate = tearOff(plate, piece === 'head' ? 1 : -1, s, w, (edge) => crack(edge, 1.8), splinter);
  }
  // Heaving out an egg, its glass split on magma.
  if (c.parted) {
    const { by } = c.parted;
    plate = partOpen(plate, c.parted, s, ellipse(cx, cy, (half - 5) * s, by + 2.5, C.lavaDeep) + ellipse(cx, cy, (half - 8) * s, by + 1, C.lava) + crack(linePath(at([[-half + 8, 0], [half - 8, 0]]))));
  }
  let ends = '';
  let face = '';
  if (piece === 'head' && !c.torn) {
    const front = half - 6;
    // A long serrated blade of a mandible, its inner edge molten, a pale glass tip.
    const jaw = (side: 1 | -1) => {
      const outer: P2[] = [[-3, -1.5 * side], [10, 1 * side], [21, 0.5 * side], [28, -4.5 * side]];
      const inner: P2[] = [[25, -2.5 * side], [19, 3.2 * side], [16, 1.6 * side], [12, 4.4 * side], [9, 2.6 * side], [4, 4.6 * side], [-3, 3.5 * side]];
      const d = polyPath([...outer, ...inner].map(([x, y]) => ({ x, y })));
      const edge = `M${inner.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}`;
      const tip = polyPath([{ x: 22, y: 0.2 * side }, { x: 28, y: -4.5 * side }, { x: 25, y: -2.5 * side }]);
      const [o] = at([[front, side * 4.5]]);
      return group(
        fill(d, C.obsidian, `stroke="${C.obsidianEdge}" stroke-width="0.9" stroke-linejoin="miter"`) +
          `<path d="${edge}" stroke="${C.lava}" stroke-width="0.7" fill="none" opacity="0.85" stroke-linejoin="miter"/>` +
          `<path d="M0 ${n(-0.4 * side)}L20 ${n(0.4 * side)}" stroke="${C.obsidianGlint}" stroke-width="0.8" opacity="0.85"/>` + fill(tip, C.glassFangTip),
        `translate(${n(o.x)} ${n(o.y)}) rotate(${n(side * (c.gape * 24 - 4))})`,
      );
    };
    ends = jaw(-1) + jaw(1);
    // Slanted molten eyes under a brow of shards, a crown of blades raked back over its skull.
    const eye = (side: 1 | -1) => {
      const pts: P2[] = [[half - 9, side * 3.5], [half - 16, side * 7.5], [half - 13, side * 4]];
      return fill(poly(pts.map(([x, y]) => [x + 0.6, y + side * 0.6] as const)), C.obsidianDark) + fill(poly(pts), C.lavaDeep) +
        fill(poly([[half - 10, side * 4], [half - 14.5, side * 6.4], [half - 12.6, side * 4.4]]), heat > 1.4 ? C.lavaHot : C.lavaCore);
    };
    const crown = [-1, 1].map((side) => blade([half - 15, side * 5], [half - 19, side * 8.5], [half - 34, side * 13])).join('') + blade([half - 12, -2], [half - 12, 2], [half - 30, 0]);
    face = crown + [-1, 1].map((side) => eye(side as 1 | -1)).join('');
  }
  if (piece === 'tail' && !c.torn) {
    // A long obsidian spike of a stinger, a lava vein down it and a pale glass point.
    const root = -half + 7;
    const len = 40;
    ends =
      blade([root, -3.5], [root, 3.5], [root - len, -2.5], false) +
      `<path d="${linePath(at([[root - 2, 0], [root - len * 0.55, -0.8]]))}" stroke="${C.lava}" stroke-width="1" fill="none" opacity="0.9"/>` +
      `<path d="${linePath(at([[root - 1, -2.6], [root - len * 0.8, -2.4]]))}" stroke="${C.obsidianGlint}" stroke-width="0.7" opacity="0.8"/>` +
      fill(poly([[root - len * 0.82, -1.4], [root - len, -2.5], [root - len * 0.82, -3.2]]), C.glassFangTip);
  }
  const body = shadow + ends + plate + face;
  const chips = c.hurt
    ? [[-14, -20, 25], [12, 19, -40], [20, -18, 70]].map(([x, y, a], i) => group(fill(polyPath([{ x: -2.6, y: -0.8 }, { x: 2.8, y: -0.4 }, { x: -0.6, y: 1.6 }]), i % 2 ? C.obsidianLight : C.obsidianEdge), `translate(${n(cx + x)} ${n(cy + y)}) rotate(${a})`)).join('')
    : '';
  return group(body, `rotate(${n(c.wobble)} ${cx} ${cy})`) + chips;
}

/**
 * A piece of the worm boss, the Molten Centipede, acting out its fight from above, pointing right
 * and turned along its spine, broad as its segments; its body cracked in pattern `variant` (0–2).
 */
function drawWormBoss(piece: WormPieceArt, action: Action, frame: number, variant = 0): string {
  const body = moltenPiece(piece, bossRipple(action, frame), variant, (part) => pieceRng('wormBossMolten', piece, variant, part));
  const { x: cx, y: cy } = CENTIPEDE.foot;
  // Its own canvas is bigger than a worm's: the piece sits in the middle of it.
  return group(body, `translate(${WORM_BOSS.foot.x - cx} ${WORM_BOSS.foot.y - cy})`);
}

/**
 * The rubble lip laid over the cut where the worm boss slides into the wall or out of it, seen
 * from above: broken rock heaped along the hole's mouth across its spine, the wall to its right,
 * turned the way the wall lies. The cut runs down the middle of its canvas, under the heap.
 */
export const WORM_BOSS_LIP = { w: 44, h: 84, foot: { x: 26, y: 42 } };

function drawWormBossLip(): string {
  const r: PieceRng = (part) => pieceRng('wormBossLip', part);
  const { x, y } = WORM_BOSS_LIP.foot;
  // Its shadow falls on the plates sliding under it, on the room side.
  const shadow = ellipse(x - 7, y, 13, 38, P.shadow, 'opacity="0.45"');
  const bank = fill(ragged(r('bank'), x - 2, y, 10, 35, 18, 0.3), C.rockDeep);
  const heap = fill(ragged(r('heap'), x - 3.5, y, 8, 32, 16, 0.35), C.rock);
  const crest = fill(ragged(r('crest'), x - 5, y, 3.5, 26, 12, 0.4), C.rockLight, 'opacity="0.8"');
  // Chips broken off the rock, strewn along the heap and spilling a little into the room.
  const chips = [[-33, -2, 2.8, 20], [-26, -9, 2.2, -35], [-19, 1, 3.2, 60], [-11, -8, 2.4, -10], [-3, -1, 2, 45], [4, -10, 2.8, -60], [12, 0, 2.2, 80], [19, -7, 3, 15], [27, -1, 2.3, -40], [33, -6, 1.9, 30], [-22, -16, 1.8, 10], [9, -17, 1.9, -20], [-6, -19, 1.5, 50], [24, -15, 1.6, -70]]
    .map(([dy, dx, size, a], i) =>
      group(
        fill(cutPoly(r(`chip${i}`), [{ x: -size, y: -size * 0.7 }, { x: size, y: -size * 0.8 }, { x: size * 0.8, y: size * 0.7 }, { x: -size * 0.7, y: size * 0.9 }], 0.3), i % 3 ? C.rock : C.rockLight),
        `translate(${n(x + dx)} ${n(y + dy)}) rotate(${a})`,
      ),
    )
    .join('');
  return shadow + sheet(bank + heap + crest) + sheet(chips);
}

/** The worm boss's rubble lip as a finished drawing, grained like the boss. */
export const wormBossLipSvg = () => svgDoc(WORM_BOSS_LIP.w, WORM_BOSS_LIP.h, drawWormBossLip(), 41);

// ---------------------------------------------------------------------------------------------
// The worm boss's eggs
// ---------------------------------------------------------------------------------------------

const EGG = { w: 40, h: 50, foot: { x: 20, y: 40 } };
const EGG_MID = { x: 20, y: 27 };

/**
 * The veins across an egg's shell, as points across its width and height (-1..1): the one down
 * its crown it first cracks along, then the ones branching off it, then the last down its side.
 */
const EGG_VEINS = [
  [[0, -1], [0.16, -0.72], [-0.06, -0.46], [0.12, -0.2], [0, 0.06]],
  [[-0.06, -0.46], [-0.38, -0.36], [-0.62, -0.1], [-0.7, 0.22]],
  [[0.12, -0.2], [0.44, -0.06], [0.6, 0.28], [0.5, 0.6]],
  [[0, 0.06], [-0.16, 0.4], [-0.06, 0.76]],
] as const;

/**
 * A dark leathery pod at x,y, `size` times full size, thin veins glowing across it, cracked open
 * along them as far as `crack` (0 whole; 1 its crown vein split, light leaking; 2 its branches
 * split too, brighter; 3 every vein split, its crown gaping on the hatchling's pale plate),
 * squashed by `squash` as it breathes.
 */
function eggPod(r: PieceRng, x: number, y: number, size: number, crack: number, squash = 1): string {
  const rx = 11 * size * (2 - squash);
  const ry = 13.5 * size * squash;
  const at = (dx: number, dy: number) => `${n(x + dx * rx)} ${n(y + dy * ry)}`;
  const shell = fill(blob(r('shell'), x, y, rx, ry, 11, 0.04), C.egg);
  const shade = `<path d="M${at(0.95, -0.2)}Q${at(0.9, 0.85)} ${at(-0.1, 0.98)}Q${at(0.55, 0.55)} ${at(0.95, -0.2)}Z" fill="${C.eggShade}" opacity="0.7"/>`;
  const shine = ellipse(x - rx * 0.38, y - ry * 0.4, rx * 0.2, ry * 0.26, C.eggLight, 'opacity="0.6"');
  // Wrinkles in the leather.
  const wrinkles = [[[-0.7, -0.5], [-0.45, -0.62]], [[0.55, -0.6], [0.78, -0.35]], [[0.3, 0.78], [0.62, 0.55]]]
    .map((line) => `<path d="M${line.map(([dx, dy]) => at(dx, dy)).join('L')}" stroke="${C.eggShade}" stroke-width="${n(0.9 * size)}" fill="none" opacity="0.8"/>`)
    .join('');
  // How many veins have split: its crown first, then its branches, then all of them.
  const split = [0, 1, 3, 4][Math.min(3, crack)];
  const veins = EGG_VEINS.map((line, i) => {
    const d = `M${line.map(([dx, dy]) => at(dx, dy)).join('L')}`;
    const open = i < split;
    // Whole, a thin dim thread of light; split open, a dark rent with the light leaking out round it.
    const glow = `<path d="${d}" stroke="${C.lavaDeep}" stroke-width="${n((open ? 2.6 + crack * 0.5 : 1.1) * size)}" fill="none" opacity="${open ? n(0.35 + crack * 0.12) : '0.2'}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const thread = `<path d="${d}" stroke="${open ? C.mawDeep : C.lava}" stroke-width="${n((open ? 1.1 : 0.4) * size)}" fill="none" opacity="${open ? '1' : '0.45'}" stroke-linejoin="round"/>`;
    return glow + thread;
  }).join('');
  // Splitting: its crown gaping along the veins, the hatchling's pale plate showing in the gap.
  const gap =
    crack >= 3
      ? fill(`M${at(-0.62, -0.1)}L${at(-0.38, -0.36)}L${at(-0.06, -0.46)}L${at(0.16, -0.72)}L${at(0.3, -0.5)}L${at(0.12, -0.2)}L${at(0.44, -0.06)}L${at(0.2, 0.02)}L${at(-0.04, -0.24)}L${at(-0.4, -0.16)}Z`, C.mawDeep) +
        ellipse(x + 0.05 * rx, y - 0.24 * ry, rx * 0.22, ry * 0.1, C.pale, 'opacity="0.85"')
      : '';
  return shell + shade + shine + wrinkles + veins + gap;
}

/**
 * An egg the worm boss lobbed: resting, squashing a little as it breathes; tumbling end over end
 * through the air; cracking ever wider as it wobbles to hatch; chipped by a hit.
 */
function drawEgg(action: Action, frame: number): string {
  const r: PieceRng = (part) => pieceRng('wormEgg', part);
  const { x, y } = EGG_MID;
  const ground = contact(x, EGG.foot.y, 10, 3);
  switch (action) {
    case 'move':
      // In flight its shadow is on the floor below, not under it.
      return sheet(group(eggPod(r, x, y, 1, 0), `rotate(${frame * 90} ${x} ${y})`));
    case 'attack':
      return ground + sheet(eggPod(r, x, y, 1, frame + 1));
    case 'hurt': {
      const chips = [[-14, -12, 30], [13, -16, -50]]
        .map(([dx, dy, a], i) => group(fill(cutPoly(r(`chip${i}`), [{ x: -2, y: -1.2 }, { x: 2, y: -1 }, { x: 1, y: 1.6 }, { x: -1.4, y: 1 }], 0.3), C.eggLight), `translate(${x + dx} ${y + dy}) rotate(${a})`))
        .join('');
      return ground + group(sheet(eggPod(r, x, y, 1, 1, 0.94) + fill(ragged(r('dent'), x + 4, y - 6, 3, 2.5, 7, 0.3), C.eggShade)), `rotate(-6 ${x} ${EGG.foot.y})`) + chips;
    }
    default:
      return ground + sheet(eggPod(r, x, y + (frame ? 0.4 : 0), 1, 0, frame ? 0.97 : 1));
  }
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

/** What the worm boss acts out besides crawling, rearing (its roar) and flinching; it tunnels as it crawls. */
const BOSS_ACTIONS = ['spit', 'charge', 'lunge', 'lob', 'split', 'die'] as const;

/** Every character with paper art, by entity kind. */
export const CHARACTERS: Readonly<Record<string, CharacterArt>> = {
  player: art(PLAYER, ['side', 'down', 'up'], (a, f, v) => drawPlayer(a, f, v), 3),
  goblin: art(GOBLIN, ['side'], (a, f, _v, c) => drawGoblin(a, f, c), 5, ['heal', 'healed']),
  seedSpitter: art(SPITTER, ['down'], (a, f, _v, c) => drawSeedSpitter(a, f, c), 7),
  boar: art(BOAR, ['side'], (a, f, _v, c) => drawBoar(a, f, c), 11),
  wasp: art(WASP, ['side'], (a, f, _v, c) => drawWasp(a, f, c), 13),
  ghoul: art(GHOUL, ['side'], (a, f, _v, c) => drawGhoul(a, f, c), 19, ['recover']),
  bat: art(BAT, ['side'], (a, f, _v, c) => drawBat(a, f, c), 23),
  slime: art(SLIME, ['side'], (a, f, _v, c) => drawSlime(a, f, c), 29, ['land']),
  geode: art(GEODE, ['down'], (a, f, _v, c) => drawGeode(a, f, c), 31),
  wormHead: art(CENTIPEDE, ['top'], (a, f, _v, c) => drawWorm('head', a, f, c), 37),
  wormBody: art(CENTIPEDE, ['top'], (a, f, _v, c) => drawWorm('body', a, f, c), 37),
  wormTail: art(CENTIPEDE, ['top'], (a, f, _v, c) => drawWorm('tail', a, f, c), 37),
  hatchlingHead: art(CENTIPEDE, ['top'], (a, f) => drawHatchling('head', a, f), 39),
  hatchlingBody: art(CENTIPEDE, ['top'], (a, f) => drawHatchling('body', a, f), 39),
  hatchlingTail: art(CENTIPEDE, ['top'], (a, f) => drawHatchling('tail', a, f), 39),
  // The worm boss, the Molten Centipede: its body plates in three crack patterns.
  wormBossHead: art(WORM_BOSS, ['top'], (a, f) => drawWormBoss('head', a, f), 41, BOSS_ACTIONS),
  wormBossBody0: art(WORM_BOSS, ['top'], (a, f) => drawWormBoss('body', a, f, 0), 41, BOSS_ACTIONS),
  wormBossBody1: art(WORM_BOSS, ['top'], (a, f) => drawWormBoss('body', a, f, 1), 41, BOSS_ACTIONS),
  wormBossBody2: art(WORM_BOSS, ['top'], (a, f) => drawWormBoss('body', a, f, 2), 41, BOSS_ACTIONS),
  wormBossTail: art(WORM_BOSS, ['top'], (a, f) => drawWormBoss('tail', a, f), 41, BOSS_ACTIONS),
  wormEgg: art(EGG, ['down'], (a, f) => drawEgg(a, f), 43),
  treantBoss: art(TREANT, ['down'], (a, f) => drawTreant(a, f), 17),
};
