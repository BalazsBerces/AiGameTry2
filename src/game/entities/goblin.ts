import type Phaser from 'phaser';
import { createGoblin as newGoblinState, goblinStep } from '../../core/forestCast';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, roundBody, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Forest walker: rushes the player faster than a zombie. Hurt below half HP it turns pale and
 * keeps away; the pack decides when (rules in core/forestCast). Drawn as a pointed triangle.
 */
export function createGoblin(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const size = TUNING.goblin.size * boost.scale;
  const maxHp = TUNING.goblin.hp * boost.hp;
  const speed = TUNING.goblin.speed * boost.speed;
  const retreatSpeed = TUNING.goblin.retreatSpeed * boost.speed;
  const color = championColor(COLORS.goblin, champion);
  const hurtColor = championColor(COLORS.goblinHurt, champion);
  const sprite = scene.add
    .triangle(x, y, 0, size, size / 2, 0, size, size, color)
    .setStrokeStyle(2, COLORS.goblinEdge) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  roundBody(sprite);
  let hp = maxHp;
  let state = newGoblinState();
  const enemy = singlePartEnemy(scene, sprite, maxHp, (ctx: EnemyContext) => {
    const chasing = state.mode === 'chase';
    sprite.setFillStyle(chasing ? color : hurtColor);
    const here = ctx.tileOf(sprite.x, sprite.y);
    const onPlayer = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y;
    const next = onPlayer && chasing ? undefined : goblinStep(state, ctx.walkDistance, here);
    if (!next && !chasing) {
      // Cornered: hold still and wait.
      sprite.body.setVelocity(0, 0);
      return;
    }
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    const v = chasing ? speed : retreatSpeed;
    sprite.body.setVelocity((dx / len) * v, (dy / len) * v);
  });
  enemy.pack = {
    member: () => ({ hp, maxHp, goblin: state }),
    follow: (goblin) => {
      state = goblin;
    },
  };
  const hit = enemy.hit;
  enemy.hit = (part, damage) => {
    hp -= damage;
    return hit(part, damage);
  };
  return enemy;
}
