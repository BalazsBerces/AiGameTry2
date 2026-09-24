import type Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction } from '../../core/floorGenerator';
import { createRng, type Rng } from '../../core/rng';
import { createWorm, killBossSegment, killSegment, nextStepDue, stepWorm, type Worm, type WormPiece } from '../../core/wormChain';
import { broodTick, eggStage, WORM_BROOD } from '../../core/wormBrood';
import {
  absorbHit,
  breakOut,
  burrowAt,
  canAttack,
  diveCell,
  inPhaseTwo,
  planExit,
  planLunge,
  planRockfall,
  rockfallAt,
  sharedPool,
  spitWave,
  WORM_BOSS,
  type BurrowExit,
  type Lunge,
} from '../../core/wormBossAttack';
import { hitsToBreak } from '../../core/tiles';
import { COLORS, TUNING } from '../config';
import { championBoost, championColor, flash, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

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
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * What every piece of the worm boss shares: its hit points (phase two is judged on the whole
 * worm), the burrows under way (drawn, and hurting, once a frame) and the holes its burrows
 * leave in the walls, which stay for the whole fight.
 */
interface WormBossShared {
  maxHp: number;
  hp: number;
  pieces: number;
  /** Shared hit points left before any segment can break (core/wormBossAttack `absorbHit`). */
  pool: number;
  /** Once it has split in two, a kill only shortens a piece. */
  split: boolean;
  hazards: { plan: BurrowExit; start: number }[];
  /** Rocks falling (each landing as a rock tile), and when the next fall may start. */
  rocks: { cells: Cell[]; start: number }[];
  nextRockfallAt: number;
  /** Where each piece's body lies, so rocks never land on it. */
  bodies: Map<WormState, Cell[]>;
  /** Every piece rampages together: a round starts each time the shared clock comes round. */
  rampageRound: number;
  nextRampageAt: number;
  /** Lane marks and bursts, redrawn every frame. */
  ground: Phaser.GameObjects.Graphics;
  /** Hole-and-rubble decals, each drawn once. */
  holes: Phaser.GameObjects.Graphics;
  holeCells: Cell[];
  /** The parts of each egg and hatchling laid in phase two; one counts while any of its parts lives. */
  brood: EnemySprite[][];
  tickedAt: number;
  rng: Rng;
}

interface BossPiece {
  shared: WormBossShared;
  /** When it may next dive into a wall; 0 until its first update. */
  readyAt: number;
  /** The outer-wall cell it is slithering into, one segment per step. */
  diving?: Cell;
  /** Set once it is all under the ground, until it bursts out. */
  burrow?: { plan: BurrowExit; start: number };
  /** Coming out of the exit: steps taken so far, and whether each segment spits as it leaves the wall. */
  emerging?: { exit: Cell; steps: number; spit: boolean };
  /** When it next drops an egg (core/wormBrood); off while it can't. */
  nextEggAt?: number;
  /** The last rampage round it has seen; a piece busy in the walls when one starts sits it out. */
  rampageRound: number;
  rampage?: Rampage;
}

/** A rampage: charge up, then lunges (each with a pause after it), then dazed. */
interface Rampage {
  phase: 'charging' | 'lunging' | 'pausing' | 'dazed';
  /** When a charge, pause or daze ends. */
  until: number;
  lunges: number;
  lunge?: Lunge;
}

interface WormState {
  worm: Worm;
  parts: EnemySprite[];
  hp: number[];
  rng: Rng;
  nextStepAt: number;
  boss?: BossPiece;
}

/** Draws the boss's lane marks and bursts, and hurts the player in a bursting lane; once per frame, whichever piece asks first. */
function tickHazards(ctx: EnemyContext, shared: WormBossShared) {
  if (shared.tickedAt === ctx.time) return;
  shared.tickedAt = ctx.time;
  const t = TUNING.tile;
  const g = shared.ground.clear();
  shared.hazards = shared.hazards.filter((h) => {
    const now = burrowAt(h.plan, ctx.time - h.start);
    for (const c of now.marked) {
      const p = ctx.tileCenter(c);
      g.fillStyle(COLORS.burrowWarning, 0.25).fillRect(p.x - t / 2 + 4, p.y - t / 2 + 4, t - 8, t - 8);
      g.lineStyle(2, COLORS.burrowWarning, 0.8).strokeRect(p.x - t / 2 + 4, p.y - t / 2 + 4, t - 8, t - 8);
    }
    for (const c of now.hurting) {
      const p = ctx.tileCenter(c);
      g.fillStyle(COLORS.fallingRock, 1).fillCircle(p.x, p.y, t * 0.38);
      g.lineStyle(3, COLORS.burrowWarning, 1).strokeCircle(p.x, p.y, t * 0.38);
    }
    if (now.crack) drawCrack(g, ctx.tileCenter(now.crack), t);
    if (now.hurting.some((c) => sameCell(c, ctx.playerTile))) ctx.hurtPlayer();
    return now.phase !== 'over';
  });
  const onWorm = (c: Cell) => [...shared.bodies.values()].some((body) => body.some((b) => sameCell(b, c)));
  shared.rocks = shared.rocks.filter((fall) => {
    const { shadow, landed } = rockfallAt(ctx.time - fall.start);
    if (landed) {
      // It lands as a rock tile, or on the player; one that lands on the worm shatters.
      for (const c of fall.cells) if (!onWorm(c)) ctx.landSeedPod(c, 'rock');
      return false;
    }
    for (const c of fall.cells) {
      const p = ctx.tileCenter(c);
      g.fillStyle(0x000000, 0.15 + 0.35 * shadow).fillEllipse(p.x, p.y + t * 0.1, t * (0.3 + 0.5 * shadow), t * (0.18 + 0.3 * shadow));
    }
    return true;
  });
}

/** Jagged cracks spreading from the middle of the wall tile at `at`. */
function drawCrack(g: Phaser.GameObjects.Graphics, at: { x: number; y: number }, t: number) {
  g.lineStyle(3, COLORS.wormHole, 1);
  for (const branch of [[[0, 0], [-0.12, -0.18], [-0.05, -0.3], [-0.2, -0.42]], [[0, 0], [0.16, 0.05], [0.26, -0.1], [0.42, -0.04]], [[0, 0], [-0.04, 0.2], [-0.2, 0.3], [-0.16, 0.44]]]) {
    g.strokePoints(branch.map(([dx, dy]) => ({ x: at.x + dx * t, y: at.y + dy * t })));
  }
}

/** Its going under shakes rocks loose over the player, if the shared rockfall cooldown is up. */
function shakeRocksLoose(ctx: EnemyContext, shared: WormBossShared, plan: BurrowExit) {
  if (ctx.time < shared.nextRockfallAt) return;
  shared.nextRockfallAt = ctx.time + WORM_BOSS.rockfallCooldownMs;
  const avoid = [...[...shared.bodies.values()].flat(), ...plan.lane];
  shared.rocks.push({ cells: planRockfall(ctx.tiles, ctx.playerTile, avoid, ctx.doors, shared.rng), start: ctx.time });
}

/** A dark hole in the wall at `wall`, with rubble on the floor in front of it (`inward` points into the room). */
function drawHole(ctx: EnemyContext, shared: WormBossShared, wall: Cell, inward: Direction) {
  if (shared.holeCells.some((c) => sameCell(c, wall))) return;
  shared.holeCells.push(wall);
  const t = TUNING.tile;
  const step = STEP[inward];
  const at = ctx.tileCenter(wall);
  const front = ctx.tileCenter({ x: wall.x + step.x, y: wall.y + step.y });
  const g = shared.holes;
  // The mouth sits against the room, a little into the wall.
  g.fillStyle(COLORS.wormHole, 1).fillCircle(at.x + step.x * t * 0.2, at.y + step.y * t * 0.2, t * 0.38);
  g.fillStyle(COLORS.fallingRock, 0.8);
  for (const [dx, dy, r] of [[-0.28, -0.2, 0.09], [0.22, -0.26, 0.07], [0.05, 0.12, 0.1], [-0.18, 0.3, 0.06], [0.3, 0.22, 0.08]]) {
    g.fillCircle(front.x + dx * t, front.y + dy * t, r * t);
  }
}

/** A worm moving cell by cell per WormChain; its parts glide between cells. The boss also burrows through the walls. */
function wormEnemy(scene: Phaser.Scene, style: WormStyle, state: WormState): Enemy {
  const recolor = () => state.parts.forEach((p, i) => p.setFillStyle(i === 0 ? style.headColor : style.bodyColor));
  recolor();

  /** A segment is out of sight and out of reach inside the wall; it shows while gliding in or out, until the whole piece is under. */
  const hideInWalls = (ctx: EnemyContext, before: Cell[], underground: boolean) => {
    const inRoom = (c: Cell | undefined) => !!c && c.y >= 0 && c.x >= 0 && c.y < ctx.tiles.length && c.x < ctx.tiles[0].length;
    state.worm.segments.forEach((c, i) => {
      const shown = !underground && (inRoom(c) || inRoom(before[i]));
      state.parts[i].setVisible(shown);
      state.parts[i].body.enable = shown;
    });
  };

  /** Bursts out of the planned exit: smashes the rock in the lane and lines up in the hole to slither out. */
  const burstOut = (ctx: EnemyContext, b: BossPiece, plan: BurrowExit) => {
    for (const c of plan.breaks) ctx.smashRock(c);
    drawHole(ctx, b.shared, plan.exit, plan.heading);
    state.worm = createWorm(state.worm.segments.map(() => plan.exit), plan.heading);
    const at = ctx.tileCenter(plan.exit);
    for (const p of state.parts) p.body.reset(at.x, at.y);
    b.burrow = undefined;
    // Phase two: it comes out spitting.
    b.emerging = { exit: plan.exit, steps: 0, spit: inPhaseTwo(b.shared.hp, b.shared.maxHp) };
    b.readyAt = ctx.time + WORM_BOSS.burrowCooldownMs;
    state.nextStepAt = ctx.time;
  };

  /** Phase two: drops an egg from its tail now and then, while it is all out of the walls. */
  const layEggs = (ctx: EnemyContext, b: BossPiece) => {
    const { segments } = state.worm;
    const tail = segments[segments.length - 1];
    const tick = broodTick(b.nextEggAt, ctx.time, {
      length: segments.length,
      aboveGround: !b.burrow && !b.diving && !b.emerging && !b.rampage && ctx.isWalkable(tail),
      phaseTwo: inPhaseTwo(b.shared.hp, b.shared.maxHp),
      brood: b.shared.brood.filter((parts) => parts.some((p) => p.active)).length,
    });
    b.nextEggAt = tick.nextLayAt;
    if (tick.lay) ctx.spawnEnemy(wormEgg(scene, ctx, b.shared, tail));
  };

  /** Starts a rampage round on the shared clock; this piece joins it if it is out of the walls and long enough. */
  const joinRampage = (ctx: EnemyContext, b: BossPiece) => {
    const { shared } = b;
    if (shared.nextRampageAt === 0) shared.nextRampageAt = ctx.time + WORM_BOSS.rampageEveryMs;
    if (ctx.time >= shared.nextRampageAt) {
      shared.rampageRound++;
      shared.nextRampageAt = ctx.time + WORM_BOSS.rampageEveryMs;
    }
    if (b.rampageRound === shared.rampageRound) return;
    b.rampageRound = shared.rampageRound;
    if (b.burrow || b.diving || b.emerging || !canAttack(state.parts.length)) return;
    b.rampage = { phase: 'charging', until: ctx.time + WORM_BOSS.rampageChargeMs, lunges: 0 };
  };

  /** A lunge is over (it ran into something, or had nowhere to go): pause for the next, or lie dazed after the last. */
  const endLunge = (ctx: EnemyContext, r: Rampage) => {
    r.lunge = undefined;
    r.lunges++;
    const last = r.lunges >= WORM_BOSS.rampageLunges;
    r.phase = last ? 'dazed' : 'pausing';
    r.until = ctx.time + (last ? WORM_BOSS.rampageDazeMs : WORM_BOSS.lungePauseMs);
  };

  /** Runs a rampage; true while the piece holds still (charging, pausing, dazed). */
  const updateRampage = (ctx: EnemyContext, b: BossPiece, r: Rampage): boolean => {
    const head = state.parts[0];
    if (r.phase === 'lunging') {
      const { path, stop, burst } = r.lunge!;
      // It bursts straight through the first rock in its way.
      if (path.length && burst && sameCell(path[0], burst) && ctx.time >= state.nextStepAt) ctx.smashRock(burst);
      if (path.length && ctx.isWalkable(path[0])) return false;
      // Out of room: it slams into whatever is ahead once its last glide is done.
      if (ctx.time < state.nextStepAt) return false;
      const hit = path[0] ?? stop;
      if (hit && ctx.tiles[hit.y]?.[hit.x] === 'rock') ctx.chipRock(hit, hitsToBreak('rock')! * WORM_BOSS.lungeRockShare);
      endLunge(ctx, r);
    }
    if (ctx.time < r.until) {
      for (const p of state.parts) p.body.setVelocity(0, 0);
      if (r.phase === 'charging') {
        // The one warning: its head swells and throbs while the body shudders.
        head.setScale(1.15 + 0.2 * Math.abs(Math.sin(ctx.time / 70)));
        state.worm.segments.forEach((c, i) => {
          const at = ctx.tileCenter(c);
          if (i > 0) state.parts[i].body.reset(at.x + (Math.random() - 0.5) * 4, at.y + (Math.random() - 0.5) * 4);
        });
      }
      return true;
    }
    head.setScale(1);
    if (r.phase === 'dazed') {
      b.rampage = undefined;
      state.nextStepAt = ctx.time;
      return false;
    }
    const lunge = planLunge(ctx.tiles, state.worm, ctx.playerTile);
    if (!lunge) {
      endLunge(ctx, r);
      return true;
    }
    r.phase = 'lunging';
    r.lunge = lunge;
    state.nextStepAt = ctx.time;
    return false;
  };

  /** Runs the boss's burrow; true while the piece is under the ground and must not move. */
  const updateBoss = (ctx: EnemyContext, b: BossPiece): boolean => {
    tickHazards(ctx, b.shared);
    if (b.readyAt === 0) b.readyAt = ctx.time + WORM_BOSS.burrowCooldownMs;
    joinRampage(ctx, b);
    if (b.rampage) return updateRampage(ctx, b, b.rampage);
    layEggs(ctx, b);
    if (!b.burrow) return false;
    const { phase } = burrowAt(b.burrow.plan, ctx.time - b.burrow.start);
    if (phase === 'rumbling' || phase === 'warning') {
      for (const p of state.parts) p.body.setVelocity(0, 0);
      return true;
    }
    burstOut(ctx, b, b.burrow.plan);
    return false;
  };

  /** The boss's next step: into the wall while diving (starting a dive when the rule says so), else a crawl like any worm. */
  const bossStep = (ctx: EnemyContext, b: BossPiece): Worm => {
    const { worm } = state;
    const lunge = b.rampage?.lunge;
    if (lunge) return createWorm([lunge.path.shift()!, ...worm.segments.slice(0, -1)], lunge.heading);
    if (!b.diving && !b.emerging) {
      b.diving = diveCell(worm, ctx.tiles, ctx.doors, ctx.time, b.readyAt);
      if (b.diving) drawHole(ctx, b.shared, b.diving, OPPOSITE[worm.heading]);
    }
    if (b.diving) return createWorm([b.diving, ...worm.segments.slice(0, -1)], worm.heading);
    // It slithers straight out along its lane before it starts turning again.
    const straight = b.emerging && b.emerging.steps < WORM_BOSS.laneLength;
    if (b.emerging) b.emerging.steps++;
    const rock = breakOut(worm, ctx.tiles);
    if (rock) ctx.smashRock(rock);
    return stepWorm(worm, state.rng, (c) => !ctx.isWalkable(c), straight ? 0 : undefined);
  };

  /** After a boss step: it goes under once the whole body is in the wall; in phase two each segment spits as it leaves the exit. */
  const afterBossStep = (ctx: EnemyContext, b: BossPiece, before: Cell[]) => {
    const after = state.worm.segments;
    if (b.diving && after.every((c) => sameCell(c, b.diving!))) {
      b.burrow = { plan: planExit(ctx.tiles, ctx.doors, b.shared.holeCells, b.shared.rng), start: ctx.time };
      b.shared.hazards.push(b.burrow);
      b.diving = undefined;
      shakeRocksLoose(ctx, b.shared, b.burrow.plan);
      return;
    }
    const e = b.emerging;
    if (!e) return;
    if (e.spit) {
      const speed = TUNING.wormBoss.shotSpeed;
      const wave = spitWave(after, state.worm.heading);
      after.forEach((c, i) => {
        if (!sameCell(before[i], e.exit) || sameCell(c, e.exit)) return;
        const at = ctx.tileCenter(c);
        for (const a of wave[i].angles) ctx.fireEnemyShot(at.x, at.y, Math.cos(a) * speed, Math.sin(a) * speed);
      });
    }
    if (!after.some((c) => sameCell(c, e.exit))) b.emerging = undefined;
  };

  const enemy: Enemy = {
    parts: state.parts,
    collidesWithTerrain: false,
    update(ctx: EnemyContext) {
      state.boss?.shared.bodies.set(state, state.worm.segments);
      if (state.boss && updateBoss(ctx, state.boss)) return;
      if (ctx.time < state.nextStepAt) return;
      const phaseTwo = state.boss && inPhaseTwo(state.boss.shared.hp, state.boss.shared.maxHp);
      const stepMs = state.boss?.rampage?.lunge ? WORM_BOSS.lungeStepMs : style.stepMs * (phaseTwo ? WORM_BOSS.phaseTwoStepFactor : 1);
      if (state.nextStepAt === 0) state.nextStepAt = ctx.time;
      state.nextStepAt = nextStepDue(state.nextStepAt, ctx.time, stepMs);
      // Snap to the cells reached, then glide toward the next ones over one step.
      state.worm.segments.forEach((c, i) => {
        const p = ctx.tileCenter(c);
        state.parts[i].body.reset(p.x, p.y);
      });
      const before = state.worm.segments;
      state.worm = state.boss ? bossStep(ctx, state.boss) : stepWorm(state.worm, state.rng, (c) => !ctx.isWalkable(c));
      const after = state.worm.segments;
      // Boxed in, the worm reverses in place: after a normal move the old head is always second.
      if (after.length > 2 && !sameCell(after[1], before[0])) {
        state.parts.reverse();
        state.hp.reverse();
        recolor();
        return;
      }
      if (state.boss) {
        afterBossStep(ctx, state.boss, before);
        hideInWalls(ctx, before, !!state.boss.burrow);
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
      // Inside the wall it can't be touched, not even by a bomb.
      if (!part.body.enable) return [enemy];
      const boss = state.boss;
      if (boss && boss.shared.pool > 0) {
        // Its shared hit points soak up the first hits; the one that empties them breaks this segment.
        const { pool, breaks } = absorbHit(boss.shared.pool, damage);
        boss.shared.hp -= boss.shared.pool - pool;
        boss.shared.pool = pool;
        if (!breaks) {
          flash(scene, part);
          return [enemy];
        }
        boss.shared.hp -= state.hp[index];
        state.hp[index] = 0;
      } else {
        if (boss) boss.shared.hp -= Math.min(damage, state.hp[index]);
        state.hp[index] -= damage;
        if (state.hp[index] > 0) {
          flash(scene, part);
          return [enemy];
        }
      }
      part.destroy();
      // A piece split off mid-rampage just crawls on: no swollen head left behind.
      if (boss?.rampage && state.parts[0].active) state.parts[0].setScale(1);
      const pieces = boss ? killBossSegment(state.worm, index, boss.shared.split) : splitAt(state.worm, index);
      if (boss) {
        boss.shared.bodies.delete(state);
        if (pieces.length === 2) boss.shared.split = true;
        boss.shared.pieces += pieces.length - 1;
        if (boss.shared.pieces === 0) {
          boss.shared.ground.destroy();
          boss.shared.holes.destroy();
        }
      }
      return pieces.map(({ worm, from }, i) =>
        wormEnemy(scene, style, {
          worm,
          parts: from.map((k) => state.parts[k]),
          hp: from.map((k) => state.hp[k]),
          rng: state.rng.fork(`split ${index} ${i}`),
          nextStepAt: state.nextStepAt,
          ...(boss ? { boss: splitPiece(boss, worm) } : {}),
        }),
      );
    },
  };
  return enemy;
}

/**
 * One of the worm boss's brood, and every piece it splits into: it lives only as long as the
 * boss does, and is taken out of the fight once the last boss piece dies.
 */
function tethered(enemy: Enemy, shared: WormBossShared): Enemy {
  const brood: Enemy = {
    ...enemy,
    update(ctx) {
      if (shared.pieces === 0) ctx.removeEnemy(brood);
      else enemy.update(ctx);
    },
    hit: (part, damage) => enemy.hit(part, damage).map((e) => (e === enemy ? brood : tethered(e, shared))),
  };
  return brood;
}

/**
 * An egg dropped on `cell`: it breaks in about two shots, wobbles for its last stretch and then
 * hatches into a regular worm, coiled on the egg's cell.
 */
function wormEgg(scene: Phaser.Scene, ctx: EnemyContext, shared: WormBossShared, cell: Cell): Enemy {
  const at = ctx.tileCenter(cell);
  const sprite = scene.add.ellipse(at.x, at.y, 22, 28, COLORS.wormEgg).setStrokeStyle(2, COLORS.wormBossBody) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  const parts = [sprite];
  shared.brood.push(parts);
  const laidAt = ctx.time;
  const egg: Enemy = tethered(
    singlePartEnemy(scene, sprite, WORM_BROOD.eggHp, (ctx) => {
      const stage = eggStage(laidAt, ctx.time);
      sprite.setAngle(stage === 'wobbling' ? Math.sin(ctx.time / 45) * 20 : 0);
      if (stage !== 'hatched') return;
      const hatchling = spawnWorm(scene, Array.from({ length: WORM_BROOD.hatchlingLength }, () => cell), ctx.tileCenter);
      // The egg's place in the brood passes to what hatched from it.
      parts.splice(0, parts.length, ...hatchling.parts);
      ctx.removeEnemy(egg);
      ctx.spawnEnemy(tethered(hatchling, shared));
    }),
    shared,
  );
  // Eggs only get in the way: bumping one doesn't hurt.
  egg.harmless = () => true;
  return egg;
}

/** A regular worm splits wherever a segment dies: the pieces in front of and behind it. */
function splitAt(worm: Worm, index: number): WormPiece[] {
  const front = worm.segments.map((_, i) => i).slice(0, index);
  const back = worm.segments.map((_, i) => i).slice(index + 1);
  // killSegment returns the front piece (if any) then the back piece (if any).
  const sources = [front, back].filter((from) => from.length);
  return killSegment(worm, index).map((w, i) => ({ worm: w, from: sources[i] }));
}

/** A piece split off `parent`: one whose head is already in the wall keeps diving, one still in the exit hole keeps coming out. */
function splitPiece(parent: BossPiece, worm: Worm): BossPiece {
  const { diving, emerging } = parent;
  return {
    shared: parent.shared,
    readyAt: parent.readyAt,
    nextEggAt: parent.nextEggAt,
    rampageRound: parent.rampageRound,
    diving: diving && sameCell(worm.segments[0], diving) ? diving : undefined,
    emerging: emerging && worm.segments.some((c) => sameCell(c, emerging.exit)) ? { ...emerging } : undefined,
  };
}

export function spawnWorm(
  scene: Phaser.Scene,
  cells: Cell[],
  tileCenter: (c: Cell) => { x: number; y: number },
  style: WormStyle = REGULAR_WORM,
  boss = false,
): Enemy {
  // Made before the body so the worm crawls over its own holes.
  const holes = boss ? scene.add.graphics() : undefined;
  const parts = cells.map((c) => {
    const p = tileCenter(c);
    const sprite = scene.add.rectangle(p.x, p.y, style.segmentSize, style.segmentSize, style.bodyColor) as unknown as EnemySprite;
    scene.physics.add.existing(sprite);
    return sprite;
  });
  // A worm still coiled on one cell (a hatchling) heads off any way; it turns if that is blocked.
  const heading = (cells.length > 1 && DIRECTIONS.find((d) => sameCell(cells[0], { x: cells[1].x + STEP[d].x, y: cells[1].y + STEP[d].y }))) || 'right';
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  const shared: WormBossShared | undefined = holes
    ? {
        maxHp: cells.length * style.segmentHp,
        hp: cells.length * style.segmentHp,
        pieces: 1,
        pool: sharedPool(cells.length * style.segmentHp),
        split: false,
        hazards: [],
        rocks: [],
        nextRockfallAt: 0,
        bodies: new Map(),
        rampageRound: 0,
        nextRampageAt: 0,
        ground: scene.add.graphics().setDepth(1),
        holes,
        holeCells: [],
        brood: [],
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
    ...(shared ? { boss: { shared, readyAt: 0, rampageRound: 0 } } : {}),
  });
}
