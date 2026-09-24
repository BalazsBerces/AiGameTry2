import type Phaser from 'phaser';
import type { Cell } from '../../core/floorGenerator';
import type { PackDecision, PackMember } from '../../core/forestCast';
import type { Door, Tile } from '../../core/roomGenerator';
import type { Stunnable } from '../../core/stun';
import { COLORS, TUNING } from '../config';

export type Body = Phaser.Physics.Arcade.Body;
export type EnemySprite = Phaser.GameObjects.Shape & { body: Body };

/** Per-frame information the scene hands to every enemy controller. */
export interface EnemyContext {
  time: number;
  player: { x: number; y: number };
  playerTile: Cell;
  /** Distance to the player's tile, per room tile (walkers descend it). */
  walkDistance: number[][];
  /** The same kind of field toward any tile, worked out once a frame per tile. */
  walkDistanceTo(tile: Cell): number[][];
  tileOf(x: number, y: number): Cell;
  tileCenter(tile: Cell): { x: number; y: number };
  /** True for in-room floor tiles. */
  isWalkable(tile: Cell): boolean;
  /** Obstacles block sight; holes do not. */
  canSeePlayer(from: { x: number; y: number }): boolean;
  /** Homing enemy shots steer toward the player; `bounces` is how often it ricochets off stone. */
  fireEnemyShot(x: number, y: number, vx: number, vy: number, homing?: boolean, bounces?: number): void;
  /** World position of the room's centre. */
  roomCenter: { x: number; y: number };
  /** The current room's tiles, for enemies that plan attacks over the terrain. */
  tiles: Tile[][];
  /** Hurts the player directly (for ground attacks such as the Treant's roots); invincibility frames apply. */
  hurtPlayer(): void;
  /** A charging boar ran into this tile: rock there breaks for good (core/world `smashRock`). */
  smashRock(tile: Cell): void;
  /** The current room's doors (attacks that reshape terrain keep their approaches clear). */
  doors: Door[];
  /**
   * A seed pod comes down on `cell`: it sprouts `tile` there for good (the world's tiles change),
   * or, if the player is standing on it, bursts on them instead. True if it sprouted.
   */
  landSeedPod(cell: Cell, tile: 'rock' | 'thorn'): boolean;
  /** The Treant walked into one of its own sprouts: it is floor again, for good. */
  crushSprout(cell: Cell): void;
  /** Moves the player straight away from `from` until they are `distance` px from it (if nearer). */
  pushPlayerOut(from: { x: number; y: number }, distance: number): void;
}

/**
 * Every enemy can be stunned (core/stun): `stun(enemy, time, ms)` from anywhere, and the scene
 * holds it still, skipping its `update`, until the stun wears off.
 */
export interface Enemy extends Stunnable {
  /** Hittable sprites; touching any of them hurts the player. */
  parts: EnemySprite[];
  /** Physics walkers collide with terrain; grid movers (worms) plan their own moves instead. */
  collidesWithTerrain: boolean;
  update(ctx: EnemyContext): void;
  /** Damages one part. Returns the enemies that replace this one: itself, nothing (dead), or split pieces. */
  hit(part: EnemySprite, damage: number): Enemy[];
  /**
   * Whether a shot or sword blow travelling along `heading` is turned aside by the part (the
   * knight's shield) instead of hurting it. Bombs, crushers and thorns never ask.
   */
  blocks?(part: EnemySprite, heading: { x: number; y: number }): boolean;
  /** Flyers (with `collidesWithTerrain` false) still hit walls and stone, but cross holes and thorns. */
  flies?: boolean;
  /** Parts that don't hurt the player on touch (the Candle Witch's candles); every part hurts if left out. */
  harmless?(part: EnemySprite): boolean;
  /**
   * Goblins decide as a pack (core/forestCast `updateGoblinPack`): each frame the scene gathers
   * every goblin's `member()` and hands each its new state through `follow` before updating it.
   */
  pack?: { member(ctx: EnemyContext): PackMember; follow(decision: PackDecision): void };
}

/** Stat multipliers for a champion, or none for a regular enemy. */
export const championBoost = (champion: boolean) => (champion ? TUNING.champion : { scale: 1, hp: 1, speed: 1 });

/** A champion's colour: its own blended halfway to gold. */
export function championColor(color: number, champion: boolean) {
  if (!champion) return color;
  const mix = (shift: number) => Math.round((((color >> shift) & 0xff) + ((COLORS.champion >> shift) & 0xff)) / 2) << shift;
  return mix(16) | mix(8) | mix(0);
}

/** Outlines a champion's sprite in gold. */
export function markChampion(sprite: Phaser.GameObjects.Shape, champion: boolean) {
  if (champion) sprite.setStrokeStyle(3, COLORS.champion);
}

/**
 * Gives a walker a round body as wide as the sprite's short side, centred on it, so it slides
 * round corners and other walkers instead of snagging on them.
 */
export function roundBody(sprite: EnemySprite) {
  const r = Math.min(sprite.width, sprite.height) / 2;
  sprite.body.setCircle(r, sprite.width / 2 - r, sprite.height / 2 - r);
}

/** Flash a part briefly to show it took damage. */
export function flash(scene: Phaser.Scene, part: EnemySprite) {
  part.setAlpha(0.5);
  scene.time.delayedCall(60, () => part.active && part.setAlpha(1));
}

/** An enemy made of one sprite with a shared hit-point pool. */
export function singlePartEnemy(
  scene: Phaser.Scene,
  sprite: EnemySprite,
  hp: number,
  update: (ctx: EnemyContext) => void,
): Enemy {
  const enemy: Enemy = {
    parts: [sprite],
    collidesWithTerrain: true,
    update,
    hit(_part, damage) {
      hp -= damage;
      if (hp > 0) {
        flash(scene, sprite);
        return [enemy];
      }
      sprite.destroy();
      return [];
    },
  };
  return enemy;
}
