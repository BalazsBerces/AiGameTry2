import type { Motion } from './animator';
import type { GhoulState } from '../enemies/ghoul';
import type { Bat } from '../enemies/bat';

/** What a body reports about how it looks: a state to loop, a frame to hold, a way to face. */
export type Pose = Pick<Motion, 'loop' | 'hold' | 'aim'>;

/** How long each of the two strike frames shows while a lunge or swoop is held. */
const STRIKE_MS = 110;
const strike = (time: number) => ({ action: 'attack' as const, frame: 1 + (Math.floor(time / STRIKE_MS) % 2) });

/**
 * The ghoul's pose from its state: the wind-up held (eyes flared, the tell) for the whole tell,
 * the lunge held while it lunges, both facing the lunge; a winded stoop while it recovers.
 */
export function ghoulPose(state: GhoulState, time: number): Pose {
  switch (state.mode) {
    case 'windUp':
      return { hold: { action: 'attack', frame: 0 }, aim: state.direction };
    case 'lunge':
      return { hold: strike(time), aim: state.direction };
    case 'recover':
      return { loop: 'recover' };
    case 'stalk':
      return {};
  }
}

/**
 * The bat's pose from its state and where it is (in tiles): wings spread wide, hanging still,
 * through the tell, then the swoop held while it swoops, both facing where it dives.
 */
export function batPose(bat: Bat, at: { x: number; y: number }, time: number): Pose {
  switch (bat.mode) {
    case 'telegraph':
      return { hold: { action: 'attack', frame: 0 }, aim: { x: bat.target.x - at.x, y: bat.target.y - at.y } };
    case 'swoop':
      return { hold: strike(time), aim: { x: bat.target.x - at.x, y: bat.target.y - at.y } };
    case 'flutter':
      return {};
  }
}
