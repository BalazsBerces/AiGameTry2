import type Phaser from 'phaser';
import { createGhoul as createGhoulState, stepGhoul } from '../../core/ghoul';
import { stepDownhill } from '../../core/grid';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/** Shambles slowly along the walk field toward the player; winds up and lunges when close (rules in core/ghoul). */
export function createGhoul(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const size = TUNING.ghoul.size * boost.scale;
  const hp = TUNING.ghoul.hp * boost.hp;
  const speed = TUNING.ghoul.speed * boost.speed;
  const lungeSpeed = TUNING.ghoul.lungeSpeed * boost.speed;
  // Its outline is its eyes (lit while lunging), so a champion shows only by size and tint.
  const body = championColor(COLORS.ghoul, champion);
  const sprite = scene.add.circle(x, y, size / 2, body).setStrokeStyle(3, body) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setCircle(size / 2);
  let state = createGhoulState();
  return singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    state = stepGhoul(state, {
      time: ctx.time,
      toPlayer: { x: (ctx.player.x - sprite.x) / TUNING.tile, y: (ctx.player.y - sprite.y) / TUNING.tile },
      canSeePlayer: ctx.canSeePlayer(sprite),
    });
    // Its eyes light up as it winds up (standing still, the tell) and stay lit through the lunge.
    sprite.setStrokeStyle(3, state.mode === 'windUp' || state.mode === 'lunge' ? COLORS.ghoulEye : body);
    if (state.mode === 'windUp') {
      sprite.body.setVelocity(0, 0);
      return;
    }
    if (state.mode === 'lunge') {
      sprite.body.setVelocity(state.direction.x * lungeSpeed, state.direction.y * lungeSpeed);
      return;
    }
    const here = ctx.tileOf(sprite.x, sprite.y);
    const next = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y ? undefined : stepDownhill(ctx.walkDistance, here);
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    // It catches its breath after a lunge, barely moving.
    const pace = state.mode === 'recover' ? speed * 0.3 : speed;
    sprite.body.setVelocity((dx / len) * pace, (dy / len) * pace);
  });
}
