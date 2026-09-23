import type Phaser from 'phaser';
import { spreadShots } from '../../core/forestCast';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Forest turret: a rooted pod that spits a fan of three seeds at the player on a timer, but
 * only while it can see them (spread in core/forestCast).
 */
export function createSeedSpitter(scene: Phaser.Scene, x: number, y: number): Enemy {
  const { radius, hp, fireDelayMs, shotSpeed } = TUNING.seedSpitter;
  const sprite = scene.add.circle(x, y, radius, COLORS.seedSpitter).setStrokeStyle(3, COLORS.seedSpitterEdge) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  let nextShotAt = 0;
  return singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    if (nextShotAt === 0) nextShotAt = ctx.time + fireDelayMs * (0.5 + Math.random() * 0.5);
    if (ctx.time < nextShotAt || !ctx.canSeePlayer(sprite)) return;
    nextShotAt = ctx.time + fireDelayMs;
    const aim = { x: ctx.player.x - sprite.x, y: ctx.player.y - sprite.y };
    for (const v of spreadShots(aim, shotSpeed)) ctx.fireEnemyShot(sprite.x, sprite.y, v.x, v.y);
  });
}
