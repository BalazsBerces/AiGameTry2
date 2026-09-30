import type Phaser from 'phaser';
import { createSlime as createSlimeState, SLIME, splitSlime, updateSlime, type Slime, type SlimeBody } from '../../core/enemies/slime';
import { createRng } from '../../core/rng';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, flash, markChampion, roundBody, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Caves hopper (rules in core/slime): squashes flat (the tell), then jumps at where the player
 * stood, over whatever terrain lies between, to free floor. In the air its body rises and falls
 * over a shadow on the floor; its physics body stays down with the shadow, and it neither hurts
 * on touch nor is knocked back until it lands. Killed, it splits into two smaller slimes popped
 * out to either side, which the scene takes in as the enemies replacing it; the smallest just bursts.
 */
export function createSlime(scene: Phaser.Scene, x: number, y: number, body: SlimeBody = { tier: 'big', champion: false }): Enemy {
  const boost = championBoost(body.champion);
  const size = TUNING.slime.size[body.tier] * boost.scale;
  const color = championColor(COLORS.slime, body.champion);
  // Made first, so it is drawn under the body.
  const shadow = scene.add.ellipse(x, y, size, size * 0.45, 0x000000, 0.3).setVisible(false);
  const sprite = scene.add.ellipse(x, y, size, size, color) as unknown as EnemySprite;
  sprite.setStrokeStyle(2, COLORS.slimeEdge);
  sprite.once('destroy', () => shadow.destroy());
  markChampion(sprite, body.champion);
  scene.physics.add.existing(sprite);
  roundBody(sprite);
  const groundOffset = { x: sprite.body.offset.x, y: sprite.body.offset.y };
  // Each slime its own stream, so a pit wobbles out of step.
  const rng = createRng(Math.floor(Math.random() * 2 ** 32));
  const tile = TUNING.tile;
  const inTiles = (p: { x: number; y: number }) => ({ x: p.x / tile, y: p.y / tile });
  let hp = Math.round(SLIME.tiers[body.tier].hp * boost.hp);
  let state: Slime | undefined;
  /** How far (px) the drawn body is raised over its spot on the floor. */
  let lift = 0;
  const { squash, stretch, jumpHeight } = TUNING.slime;

  /** The room tile at a point in tiles; none outside the room (the scene's tile lookup clamps to it, so check it's really in that tile). */
  const tileUnder = (ctx: EnemyContext, p: { x: number; y: number }) => {
    const px = { x: p.x * tile, y: p.y * tile };
    const cell = ctx.tileOf(px.x, px.y);
    const c = ctx.tileCenter(cell);
    return Math.abs(px.x - c.x) <= tile / 2 && Math.abs(px.y - c.y) <= tile / 2 ? ctx.tiles[cell.y]?.[cell.x] : undefined;
  };
  const canLandAt = (ctx: EnemyContext) => (p: { x: number; y: number }) => tileUnder(ctx, p) === 'floor';
  /** It flies over any terrain in the room, but not room wall (an L room's missing corner). */
  const canCross = (ctx: EnemyContext) => (p: { x: number; y: number }) => {
    const t = tileUnder(ctx, p);
    return t !== undefined && t !== 'wall';
  };

  const enemy: Enemy = {
    parts: [sprite],
    collidesWithTerrain: true,
    airborne: () => state?.mode === 'hop',
    harmless: () => state?.mode === 'hop',
    update(ctx: EnemyContext) {
      state ??= createSlimeState(body.tier, ctx.time, rng);
      const was = state;
      const floor = { x: sprite.x, y: sprite.y + lift };
      const step = updateSlime(
        state,
        { time: ctx.time, at: inTiles(floor), player: inTiles(ctx.player), canLandAt: canLandAt(ctx), canCross: canCross(ctx), reach: boost.speed },
        rng,
      );
      state = step.slime;
      const shape = state.mode === 'squash' ? squash : state.mode === 'hop' ? stretch : { x: 1, y: 1 };
      sprite.setScale(shape.x, shape.y);
      // A parabola over the jump; the physics body is held down on the floor under the drawn one.
      lift = step.airborne === undefined ? 0 : jumpHeight * 4 * step.airborne * (1 - step.airborne);
      sprite.y = floor.y - lift;
      sprite.body.setOffset(groundOffset.x, groundOffset.y + lift / shape.y);
      shadow.setPosition(floor.x, floor.y + size / 2 - size * 0.1).setVisible(lift > 0);
      if (was.mode === 'hop' && state.mode !== 'hop') {
        // Down exactly where it chose to land, free floor, whatever held it up in the air (a stun).
        sprite.body.reset(was.to.x * tile, was.to.y * tile);
        return;
      }
      sprite.body.setVelocity(step.velocity.x * tile, step.velocity.y * tile);
    },
    hit(_part, damage) {
      hp -= damage;
      if (hp > 0) {
        flash(scene, sprite);
        return [enemy];
      }
      // Killed in the air, over a rock or a pit maybe: it comes apart where it would have landed, free floor.
      const at = state?.mode === 'hop' ? state.to : inTiles({ x: sprite.x, y: sprite.y + lift });
      sprite.destroy();
      return splitSlime(body, at).map((child) => createSlime(scene, child.at.x * tile, child.at.y * tile, child));
    },
  };
  return enemy;
}
