import type Phaser from 'phaser';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Floor 2 boss: a stationary core firing a rotating two-armed bullet spiral and
 * periodically summoning zombies at the room's validated summon points.
 */
export function createHive(scene: Phaser.Scene, x: number, y: number): Enemy {
  const { radius, hp, spiralDelayMs, spiralStep, shotSpeed, summonEveryMs, maxSummoned } = TUNING.hive;
  const sprite = scene.add.circle(x, y, radius, COLORS.hive).setStrokeStyle(4, COLORS.hiveRing) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setCircle(radius);
  sprite.body.setImmovable(true);
  let angle = 0;
  let nextShotAt = 0;
  let nextSummonAt = 0;
  let summoned: Enemy[] = [];

  return singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    if (nextShotAt === 0) {
      nextShotAt = ctx.time;
      nextSummonAt = ctx.time + summonEveryMs / 2;
    }
    while (ctx.time >= nextShotAt) {
      nextShotAt += spiralDelayMs;
      angle += spiralStep;
      for (const arm of [0, Math.PI]) {
        const a = angle + arm;
        ctx.fireEnemyShot(sprite.x + Math.cos(a) * radius, sprite.y + Math.sin(a) * radius, Math.cos(a) * shotSpeed, Math.sin(a) * shotSpeed);
      }
    }
    if (ctx.time >= nextSummonAt) {
      nextSummonAt = ctx.time + summonEveryMs;
      summoned = summoned.filter((z) => z.parts.some((p) => p.active));
      if (summoned.length < maxSummoned && ctx.summonPoints.length) {
        const cell = ctx.summonPoints[Math.floor(Math.random() * ctx.summonPoints.length)];
        summoned.push(ctx.summonZombie(cell));
      }
    }
  });
}
