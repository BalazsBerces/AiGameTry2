import type Phaser from 'phaser';
import { createSlime as createSlimeState, SLIME, splitSlime, updateSlime, type Slime, type SlimeBody } from '../../core/enemies/slime';
import { createRng } from '../../core/rng';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, flash, markChampion, roundBody, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Caves hopper (rules in core/slime): squashes flat (the tell), then hops at where the player
 * stood. Killed, it splits into two smaller slimes popped out to either side, which the scene
 * takes in as the enemies replacing it; the smallest just bursts.
 */
export function createSlime(scene: Phaser.Scene, x: number, y: number, body: SlimeBody = { tier: 'big', champion: false }): Enemy {
  const boost = championBoost(body.champion);
  const size = TUNING.slime.size[body.tier] * boost.scale;
  const color = championColor(COLORS.slime, body.champion);
  const sprite = scene.add.ellipse(x, y, size, size, color) as unknown as EnemySprite;
  sprite.setStrokeStyle(2, COLORS.slimeEdge);
  markChampion(sprite, body.champion);
  scene.physics.add.existing(sprite);
  roundBody(sprite);
  // Each slime its own stream, so a pit wobbles out of step.
  const rng = createRng(Math.floor(Math.random() * 2 ** 32));
  const tile = TUNING.tile;
  const inTiles = (p: { x: number; y: number }) => ({ x: p.x / tile, y: p.y / tile });
  let hp = Math.round(SLIME.tiers[body.tier].hp * boost.hp);
  let state: Slime | undefined;
  const { squash, stretch } = TUNING.slime;

  const enemy: Enemy = {
    parts: [sprite],
    collidesWithTerrain: true,
    update(ctx: EnemyContext) {
      state ??= createSlimeState(body.tier, ctx.time, rng);
      const step = updateSlime(state, { time: ctx.time, at: inTiles(sprite), player: inTiles(ctx.player) }, rng);
      state = step.slime;
      const shape = state.mode === 'squash' ? squash : state.mode === 'hop' ? stretch : { x: 1, y: 1 };
      sprite.setScale(shape.x, shape.y);
      const v = tile * boost.speed;
      sprite.body.setVelocity(step.velocity.x * v, step.velocity.y * v);
    },
    hit(_part, damage) {
      hp -= damage;
      if (hp > 0) {
        flash(scene, sprite);
        return [enemy];
      }
      const at = inTiles(sprite);
      sprite.destroy();
      return splitSlime(body, at).map((child) => createSlime(scene, child.at.x * tile, child.at.y * tile, child));
    },
  };
  return enemy;
}
