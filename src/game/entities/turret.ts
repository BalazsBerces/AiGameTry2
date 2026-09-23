import type Phaser from 'phaser';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/** Stationary; fires an aimed shot on a timer, but only while it can see the player. */
export function createTurret(scene: Phaser.Scene, x: number, y: number): Enemy {
  const { size, hp, fireDelayMs, shotSpeed } = TUNING.turret;
  const sprite = scene.add.rectangle(x, y, size, size, COLORS.turret) as unknown as EnemySprite;
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
    ctx.fireEnemyShot(sprite.x, sprite.y, (dx / len) * shotSpeed, (dy / len) * shotSpeed);
  });
}
