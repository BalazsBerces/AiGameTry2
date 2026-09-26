import type Phaser from 'phaser';
import { createGargoyle as createGargoyleRules, updateGargoyle } from '../../core/enemies/gargoyle';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Stationary stone diamond, dormant (dull, eyes dark) until the player comes within range;
 * then it lights up and fires aimed bursts on the schedule in core/gargoyle.
 */
export function createGargoyle(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const { shotSpeed } = TUNING.gargoyle;
  // Its outline is its eyes (lit once awake), so a champion shows only by size and tint.
  const boost = championBoost(champion);
  const size = TUNING.gargoyle.size * boost.scale;
  const hp = TUNING.gargoyle.hp * boost.hp;
  const sprite = scene.add.rectangle(x, y, size, size, championColor(COLORS.gargoyle, champion)) as unknown as EnemySprite;
  sprite.setAngle(45).setStrokeStyle(2, COLORS.gargoyleEyes, 0);
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  let state = createGargoyleRules();
  return singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    const distance = Math.hypot(ctx.player.x - sprite.x, ctx.player.y - sprite.y) / TUNING.tile;
    const wasAwake = state.awake;
    const step = updateGargoyle(state, distance, ctx.time);
    state = step.gargoyle;
    if (state.awake && !wasAwake) sprite.setStrokeStyle(3, COLORS.gargoyleEyes, 1);
    if (!step.shots || !ctx.canSeePlayer(sprite)) return;
    const dx = ctx.player.x - sprite.x;
    const dy = ctx.player.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < step.shots; i++) ctx.fireEnemyShot(sprite.x, sprite.y, (dx / len) * shotSpeed, (dy / len) * shotSpeed);
  });
}
