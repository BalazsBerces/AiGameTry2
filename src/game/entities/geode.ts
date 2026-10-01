import type Phaser from 'phaser';
import { GEODE_BOUNCES } from '../../core/player/ricochet';
import { geodePose } from '../../core/art/castPoses';
import { GEODE, createGeode as createGeodeState, updateGeode, type Geode } from '../../core/enemies/geode';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, markChampion, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * A geode on the cave floor, shut or open on the cycle in core/enemies/geode: shut, nothing can
 * hurt it; open, it fires aimed shard shots that ricochet once off stone, and can be hurt.
 */
export function createGeode(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const { shotSpeed } = TUNING.geode;
  const rules = GEODE;
  const boost = championBoost(champion);
  const size = TUNING.geode.size * boost.scale;
  const hp = TUNING.geode.hp * boost.hp;
  // A diamond: the physics body stays an axis-aligned square.
  const sprite = scene.add
    .rectangle(x, y, size * 0.8, size * 0.8, championColor(COLORS.geode, champion))
    .setStrokeStyle(3, COLORS.geodeEdge)
    .setAngle(45) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  // Made on its first update, once the room's clock is known: it may first open after a short random stagger.
  let state: Geode | undefined;
  const enemy = singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    const { min, max } = rules.staggerMs;
    state ??= createGeodeState(ctx.time + min + Math.random() * (max - min));
    const distance = Math.hypot(ctx.player.x - sprite.x, ctx.player.y - sprite.y) / TUNING.tile;
    const step = updateGeode(state, distance, ctx.canSeePlayer(sprite), ctx.time, rules);
    state = step.geode;
    const dx = ctx.player.x - sprite.x;
    const dy = ctx.player.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < step.shots; i++) {
      ctx.fireEnemyShot(sprite.x, sprite.y, (dx / len) * shotSpeed, (dy / len) * shotSpeed, false, GEODE_BOUNCES);
    }
  });
  const shut = () => !state?.open;
  // Shut, it is plain rock: harmless to touch, player shots bounce off, and nothing else (bombs, orbitals, lightning) hurts it either.
  enemy.invulnerable = shut;
  enemy.harmless = shut;
  const hit = enemy.hit;
  enemy.hit = (part, damage) => (shut() ? [enemy] : hit(part, damage));
  // A cracked rock geode: it splits open on its crystal core through the opening delay, and flares as it fires.
  enemy.visual = (time) => geodePose(state, time, rules);
  return enemy;
}
