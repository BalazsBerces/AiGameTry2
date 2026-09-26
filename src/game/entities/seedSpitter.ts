import type Phaser from 'phaser';
import { spreadShots } from '../../core/enemies/forestCast';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Forest turret: a rooted pod that spits a fan of three seeds at the player on a timer, but
 * only while it can see them (spread in core/forestCast).
 */
export function createSeedSpitter(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const { shotSpeed } = TUNING.seedSpitter;
  const boost = championBoost(champion);
  const radius = TUNING.seedSpitter.radius * boost.scale;
  const hp = TUNING.seedSpitter.hp * boost.hp;
  // A turret never moves, so a champion's speed goes into firing faster.
  const fireDelayMs = TUNING.seedSpitter.fireDelayMs / boost.speed;
  const sprite = scene.add
    .circle(x, y, radius, championColor(COLORS.seedSpitter, champion))
    .setStrokeStyle(3, COLORS.seedSpitterEdge) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  let nextShotAt = 0;
  let firedAt = -Infinity;
  let sees = false;
  const enemy = singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    if (nextShotAt === 0) nextShotAt = ctx.time + fireDelayMs * (0.5 + Math.random() * 0.5);
    sees = ctx.canSeePlayer(sprite);
    if (ctx.time < nextShotAt || !sees) return;
    nextShotAt = ctx.time + fireDelayMs;
    firedAt = ctx.time;
    const aim = { x: ctx.player.x - sprite.x, y: ctx.player.y - sprite.y };
    for (const v of spreadShots(aim, shotSpeed)) ctx.fireEnemyShot(sprite.x, sprite.y, v.x, v.y);
  });
  // Swells just before it spits (only when it can see the player, as only then does it fire),
  // gapes as the seeds fly, then settles.
  enemy.visual = (time) =>
    time - firedAt < SPIT_FRAME_MS * 2 ? { hold: { action: 'attack', frame: time - firedAt < SPIT_FRAME_MS ? 1 : 2 } }
    : sees && nextShotAt > 0 && time >= nextShotAt - SPIT_FRAME_MS * 2 ? { hold: { action: 'attack', frame: 0 } }
    : {};
  return enemy;
}

/** How long each frame of the spit shows. */
const SPIT_FRAME_MS = 110;
