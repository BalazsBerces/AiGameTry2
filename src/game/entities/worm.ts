import type Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell } from '../../core/floorGenerator';
import { createRng, type Rng } from '../../core/rng';
import { createWorm, killSegment, stepWorm, type Worm } from '../../core/wormChain';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, flash, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

export interface WormStyle {
  segmentSize: number;
  segmentHp: number;
  stepMs: number;
  headColor: number;
  bodyColor: number;
}

export const REGULAR_WORM: WormStyle = {
  segmentSize: TUNING.worm.segmentSize,
  segmentHp: TUNING.worm.segmentHp,
  stepMs: TUNING.worm.stepMs,
  headColor: COLORS.wormHead,
  bodyColor: COLORS.wormBody,
};

export const BOSS_WORM: WormStyle = {
  segmentSize: TUNING.wormBoss.segmentSize,
  segmentHp: TUNING.wormBoss.segmentHp,
  stepMs: TUNING.wormBoss.stepMs,
  headColor: COLORS.wormBossHead,
  bodyColor: COLORS.wormBossBody,
};

/** A worm crowned champion: bigger, tougher, quicker and gold-tinted. */
export function championWorm(style: WormStyle): WormStyle {
  const boost = championBoost(true);
  return {
    segmentSize: style.segmentSize * boost.scale,
    segmentHp: style.segmentHp * boost.hp,
    stepMs: style.stepMs / boost.speed,
    headColor: championColor(style.headColor, true),
    bodyColor: championColor(style.bodyColor, true),
  };
}

const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

interface WormState {
  worm: Worm;
  parts: EnemySprite[];
  hp: number[];
  rng: Rng;
  nextStepAt: number;
}

/** A worm moving cell by cell per WormChain; its parts glide between cells. */
function wormEnemy(scene: Phaser.Scene, style: WormStyle, state: WormState): Enemy {
  const recolor = () => state.parts.forEach((p, i) => p.setFillStyle(i === 0 ? style.headColor : style.bodyColor));
  recolor();
  const enemy: Enemy = {
    parts: state.parts,
    collidesWithTerrain: false,
    update(ctx: EnemyContext) {
      if (ctx.time < state.nextStepAt) return;
      if (state.nextStepAt === 0) state.nextStepAt = ctx.time;
      state.nextStepAt += style.stepMs;
      // Snap to the cells reached, then glide toward the next ones over one step.
      state.worm.segments.forEach((c, i) => {
        const p = ctx.tileCenter(c);
        state.parts[i].body.reset(p.x, p.y);
      });
      const before = state.worm.segments;
      state.worm = stepWorm(state.worm, state.rng, (c) => !ctx.isWalkable(c));
      const after = state.worm.segments;
      // Boxed in, the worm reverses in place: after a normal move the old head is always second.
      if (after.length > 2 && !sameCell(after[1], before[0])) {
        state.parts.reverse();
        state.hp.reverse();
        recolor();
        return;
      }
      const seconds = style.stepMs / 1000;
      state.worm.segments.forEach((c, i) => {
        const to = ctx.tileCenter(c);
        const part = state.parts[i];
        part.body.setVelocity((to.x - part.x) / seconds, (to.y - part.y) / seconds);
      });
    },
    hit(part, damage) {
      const index = state.parts.indexOf(part);
      if (index < 0) return [enemy];
      state.hp[index] -= damage;
      if (state.hp[index] > 0) {
        flash(scene, part);
        return [enemy];
      }
      part.destroy();
      // killSegment returns the front piece (if any) then the back piece (if any).
      const pieces = killSegment(state.worm, index);
      const sources = [
        ...(index > 0 ? [{ parts: state.parts.slice(0, index), hp: state.hp.slice(0, index) }] : []),
        ...(index < state.parts.length - 1 ? [{ parts: state.parts.slice(index + 1), hp: state.hp.slice(index + 1) }] : []),
      ];
      return pieces.map((worm, i) =>
        wormEnemy(scene, style, {
          worm,
          ...sources[i],
          rng: state.rng.fork(`split ${index} ${i}`),
          nextStepAt: state.nextStepAt,
        }),
      );
    },
  };
  return enemy;
}

export function spawnWorm(
  scene: Phaser.Scene,
  cells: Cell[],
  tileCenter: (c: Cell) => { x: number; y: number },
  style: WormStyle = REGULAR_WORM,
): Enemy {
  const parts = cells.map((c) => {
    const p = tileCenter(c);
    const sprite = scene.add.rectangle(p.x, p.y, style.segmentSize, style.segmentSize, style.bodyColor) as unknown as EnemySprite;
    scene.physics.add.existing(sprite);
    return sprite;
  });
  const heading = cells.length > 1 ? DIRECTIONS.find((d) => sameCell(cells[0], { x: cells[1].x + STEP[d].x, y: cells[1].y + STEP[d].y }))! : 'right';
  return wormEnemy(scene, style, {
    worm: createWorm(cells, heading),
    parts,
    hp: cells.map(() => style.segmentHp),
    rng: createRng(Math.floor(Math.random() * 2 ** 31)),
    nextStepAt: 0,
  });
}
