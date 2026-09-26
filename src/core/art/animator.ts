import type { Action, View } from './characters';

/** What a character's art can do: its actions with their frame counts, and the ways it can face. */
export interface AnimatorSpec {
  actions: Readonly<Partial<Record<Action, number>>>;
  views: readonly View[];
  /** Frames a second: stop-motion, so low. */
  fps: number;
  /** How long the hurt pose holds after a hit. */
  hurtMs: number;
}

/** How a character is moving this frame: its velocity, and where it aims (it faces that way over its walk). */
export interface Motion {
  vx: number;
  vy: number;
  aim?: { x: number; y: number };
  /** A state the body reports that loops in place of idle and move (a goblin healing), if its art has frames for it. */
  loop?: Action;
  /** A frame the body holds for as long as it asks (a wind-up for the length of its telegraph): over all but hurt. */
  hold?: { action: Action; frame: number };
}

/** The frame of art to show. */
export interface AnimFrame {
  action: Action;
  frame: number;
  view: View;
  /** Mirror the `side` view to face left. */
  flip: boolean;
}

export interface Animator {
  /** Shows the hurt pose for `hurtMs`, over everything else. */
  hurt(time: number): void;
  /** Starts the attack, played once from its first frame; an attack while hurt is not shown. */
  attack(time: number): void;
  update(time: number, motion: Motion): AnimFrame;
}

/** Slower than this (px/s) counts as standing still. */
const MOVING = 5;

/** Picks a character's frame from what it is doing and the time, played at a fixed frame rate. */
export function createAnimator(spec: AnimatorSpec): Animator {
  const framesOf = (a: Action) => spec.actions[a] ?? 1;
  const msPerFrame = 1000 / spec.fps;
  let action: Action = 'idle';
  let since = 0;
  let attackAt = -Infinity;
  let hurtAt = -Infinity;
  const hurting = (time: number) => time - hurtAt < spec.hurtMs;
  let view: View = spec.views[0];
  let flip = false;
  const vertical = spec.views.includes('down') || spec.views.includes('up');
  /** Turns toward `dir`: sideways (mirrored for left) unless it points more up or down and there's a view for that. */
  const face = (dir: { x: number; y: number }) => {
    if (dir.x !== 0) flip = dir.x < 0;
    if (Math.abs(dir.x) >= Math.abs(dir.y) || !vertical) view = spec.views.includes('side') ? 'side' : view;
    else view = dir.y > 0 && spec.views.includes('down') ? 'down' : dir.y < 0 && spec.views.includes('up') ? 'up' : view;
  };
  const play = (next: Action, time: number) => {
    if (next === action) return;
    action = next;
    since = time;
  };
  return {
    hurt(time) {
      hurtAt = time;
    },
    attack(time) {
      if (hurting(time)) return;
      attackAt = time;
      action = 'attack';
      since = time;
    },
    update(time, motion) {
      const moving = Math.hypot(motion.vx, motion.vy) > MOVING;
      if (motion.aim) face(motion.aim);
      else if (moving) face({ x: motion.vx, y: motion.vy });
      const attacking = time - attackAt < framesOf('attack') * msPerFrame;
      if (hurting(time)) play('hurt', time);
      else if (motion.hold && spec.actions[motion.hold.action]) {
        play(motion.hold.action, time);
        return { action, frame: Math.min(motion.hold.frame, framesOf(action) - 1), view, flip };
      } else if (!attacking) play(motion.loop && spec.actions[motion.loop] ? motion.loop : moving ? 'move' : 'idle', time);
      const frame = Math.floor((time - since) / msPerFrame) % framesOf(action);
      return { action, frame, view, flip };
    },
  };
}
