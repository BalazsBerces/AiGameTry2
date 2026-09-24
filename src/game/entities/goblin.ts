import type Phaser from 'phaser';
import { createGoblin as newGoblinState, goblinStep } from '../../core/forestCast';
import { COLORS, TUNING } from '../config';
import { stepDownhill } from '../../core/grid';
import { championBoost, championColor, flash, markChampion, roundBody, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/** Goblins tell each other apart in the pack rules by this. */
let nextId = 0;

/**
 * Forest walker: rushes the player faster than a zombie. Hurt below half HP it turns pale and
 * keeps away until another hurt goblin can pair up with it; the two meet and heal each other in
 * turns. The pack decides all this (rules in core/forestCast). Drawn as a pointed triangle.
 */
export function createGoblin(scene: Phaser.Scene, x: number, y: number, champion = false): Enemy {
  const boost = championBoost(champion);
  const size = TUNING.goblin.size * boost.scale;
  const maxHp = TUNING.goblin.hp * boost.hp;
  const speed = TUNING.goblin.speed * boost.speed;
  const retreatSpeed = TUNING.goblin.retreatSpeed * boost.speed;
  const color = championColor(COLORS.goblin, champion);
  const hurtColor = championColor(COLORS.goblinHurt, champion);
  const edge = champion ? COLORS.champion : COLORS.goblinEdge;
  const sprite = scene.add
    .triangle(x, y, 0, size, size / 2, 0, size, size, color)
    .setStrokeStyle(2, COLORS.goblinEdge) as unknown as EnemySprite;
  markChampion(sprite, champion);
  scene.physics.add.existing(sprite);
  roundBody(sprite);
  // The healer's link to its partner.
  const link = scene.add.graphics().setDepth(sprite.depth + 1);
  let hp = maxHp;
  let state = newGoblinState();
  const id = nextId++;
  const enemy = singlePartEnemy(scene, sprite, maxHp, (ctx: EnemyContext) => {
    const chasing = state.mode === 'chase';
    const healing = state.mode === 'heal' || state.mode === 'mend';
    sprite.setFillStyle(chasing ? color : hurtColor);
    // The healer pulses green and links itself to the one it heals.
    link.clear();
    if (state.mode === 'heal' && state.meetAt) {
      const to = ctx.tileCenter(state.meetAt);
      const pulse = 0.5 + 0.5 * Math.sin(ctx.time / 90);
      link.lineStyle(2, COLORS.goblinHeal, 0.4 + 0.5 * pulse).lineBetween(sprite.x, sprite.y, to.x, to.y);
      sprite.setStrokeStyle(2 + 2 * pulse, COLORS.goblinHeal);
    } else sprite.setStrokeStyle(champion ? 3 : 2, edge);
    const here = ctx.tileOf(sprite.x, sprite.y);
    const onPlayer = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y;
    // A goblin seeking its partner walks down the field toward it; a healing pair stays put.
    const next =
      healing ? undefined
      : state.mode === 'seek' && state.meetAt ? stepDownhill(ctx.walkDistanceTo(state.meetAt), here)
      : onPlayer && chasing ? undefined
      : goblinStep(state, ctx.walkDistance, here);
    if (!next && !chasing) {
      // Healing, or cornered: hold still.
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
    member: (ctx) => ({ id, hp, maxHp, cell: ctx.tileOf(sprite.x, sprite.y), goblin: state }),
    follow: (decision) => {
      state = decision.goblin;
      hp = Math.min(maxHp, hp + decision.heal);
    },
  };
  // Its own HP count, since healing raises it again.
  enemy.hit = (_part, damage) => {
    hp -= damage;
    if (hp > 0) {
      flash(scene, sprite);
      return [enemy];
    }
    link.destroy();
    sprite.destroy();
    return [];
  };
  return enemy;
}
