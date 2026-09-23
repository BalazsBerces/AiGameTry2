import type Phaser from 'phaser';
import type { Cell, Direction } from '../../core/floorGenerator';
import type { Weapon } from '../../core/weaponModel';

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
  /** Homing enemy shots steer toward the player. */
  fireEnemyShot(x: number, y: number, vx: number, vy: number, homing?: boolean): void;
  /** A sword arc from `from` in direction `aim`; hurts the player if they're inside it. */
  swingAtPlayer(from: { x: number; y: number }, aim: Direction): void;
  /** World position of the room's centre. */
  roomCenter: { x: number; y: number };
  /** Cells the room generator validated for mid-fight summons. */
  summonPoints: Cell[];
  /** Brings in a new zombie at a summon point; returns it so the summoner can track it. */
  summonZombie(cell: Cell): Enemy;
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
