import type Phaser from 'phaser';
import { createGoblin as newGoblinState, goblinStep, updateGoblin } from '../../core/forestCast';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, roundBody, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Forest walker: rushes the player faster than a zombie, runs off to regroup once below half
 * HP, then comes back (rules in core/forestCast). Drawn as a pointed triangle.
 */
export function createGoblin(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const size = TUNING.goblin.size * boost.scale;
  const maxHp = TUNING.goblin.hp * boost.hp;
  const speed = TUNING.goblin.speed * boost.speed;
  const retreatSpeed = TUNING.goblin.retreatSpeed * boost.speed;
  const sprite = scene.add
    .triangle(x, y, 0, size, size / 2, 0, size, size, championColor(COLORS.goblin, champion))
    .setStrokeStyle(2, COLORS.goblinEdge) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  roundBody(sprite);
  let hp = maxHp;
  let state = newGoblinState();
  const enemy = singlePartEnemy(scene, sprite, maxHp, (ctx: EnemyContext) => {
    state = updateGoblin(state, hp, maxHp, ctx.time);
    const here = ctx.tileOf(sprite.x, sprite.y);
    const onPlayer = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y;
    const next = onPlayer && state.mode === 'chase' ? undefined : goblinStep(state, ctx.walkDistance, here);
    if (!next && state.mode === 'retreat') {
      // Cornered: hold still and wait out the retreat.
      sprite.body.setVelocity(0, 0);
      return;
    }
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    const v = state.mode === 'retreat' ? retreatSpeed : speed;
    sprite.body.setVelocity((dx / len) * v, (dy / len) * v);
  });
  const hit = enemy.hit;
  enemy.hit = (part, damage) => {
    hp -= damage;
    return hit(part, damage);
  };
  return enemy;
}
