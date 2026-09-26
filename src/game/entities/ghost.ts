import type Phaser from 'phaser';
import type { Cell } from '../../core/map/floorGenerator';
import { GHOST, ghostAt } from '../../core/enemies/ghost';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, flash, markChampion, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Drifts straight at the player through walls, rocks and pits, on the visible/faded cycle in
 * core/ghost. While faded its body is switched off, so shots pass through and touching it is
 * harmless; it is drawn translucent. Its cycle is offset by its spawn cell, so ghosts in a room
 * are out of step.
 */
export function createGhost(scene: Phaser.Scene, x: number, y: number, cell: Cell, champion = false): Enemy {
  const boost = championBoost(champion);
  const radius = TUNING.ghost.radius * boost.scale;
  const speed = TUNING.ghost.speed * boost.speed;
  let hp = TUNING.ghost.hp * boost.hp;
  const sprite = scene.add.circle(x, y, radius, championColor(COLORS.ghost, champion)) as unknown as EnemySprite;
  sprite.setStrokeStyle(2, COLORS.ghostEdge);
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  sprite.body.setCircle(radius);
  const cycle = GHOST.visibleMs + GHOST.fadedMs;
  const offsetMs = ((cell.x * 7 + cell.y * 13) * 211) % cycle;
  let visible = true;
  let lastTime: number | undefined;

  const enemy: Enemy = {
    parts: [sprite],
    collidesWithTerrain: false,
    update(ctx: EnemyContext) {
      const state = ghostAt(ctx.time, offsetMs);
      visible = state.visible;
      sprite.body.enable = state.hittable;
      sprite.setAlpha(state.opacity);
      // Moved by hand rather than by velocity, so it keeps drifting while its body is off.
      const dt = lastTime === undefined ? 0 : Math.min(ctx.time - lastTime, 100) / 1000;
      lastTime = ctx.time;
      const dx = ctx.player.x - sprite.x;
      const dy = ctx.player.y - sprite.y;
      const len = Math.hypot(dx, dy);
      if (len < 2) return;
      sprite.body.setVelocity(0, 0);
      sprite.setPosition(sprite.x + (dx / len) * speed * dt, sprite.y + (dy / len) * speed * dt);
    },
    hit(_part, damage) {
      // Sword swings, bombs and crushers reach it directly: they too only land while it is visible.
      if (!visible) return [enemy];
      hp -= damage;
      if (hp > 0) {
        flash(scene, sprite);
        return [enemy];
      }
      sprite.destroy();
      return [];
    },
  };
  return enemy;
}
