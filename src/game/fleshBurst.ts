import type Phaser from 'phaser';
import { COLORS, TUNING } from './config';

/** How big a flesh burst is: one segment popping, the head's blast, or the worm tearing at its split. */
export type BurstSize = 'pop' | 'head' | 'split';

type Point = { x: number; y: number };

/** Chunks and droplets fly over everything on the floor, under the player. */
const DEPTH = 5;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * A lump of flesh (or a drop of blood) flung from `at`: it arcs out and up, lands `reach` px away
 * or less, bounces once if it is a chunk, and spins as it goes; then it lies a while and fades.
 */
function fling(scene: Phaser.Scene, at: Point, piece: Phaser.GameObjects.Shape, reach: number, bounce: boolean) {
  const { flightMs, restMs, fadeMs } = TUNING.fleshBurst;
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
 * The worm boss's flesh bursting at `at`: chunks of its skin (`color`) and raw flesh fly, spin and bounce, dark
 * droplets spray, and a dark-red splat is left on `marks` (the fight's floor decals), if given, for good.
 */
export function fleshBurst(scene: Phaser.Scene, at: Point, size: BurstSize, color: number, marks?: Phaser.GameObjects.Graphics) {
  const spec = TUNING.fleshBurst[size];
  const reach = spec.reachTiles * TUNING.tile;
  if (marks) splat(marks, at, (spec.splatTiles * TUNING.tile) / 2);
  for (let i = 0; i < spec.chunks; i++) {
    const w = rand(spec.chunkPx[0], spec.chunkPx[1]);
    // Skin and the raw flesh under it.
    const chunk = scene.add.rectangle(at.x, at.y, w, w * rand(0.6, 1), i % 2 ? COLORS.wormFlesh : color).setDepth(DEPTH);
    chunk.setStrokeStyle(1, COLORS.wormBlood, 0.8);
    fling(scene, at, chunk, reach, true);
  }
  spray(scene, at, spec.drops, reach * 1.1);
}

/** A few dark droplets thrown from `at` (a split's raw end spurting). */
export function spray(scene: Phaser.Scene, at: Point, drops: number, reach = TUNING.tile * 0.6) {
  for (let i = 0; i < drops; i++) {
    const drop = scene.add.circle(at.x, at.y, rand(1.5, 3.2), COLORS.wormBlood).setDepth(DEPTH);
    fling(scene, at, drop, reach, false);
  }
}

/** A splat of dark red on the floor: a blob, with smaller drops thrown round it. */
function splat(g: Phaser.GameObjects.Graphics, at: Point, radius: number) {
  g.fillStyle(COLORS.wormSplat, 0.85);
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
