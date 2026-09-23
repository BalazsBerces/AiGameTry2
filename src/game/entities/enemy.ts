import type Phaser from 'phaser';
import type { Cell, Direction } from '../../core/floorGenerator';
import type { Tile } from '../../core/roomGenerator';
import type { Weapon } from '../../core/weaponModel';
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
  tileOf(x: number, y: number): Cell;
  tileCenter(tile: Cell): { x: number; y: number };
  /** True for in-room floor tiles. */
  isWalkable(tile: Cell): boolean;
  /** Obstacles block sight; holes do not. */
  canSeePlayer(from: { x: number; y: number }): boolean;
  /** Homing enemy shots steer toward the player; `bounces` is how often it ricochets off stone. */
  fireEnemyShot(x: number, y: number, vx: number, vy: number, homing?: boolean, bounces?: number): void;
  /** A sword arc from `from` in direction `aim`; hurts the player if they're inside it. */
  swingAtPlayer(from: { x: number; y: number }, aim: Direction): void;
  /** World position of the room's centre. */
  roomCenter: { x: number; y: number };
  /** The current room's tiles, for enemies that plan attacks over the terrain. */
  tiles: Tile[][];
  /** Hurts the player directly (for ground attacks such as the Treant's roots); invincibility frames apply. */
  hurtPlayer(): void;
}

export interface Enemy {
  /** Hittable sprites; touching any of them hurts the player. */
  parts: EnemySprite[];
  /** Physics walkers collide with terrain; grid movers (worms) plan their own moves instead. */
  collidesWithTerrain: boolean;
  update(ctx: EnemyContext): void;
  /** Called whenever the player attacks (used by the Shadow to mirror it). */
  onPlayerAttack?(ctx: EnemyContext, aim: Direction, weapon: Weapon): void;
  /** Damages one part. Returns the enemies that replace this one: itself, nothing (dead), or split pieces. */
  hit(part: EnemySprite, damage: number): Enemy[];
  /** Flyers (with `collidesWithTerrain` false) still hit walls and stone, but cross holes and thorns. */
  flies?: boolean;
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
