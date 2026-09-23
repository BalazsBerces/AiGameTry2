import type Phaser from 'phaser';
import type { Direction } from '../../core/floorGenerator';
import { launchVelocity } from '../../core/weaponModel';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

const MIRROR: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * Floor 3 boss: chases the player's position point-mirrored through the room centre (terrain
 * still blocks it) and attacks in the mirrored direction with the player's own weapon.
 */
export function createShadow(scene: Phaser.Scene, x: number, y: number): Enemy {
  const { hp, follow, maxSpeedFactor } = TUNING.shadow;
  const sprite = scene.add
    .rectangle(x, y, TUNING.playerSize, TUNING.playerSize, COLORS.shadow)
    .setStrokeStyle(2, COLORS.shadowEdge) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  const maxSpeed = TUNING.playerSpeed * maxSpeedFactor;

  const enemy = singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    const target = { x: 2 * ctx.roomCenter.x - ctx.player.x, y: 2 * ctx.roomCenter.y - ctx.player.y };
    let vx = (target.x - sprite.x) * follow;
    let vy = (target.y - sprite.y) * follow;
    const speed = Math.hypot(vx, vy);
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
    }
    sprite.body.setVelocity(vx, vy);
  });
  enemy.onPlayerAttack = (ctx, aim, weapon) => {
    const mirrored = MIRROR[aim];
    if (weapon.mode === 'sword') {
      ctx.swingAtPlayer(sprite, mirrored);
      return;
    }
    const v = launchVelocity(mirrored, sprite.body.velocity, TUNING.shotSpeed);
    ctx.fireEnemyShot(sprite.x, sprite.y, v.x, v.y, weapon.homing);
  };
  return enemy;
}
