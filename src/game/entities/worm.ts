import type Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction } from '../../core/floorGenerator';
import { createRng, type Rng } from '../../core/rng';
import { createWorm, killSegment, stepWorm, type Worm } from '../../core/wormChain';
import {
  burrowAt,
  canAttack,
  inPhaseTwo,
  planBurrow,
  spitWave,
  WORM_BOSS,
  type Burrow,
  type SpitShot,
} from '../../core/wormBossAttack';
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

/**
 * What every piece of the worm boss shares: its hit points (phase two is judged on the whole
 * worm) and the ground hazards its burrows leave, which play out even if the piece that dug
 * them is split or killed.
 */
interface WormBossShared {
  maxHp: number;
  hp: number;
  pieces: number;
  hazards: { burrow: Burrow; start: number }[];
  ground: Phaser.GameObjects.Graphics;
  tickedAt: number;
  rng: Rng;
}

interface BossPiece {
  shared: WormBossShared;
  nextAttackAt: number;
  spitNext: boolean;
  spit?: { start: number; shots: SpitShot[]; fired: number };
  /** Set while this piece is under the ground. */
  burrow?: { plan: Burrow; start: number };
}

interface WormState {
  worm: Worm;
  parts: EnemySprite[];
  hp: number[];
  rng: Rng;
  nextStepAt: number;
  boss?: BossPiece;
}

/** Draws the boss's ground hazards and hurts the player on them; once per frame, whichever piece asks first. */
function tickHazards(ctx: EnemyContext, shared: WormBossShared) {
  if (shared.tickedAt === ctx.time) return;
  shared.tickedAt = ctx.time;
  const t = TUNING.tile;
  const g = shared.ground.clear();
  shared.hazards = shared.hazards.filter((h) => {
    const now = burrowAt(h.burrow, ctx.time - h.start);
    for (const c of now.warning) {
      const p = ctx.tileCenter(c);
      g.fillStyle(COLORS.burrowWarning, 0.25).fillRect(p.x - t / 2 + 4, p.y - t / 2 + 4, t - 8, t - 8);
      g.lineStyle(2, COLORS.burrowWarning, 0.8).strokeRect(p.x - t / 2 + 4, p.y - t / 2 + 4, t - 8, t - 8);
    }
    for (const c of now.hurting) {
      const p = ctx.tileCenter(c);
      g.fillStyle(COLORS.fallingRock, 1).fillCircle(p.x, p.y, t * 0.38);
      g.lineStyle(3, COLORS.burrowWarning, 1).strokeCircle(p.x, p.y, t * 0.38);
    }
    if (now.hurting.some((c) => sameCell(c, ctx.playerTile))) ctx.hurtPlayer();
    return !now.over;
  });
}

