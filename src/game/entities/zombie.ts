import type Phaser from 'phaser';
import { stepDownhill } from '../../core/map/grid';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, roundBody, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Walks the room's distance field toward the player, going around obstacles and holes.
 * `hp` overrides the default for a floor's tougher zombies.
 */
export function createZombie(scene: Phaser.Scene, x: number, y: number, champion = false, hp = TUNING.zombie.hp): Enemy {
  const boost = championBoost(champion);
  const size = TUNING.zombie.size * boost.scale;
  const speed = TUNING.zombie.speed * boost.speed;
  const sprite = scene.add.rectangle(x, y, size, size, championColor(COLORS.zombie, champion)) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  roundBody(sprite);
  return singlePartEnemy(scene, sprite, hp * boost.hp, (ctx: EnemyContext) => {
    const here = ctx.tileOf(sprite.x, sprite.y);
    const next = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y ? undefined : stepDownhill(ctx.walkDistance, here);
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    sprite.body.setVelocity((dx / len) * speed, (dy / len) * speed);
  });
}
