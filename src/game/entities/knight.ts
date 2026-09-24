import type Phaser from 'phaser';
import { stepDownhill } from '../../core/grid';
import { shieldBlocks, turnKnight } from '../../core/shield';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * The dungeon's skeleton knight: walks the distance field toward the player like a zombie, but
 * carries a shield that slowly turns to face them (core/shield). Shots and sword blows from the
 * front arc are blocked; its flanks and back are open. Bombs ignore the shield.
 */
export function createKnight(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const size = TUNING.knight.size * boost.scale;
  const speed = TUNING.knight.speed * boost.speed;
  const sprite = scene.add.circle(x, y, size / 2, championColor(COLORS.knight, champion)).setStrokeStyle(3, COLORS.knightEdge) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  sprite.body.setCircle(size / 2);
  // The shield: a slab held out in front, drawn over the body.
  // It is only raised once the knight wakes; until then nothing is blocked.
  const shield = scene.add.rectangle(x, y, size * 0.3, size * 1.15, COLORS.knightShield).setStrokeStyle(2, COLORS.knightEdge).setVisible(false);
  let facing: number | undefined;
  let lastTime: number | undefined;

  const placeShield = (f: number) => {
    shield.setVisible(true).setPosition(sprite.x + Math.cos(f) * size * 0.55, sprite.y + Math.sin(f) * size * 0.55).setRotation(f);
  };

  const enemy = singlePartEnemy(scene, sprite, TUNING.knight.hp * boost.hp, (ctx: EnemyContext) => {
    // It wakes up guarding the middle of the room, then turns to track the player.
    facing ??= Math.atan2(ctx.roomCenter.y - sprite.y, ctx.roomCenter.x - sprite.x);
    const dt = lastTime === undefined ? 0 : ctx.time - lastTime;
    lastTime = ctx.time;
    facing = turnKnight(facing, { x: ctx.player.x - sprite.x, y: ctx.player.y - sprite.y }, dt);

    const here = ctx.tileOf(sprite.x, sprite.y);
    const next = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y ? undefined : stepDownhill(ctx.walkDistance, here);
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    sprite.body.setVelocity((dx / len) * speed, (dy / len) * speed);
    placeShield(facing);
  });
  enemy.blocks = (_part, heading) => facing !== undefined && shieldBlocks(facing, heading);
  const hit = enemy.hit;
  enemy.hit = (part, damage) => {
    const remaining = hit(part, damage);
    if (!remaining.length) shield.destroy();
    return remaining;
  };
  return enemy;
}
