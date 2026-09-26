import type Phaser from 'phaser';
import { createRng } from '../../core/rng';
import { createWaspFlight, steerWasp } from '../../core/enemies/wasp';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Forest flyer, spawned in swarms: a small, fast wasp zigzagging at the player (flight in
 * core/wasp). It flies over ponds and thorns but not through trees or walls.
 */
export function createWasp(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const { size, hp, speed } = TUNING.wasp;
  const sprite = scene.add
    .ellipse(x, y, size * boost.scale * 1.3, size * boost.scale, championColor(COLORS.wasp, champion))
    .setStrokeStyle(2, COLORS.waspStripe) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  // Each wasp its own stream, so a swarm scatters instead of flying in formation.
  const rng = createRng(Math.floor(Math.random() * 2 ** 32));
  let flight = createWaspFlight(rng);
  let last: number | undefined;
  const enemy = singlePartEnemy(scene, sprite, Math.round(hp * boost.hp), (ctx: EnemyContext) => {
    const dt = last === undefined ? 0 : Math.min(ctx.time - last, 100);
    last = ctx.time;
    const step = steerWasp(flight, sprite, ctx.player, dt, rng);
    flight = step.flight;
    const v = speed * boost.speed;
    sprite.body.setVelocity(step.heading.x * v, step.heading.y * v);
  });
  enemy.collidesWithTerrain = false;
  enemy.flies = true;
  return enemy;
}
