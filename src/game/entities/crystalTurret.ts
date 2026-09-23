import type Phaser from 'phaser';
import { CRYSTAL_TURRET_BOUNCES } from '../../core/ricochet';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/** A crystal on the cave floor: fires aimed shots, while it can see the player, that ricochet once off stone. */
export function createCrystalTurret(scene: Phaser.Scene, x: number, y: number): Enemy {
  const { size, hp, fireDelayMs, shotSpeed } = TUNING.crystalTurret;
  // A diamond: the physics body stays an axis-aligned square.
  const sprite = scene.add
    .rectangle(x, y, size * 0.8, size * 0.8, COLORS.crystalTurret)
    .setStrokeStyle(3, COLORS.crystalTurretEdge)
    .setAngle(45) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  let nextShotAt = 0;
  return singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    if (nextShotAt === 0) nextShotAt = ctx.time + fireDelayMs * (0.5 + Math.random() * 0.5);
    if (ctx.time < nextShotAt || !ctx.canSeePlayer(sprite)) return;
    nextShotAt = ctx.time + fireDelayMs;
    const dx = ctx.player.x - sprite.x;
    const dy = ctx.player.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    ctx.fireEnemyShot(sprite.x, sprite.y, (dx / len) * shotSpeed, (dy / len) * shotSpeed, false, CRYSTAL_TURRET_BOUNCES);
  });
}
