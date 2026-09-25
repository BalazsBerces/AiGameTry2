import type Phaser from 'phaser';
import { createBoar as createBoarState, updateBoar, type Boar } from '../../core/enemies/boar';
import { stepDownhill } from '../../core/map/grid';
import { stun } from '../../core/enemies/stun';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, roundBody, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/** How hard a dashing boar is pulled back onto the centre line of its lane (1/s). */
const LANE_PULL = 8;

/**
 * Forest charger (rules in core/boar): trots after the player, and once lined up with them
 * reddens as it winds up, then dashes straight down the row or column. Hitting something
 * solid stuns it through the shared enemy stun, and smashes rock.
 */
export function createBoar(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const { hp, width, height } = TUNING.boar;
  const speed = TUNING.boar.speed * boost.speed;
  const dashSpeed = TUNING.boar.dashSpeed * boost.speed;
  const color = championColor(COLORS.boar, champion);
  const sprite = scene.add.rectangle(x, y, width * boost.scale, height * boost.scale, color) as unknown as EnemySprite;
  sprite.setStrokeStyle(2, COLORS.boarTusk);
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  roundBody(sprite);
  let state: Boar | undefined;
  const enemy = singlePartEnemy(scene, sprite, hp * boost.hp, (ctx: EnemyContext) => {
    state ??= createBoarState(ctx.time);
    const stopAt = state.mode === 'dash' ? ctx.tileCenter(state.stop) : undefined;
    const arrived =
      state.mode === 'dash' && !!stopAt && (stopAt.x - sprite.x) * state.direction.x + (stopAt.y - sprite.y) * state.direction.y <= 2;
    const step = updateBoar(state, {
      time: ctx.time,
      at: ctx.tileOf(sprite.x, sprite.y),
      toPlayer: { x: (ctx.player.x - sprite.x) / TUNING.tile, y: (ctx.player.y - sprite.y) / TUNING.tile },
      canSeePlayer: ctx.canSeePlayer(sprite),
      tiles: ctx.tiles,
      arrived,
    });
    state = step.boar;
    if (step.smashed) ctx.smashRock(step.smashed);
    if (step.stunMs) stun(enemy, ctx.time, step.stunMs);
    sprite.setFillStyle(state.mode === 'windUp' || state.mode === 'dash' ? COLORS.boarWindUp : color);

    if (state.mode === 'dash') {
      const lane = ctx.tileCenter(state.stop);
      const { x: dx, y: dy } = state.direction;
      sprite.body.setVelocity(dx ? dx * dashSpeed : (lane.x - sprite.x) * LANE_PULL, dy ? dy * dashSpeed : (lane.y - sprite.y) * LANE_PULL);
      return;
    }
    if (state.mode !== 'idle') {
      sprite.body.setVelocity(0, 0);
      return;
    }
    const here = ctx.tileOf(sprite.x, sprite.y);
    const next = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y ? undefined : stepDownhill(ctx.walkDistance, here);
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const tx = target.x - sprite.x;
    const ty = target.y - sprite.y;
    const len = Math.hypot(tx, ty) || 1;
    sprite.body.setVelocity((tx / len) * speed, (ty / len) * speed);
  });
  return enemy;
}
