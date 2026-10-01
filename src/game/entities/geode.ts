import type Phaser from 'phaser';
import { GEODE_BOUNCES } from '../../core/player/ricochet';
import { geodePose } from '../../core/art/castPoses';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/** A crystal on the cave floor: fires aimed shots, while it can see the player, that ricochet once off stone. */
export function createGeode(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const { shotSpeed } = TUNING.geode;
  const boost = championBoost(champion);
  const size = TUNING.geode.size * boost.scale;
  const hp = TUNING.geode.hp * boost.hp;
  // A turret never moves, so a champion's speed goes into firing faster.
  const fireDelayMs = TUNING.geode.fireDelayMs / boost.speed;
  // A diamond: the physics body stays an axis-aligned square.
  const sprite = scene.add
    .rectangle(x, y, size * 0.8, size * 0.8, championColor(COLORS.geode, champion))
    .setStrokeStyle(3, COLORS.geodeEdge)
    .setAngle(45) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  let nextShotAt = 0;
  let firedAt: number | undefined;
  const enemy = singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    if (nextShotAt === 0) nextShotAt = ctx.time + fireDelayMs * (0.5 + Math.random() * 0.5);
    if (ctx.time < nextShotAt || !ctx.canSeePlayer(sprite)) return;
    nextShotAt = ctx.time + fireDelayMs;
    firedAt = ctx.time;
    const dx = ctx.player.x - sprite.x;
    const dy = ctx.player.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    ctx.fireEnemyShot(sprite.x, sprite.y, (dx / len) * shotSpeed, (dy / len) * shotSpeed, false, GEODE_BOUNCES);
  });
  // A cracked rock geode: it splits open on its crystal core as the shot charges, and flares as it fires.
  enemy.visual = (time) => geodePose({ nextShotAt, firedAt }, time);
  return enemy;
}