/** The heading from `from` toward `to` along whichever axis is further. */
function headingToward(from: Cell, to: Cell): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/** A worm moving cell by cell per WormChain; its parts glide between cells. The boss also burrows and spits. */
function wormEnemy(scene: Phaser.Scene, style: WormStyle, state: WormState): Enemy {
  const recolor = () => state.parts.forEach((p, i) => p.setFillStyle(i === 0 ? style.headColor : style.bodyColor));
  recolor();

  const setUnderground = (under: boolean) => {
    for (const p of state.parts) {
      p.setVisible(!under);
      p.body.enable = !under;
      p.body.setVelocity(0, 0);
    }
  };

  const startSpit = (b: BossPiece, time: number) => {
    b.spit = { start: time, shots: spitWave(state.worm.segments, state.worm.heading), fired: 0 };
  };

  const fireSpit = (ctx: EnemyContext, b: BossPiece) => {
    const spit = b.spit!;
    const elapsed = ctx.time - spit.start;
    const speed = TUNING.wormBoss.shotSpeed;
    while (spit.fired < spit.shots.length && spit.shots[spit.fired].atMs <= elapsed) {
      const shot = spit.shots[spit.fired++];
      const part = state.parts[shot.segment];
      if (!part?.active) continue;
      for (const a of shot.angles) ctx.fireEnemyShot(part.x, part.y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
    if (spit.fired >= spit.shots.length) b.spit = undefined;
  };

  /** Comes up at the exit: breaks the rock it dug through, and uncoils from the hole toward the player. */
  const surface = (ctx: EnemyContext, plan: Burrow) => {
    for (const c of plan.breaks) ctx.smashRock(c);
    const heading = headingToward(plan.surface, ctx.playerTile);
    state.worm = createWorm(state.worm.segments.map(() => plan.surface), heading);
    const at = ctx.tileCenter(plan.surface);
    for (const p of state.parts) p.body.reset(at.x, at.y);
    setUnderground(false);
    state.nextStepAt = ctx.time;
  };

  /** Runs the boss's attacks; true while the piece is under the ground and must not move. */
  const updateBoss = (ctx: EnemyContext, b: BossPiece): boolean => {
    tickHazards(ctx, b.shared);
    if (b.burrow) {
      if (burrowAt(b.burrow.plan, ctx.time - b.burrow.start).underground) return true;
      surface(ctx, b.burrow.plan);
      b.burrow = undefined;
      // Phase two: it comes up spitting.
      if (inPhaseTwo(b.shared.hp, b.shared.maxHp)) startSpit(b, ctx.time);
    }
    if (b.spit) fireSpit(ctx, b);
    if (b.nextAttackAt === 0) b.nextAttackAt = ctx.time + WORM_BOSS.attackEveryMs;
    if (ctx.time >= b.nextAttackAt && !b.spit && canAttack(state.parts.length)) {
      b.nextAttackAt = ctx.time + WORM_BOSS.attackEveryMs;
      if (b.spitNext) startSpit(b, ctx.time);
      else {
        const plan = planBurrow(ctx.tiles, state.worm.segments[0], ctx.playerTile, b.shared.rng);
        b.shared.hazards.push({ burrow: plan, start: ctx.time });
        b.burrow = { plan, start: ctx.time };
        setUnderground(true);
      }
      b.spitNext = !b.spitNext;
    }
    return !!b.burrow;
  };

  const enemy: Enemy = {
    parts: state.parts,
    collidesWithTerrain: false,
    update(ctx: EnemyContext) {
      if (state.boss && updateBoss(ctx, state.boss)) return;
      if (ctx.time < state.nextStepAt) return;
      const phaseTwo = state.boss && inPhaseTwo(state.boss.shared.hp, state.boss.shared.maxHp);
      const stepMs = style.stepMs * (phaseTwo ? WORM_BOSS.phaseTwoStepFactor : 1);
      if (state.nextStepAt === 0) state.nextStepAt = ctx.time;
      state.nextStepAt += stepMs;
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
      const seconds = stepMs / 1000;
      state.worm.segments.forEach((c, i) => {
        const to = ctx.tileCenter(c);
        const part = state.parts[i];
        part.body.setVelocity((to.x - part.x) / seconds, (to.y - part.y) / seconds);
      });
    },
    hit(part, damage) {
      const index = state.parts.indexOf(part);
      if (index < 0) return [enemy];
      // Under the ground it can't be touched, not even by a bomb.
      if (state.boss?.burrow) return [enemy];
      if (state.boss) state.boss.shared.hp -= Math.min(damage, state.hp[index]);
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
      const shared = state.boss?.shared;
      if (shared) {
        shared.pieces += pieces.length - 1;
        if (shared.pieces === 0) shared.ground.destroy();
      }
      return pieces.map((worm, i) =>
        wormEnemy(scene, style, {
          worm,
          ...sources[i],
          rng: state.rng.fork(`split ${index} ${i}`),
          nextStepAt: state.nextStepAt,
          // Every piece of the boss fights on; each starts its own attack clock.
          ...(shared ? { boss: { shared, nextAttackAt: 0, spitNext: i === 0 } } : {}),
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
  boss = false,
): Enemy {
  const parts = cells.map((c) => {
    const p = tileCenter(c);
    const sprite = scene.add.rectangle(p.x, p.y, style.segmentSize, style.segmentSize, style.bodyColor) as unknown as EnemySprite;
    scene.physics.add.existing(sprite);
    return sprite;
  });
  const heading = cells.length > 1 ? DIRECTIONS.find((d) => sameCell(cells[0], { x: cells[1].x + STEP[d].x, y: cells[1].y + STEP[d].y }))! : 'right';
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  const shared: WormBossShared | undefined = boss
    ? {
        maxHp: cells.length * style.segmentHp,
        hp: cells.length * style.segmentHp,
        pieces: 1,
        hazards: [],
        ground: scene.add.graphics().setDepth(1),
        tickedAt: -1,
        rng: rng.fork('attacks'),
      }
    : undefined;
  return wormEnemy(scene, style, {
    worm: createWorm(cells, heading),
    parts,
    hp: cells.map(() => style.segmentHp),
    rng,
    nextStepAt: 0,
    ...(shared ? { boss: { shared, nextAttackAt: 0, spitNext: true } } : {}),
  });
}
