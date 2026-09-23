import type Phaser from 'phaser';
import { stepDownhill } from '../../core/grid';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Walks the room's distance field toward the player, going around obstacles and holes.
 * `hp` overrides the default for a floor's tougher zombies.
 */
export function createZombie(scene: Phaser.Scene, x: number, y: number, hp = TUNING.zombie.hp): Enemy {
  const { size, speed } = TUNING.zombie;
  const sprite = scene.add.rectangle(x, y, size, size, COLORS.zombie) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  return singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    const here = ctx.tileOf(sprite.x, sprite.y);
    const next = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y ? undefined : stepDownhill(ctx.walkDistance, here);
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    sprite.body.setVelocity((dx / len) * speed, (dy / len) * speed);
  });
}
