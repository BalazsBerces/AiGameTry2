import type Phaser from 'phaser';
import { COLORS, TUNING } from '../config';

/** How big a shell burst is: one segment popping, the head's blast, or the worm tearing at its split. */
export type BurstSize = 'pop' | 'head' | 'split';

type Point = { x: number; y: number };

/** Shards and droplets fly over everything on the floor, under the player. */
const DEPTH = 5;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * A shard of shell (or a drop of ichor) flung from `at`: it arcs out and up, lands `reach` px away
 * or less, bounces once if it is a shard, and spins as it goes; then it lies a while and fades.
 */
function fling(scene: Phaser.Scene, at: Point, piece: Phaser.GameObjects.Shape, reach: number, bounce: boolean) {
  const { flightMs, restMs, fadeMs } = TUNING.shellBurst;
  const angle = Math.random() * Math.PI * 2;
  const far = reach * rand(0.35, 1);
  // Seen from above at a slant: the floor runs flatter up and down than across.
  const dx = Math.cos(angle) * far;
  const dy = Math.sin(angle) * far * 0.7;
  const height = reach * rand(0.35, 0.7);
  const spin = rand(-720, 720);
  const hop = (k: number) =>
    !bounce ? height * Math.sin(Math.PI * k) : k < 0.7 ? height * Math.sin((Math.PI * k) / 0.7) : height * 0.22 * Math.sin((Math.PI * (k - 0.7)) / 0.3);
  const duration = flightMs * (bounce ? 1 : 0.7) * rand(0.8, 1.15);
  scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration,
    onUpdate: (tween) => {
      const k = tween.getValue() ?? 0;
      // Fast out of the burst, slowing as it lands.
      const out = 1 - (1 - k) ** 2;
      piece.setPosition(at.x + dx * out, at.y + dy * out - hop(k)).setAngle(spin * out);
    },
    onComplete: () => {
      scene.tweens.add({ targets: piece, alpha: 0, delay: bounce ? restMs : restMs / 3, duration: fadeMs, onComplete: () => piece.destroy() });
    },
  });
}

/**
 * The worm boss's shell bursting at `at`: shards of it (`color`) fly, spin and bounce, orange ichor
 * sprays, and a splat of it is left on `marks` (the fight's floor decals), if given, for good.
 */
export function shellBurst(scene: Phaser.Scene, at: Point, size: BurstSize, color: number, marks?: Phaser.GameObjects.Graphics) {
  const spec = TUNING.shellBurst[size];
  const reach = spec.reachTiles * TUNING.tile;
  if (marks) splat(marks, at, (spec.splatTiles * TUNING.tile) / 2);
  for (let i = 0; i < spec.chunks; i++) {
    const w = rand(spec.chunkPx[0], spec.chunkPx[1]);
    // A jagged shard of its shell, some in its colour and some in its shadow, with a pale rim.
    const tip = rand(-0.3, 0.3) * w;
    const shard = scene.add
      .triangle(at.x, at.y, 0, 0, w, rand(-0.15, 0.15) * w, w / 2 + tip, w * rand(0.45, 0.8), i % 3 === 2 ? shade(color, 0.6) : color)
      .setDepth(DEPTH);
    shard.setStrokeStyle(1, COLORS.wormChitinEdge, 0.7);
    fling(scene, at, shard, reach, true);
  }
  spray(scene, at, spec.drops, reach * 1.1);
}

/** `color` darkened to `k` of its brightness. */
const shade = (color: number, k: number) =>
  (Math.round(((color >> 16) & 0xff) * k) << 16) | (Math.round(((color >> 8) & 0xff) * k) << 8) | Math.round((color & 0xff) * k);

/** A few droplets of orange ichor thrown from `at` (a split's raw end spurting). */
export function spray(scene: Phaser.Scene, at: Point, drops: number, reach = TUNING.tile * 0.6) {
  for (let i = 0; i < drops; i++) {
    const drop = scene.add.circle(at.x, at.y, rand(1.5, 3.2), COLORS.wormIchor).setDepth(DEPTH);
    fling(scene, at, drop, reach, false);
  }
}

/** A splat of ichor on the floor: a blob, with smaller drops thrown round it. */
function splat(g: Phaser.GameObjects.Graphics, at: Point, radius: number) {
  g.fillStyle(COLORS.wormIchorSplat, 0.7);
  g.fillEllipse(at.x, at.y + radius * 0.1, radius * 1.6, radius * 1.15);
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    g.fillCircle(at.x + Math.cos(a) * radius * 0.55, at.y + Math.sin(a) * radius * 0.4, radius * rand(0.3, 0.5));
  }
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = radius * rand(0.9, 1.6);
    g.fillCircle(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d * 0.75, radius * rand(0.07, 0.16));
  }
}

/** Shakes the playfield (the game's camera; the HUD stays put). Each shake cuts short the one before. */
export function shakeScreen(scene: Phaser.Scene, kind: keyof typeof TUNING.shake) {
  const { ms, intensity } = TUNING.shake[kind];
  scene.cameras.main.shake(ms, intensity, true);
}
