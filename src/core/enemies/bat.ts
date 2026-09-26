import type { Rng } from '../rng';

/**
 * The caves' bat. It flutters erratically about its roost, darting between random spots within
 * `flutterRadius` of it (chasms are no obstacle to a flyer). Once rested, a player within
 * `swoopRange` makes it hang still for `telegraphMs` (the tell), then swoop in a straight line at
 * where the player stood when it started the tell, so stepping aside dodges it. Where the swoop
 * ends becomes its new roost. Positions are in tiles, speeds in tiles per second.
 */
export interface BatRules {
  flutterRadius: number;
  flutterSpeed: number;
  /** On average this often it darts to a fresh spot before reaching the last one. */
  retargetMs: number;
  swoopRange: number;
  telegraphMs: number;
  swoopSpeed: number;
  /** A swoop held up (by a wall, say) this long is given up. */
  maxSwoopMs: number;
  /** Rest between swoops (and, up to half again, before the first). */
  restMs: number;
}

/** Placeholder numbers for playtest tuning. */
export const BAT: BatRules = {
  flutterRadius: 1.2,
  flutterSpeed: 3,
  retargetMs: 350,
  swoopRange: 4.5,
  telegraphMs: 450,
  swoopSpeed: 9,
  maxSwoopMs: 900,
  restMs: 1400,
};

type Point = { x: number; y: number };

export type Bat =
  | { mode: 'flutter'; roost: Point; spot: Point; readyAt: number }
  | { mode: 'telegraph'; target: Point; swoopAt: number }
  | { mode: 'swoop'; target: Point; giveUpAt: number };

export interface BatSenses {
  time: number;
  /** Time since the last frame. */
  dtMs: number;
  /** The bat's position. */
  at: Point;
  player: Point;
}

export interface BatStep {
  bat: Bat;
  /** How to fly this frame (still while telegraphing). */
  velocity: Point;
}

/** How close counts as having reached a flutter spot or the end of a swoop. */
const ARRIVE = 0.25;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** A random spot within the flutter radius of the roost. */
function spotNear(roost: Point, rng: Rng, rules: BatRules): Point {
  const angle = rng.next() * Math.PI * 2;
  const r = Math.sqrt(rng.next()) * rules.flutterRadius;
  return { x: roost.x + Math.cos(angle) * r, y: roost.y + Math.sin(angle) * r };
}

function toward(from: Point, to: Point, speed: number): Point {
  const d = dist(from, to);
  return d === 0 ? { x: 0, y: 0 } : { x: ((to.x - from.x) / d) * speed, y: ((to.y - from.y) / d) * speed };
}

export const createBat = (roost: Point, time: number, rng: Rng, rules: BatRules = BAT): Bat => ({
  mode: 'flutter',
  roost: { ...roost },
  spot: spotNear(roost, rng, rules),
  readyAt: time + rules.restMs * (1 + rng.next() * 0.5),
});

/** One frame of the bat. Pure given the rng: the same rng and senses give the same flight. */
export function updateBat(bat: Bat, senses: BatSenses, rng: Rng, rules: BatRules = BAT): BatStep {
  const { time, at, player } = senses;
  switch (bat.mode) {
    case 'flutter': {
      if (time >= bat.readyAt && dist(at, player) <= rules.swoopRange) {
        return { bat: { mode: 'telegraph', target: { ...player }, swoopAt: time + rules.telegraphMs }, velocity: { x: 0, y: 0 } };
      }
      const darts = rng.next() < senses.dtMs / rules.retargetMs;
      const spot = darts || dist(at, bat.spot) < ARRIVE ? spotNear(bat.roost, rng, rules) : bat.spot;
      return { bat: { ...bat, spot }, velocity: toward(at, spot, rules.flutterSpeed) };
    }
    case 'telegraph':
      if (time < bat.swoopAt) return { bat, velocity: { x: 0, y: 0 } };
      return {
        bat: { mode: 'swoop', target: bat.target, giveUpAt: time + rules.maxSwoopMs },
        velocity: toward(at, bat.target, rules.swoopSpeed),
      };
    case 'swoop': {
      if (dist(at, bat.target) > ARRIVE && time < bat.giveUpAt) return { bat, velocity: toward(at, bat.target, rules.swoopSpeed) };
      const spot = spotNear(at, rng, rules);
      return { bat: { mode: 'flutter', roost: { ...at }, spot, readyAt: time + rules.restMs }, velocity: toward(at, spot, rules.flutterSpeed) };
    }
  }
}
