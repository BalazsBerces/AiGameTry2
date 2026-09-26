import type Phaser from 'phaser';
import { createBat as createBatState, updateBat, type Bat } from '../../core/enemies/bat';
import { createRng } from '../../core/rng';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Caves flyer (rules in core/bat): flutters erratically about its roost, out over chasms, then
 * hangs still and flushes red (the tell) before swooping straight at where the player stood.
 * It crosses chasms and thorns but not stone or walls.
 */
export function createBat(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const { hp, width, height } = TUNING.bat;
  const color = championColor(COLORS.bat, champion);
  const sprite = scene.add.ellipse(x, y, width * boost.scale, height * boost.scale, color) as unknown as EnemySprite;
  sprite.setStrokeStyle(2, COLORS.batWing);
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  // Each bat its own stream, so a roost scatters instead of flying in formation.
  const rng = createRng(Math.floor(Math.random() * 2 ** 32));
  const tile = TUNING.tile;
  const inTiles = (p: { x: number; y: number }) => ({ x: p.x / tile, y: p.y / tile });
  let state: Bat | undefined;
  let last: number | undefined;
  const enemy = singlePartEnemy(scene, sprite, Math.round(hp * boost.hp), (ctx: EnemyContext) => {
    state ??= createBatState(inTiles(sprite), ctx.time, rng);
    const dtMs = last === undefined ? 0 : Math.min(ctx.time - last, 100);
    last = ctx.time;
    const step = updateBat(state, { time: ctx.time, dtMs, at: inTiles(sprite), player: inTiles(ctx.player) }, rng);
    state = step.bat;
    sprite.setFillStyle(state.mode === 'telegraph' ? COLORS.batTelegraph : color);
    const v = tile * boost.speed;
    sprite.body.setVelocity(step.velocity.x * v, step.velocity.y * v);
  });
  enemy.collidesWithTerrain = false;
  enemy.flies = true;
  return enemy;
}
