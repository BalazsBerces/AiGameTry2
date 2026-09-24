import type Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction } from '../../core/floorGenerator';
import { createRng, type Rng } from '../../core/rng';
import { createWorm, killBossSegment, killSegment, nextStepDue, stepWorm, type Worm, type WormPiece } from '../../core/wormChain';
import { broodTick, eggStage, WORM_BROOD } from '../../core/wormBrood';
import {
  absorbHit,
  bossCrawl,
  breakOut,
  canAttack,
  diveCell,
  inPhaseTwo,
  planTunnel,
  planLunge,
  planRockfall,
  rockfallAt,
  sharedPool,
  spitWave,
  WORM_BOSS,
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
const inRoom = (ctx: EnemyContext, c: Cell) => c.y >= 0 && c.x >= 0 && c.y < ctx.tiles.length && c.x < ctx.tiles[0].length;

/**
 * What every piece of the worm boss shares: its hit points (phase two is judged on the whole
 * worm), the rocks it shakes loose, the rampage clock, and the holes its tunnels leave in the
 * walls, which stay for the whole fight.
 */
interface WormBossShared {
  maxHp: number;
  hp: number;
  pieces: number;
  /** Shared hit points left before any segment can break (core/wormBossAttack `absorbHit`). */
  pool: number;
  /** Once it has split in two, a kill only shortens a piece. */
  split: boolean;
  /** Rocks falling (each landing as a rock tile), and when the next fall may start. */
  rocks: { cells: Cell[]; start: number }[];
  nextRockfallAt: number;
  /** Where each piece's body lies, so rocks never land on it. */
  bodies: Map<WormState, Cell[]>;
  /** Every piece rampages together: a round starts each time the shared clock comes round. */
  rampageRound: number;
  nextRampageAt: number;
  /** Falling rocks' shadows, redrawn every frame. */
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
  /** When it may next tunnel through the walls; 0 until its first update. */
  readyAt: number;
  /** Racing through the walls and out across the room (core/wormBossAttack `planTunnel`). */
  tunnel?: Lunge;
  /** Phase two: the exit hole it tunnelled out of; each segment spits as it leaves it. */
  spitFrom?: Cell;
  /** When it next drops an egg (core/wormBrood); off while it can't. */
  nextEggAt?: number;
  /** The last rampage round it has joined (or sat out, too short); one mid-tunnel joins once through. */
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

/** Draws falling rocks' shadows and lands them; once per frame, whichever piece asks first. */
function tickRocks(ctx: EnemyContext, shared: WormBossShared) {
  if (shared.tickedAt === ctx.time) return;
  shared.tickedAt = ctx.time;
  const t = TUNING.tile;
  const g = shared.ground.clear();
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

/** Its tunnelling shakes rocks loose over the player, if the shared rockfall cooldown is up; none land on `avoid`. */
function shakeRocksLoose(ctx: EnemyContext, shared: WormBossShared, avoid: Cell[]) {
  if (ctx.time < shared.nextRockfallAt) return;
  shared.nextRockfallAt = ctx.time + WORM_BOSS.rockfallCooldownMs;
  const cells = planRockfall(ctx.tiles, ctx.playerTile, [...[...shared.bodies.values()].flat(), ...avoid], ctx.doors, shared.rng);
  shared.rocks.push({ cells, start: ctx.time });
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

/** A worm moving cell by cell per WormChain; its parts glide between cells. The boss also tunnels through the walls and rampages. */
function wormEnemy(scene: Phaser.Scene, style: WormStyle, state: WormState): Enemy {
  const recolor = () => state.parts.forEach((p, i) => p.setFillStyle(i === 0 ? style.headColor : style.bodyColor));
  recolor();

  /** A segment is out of sight and out of reach inside the wall; it shows while gliding in or out. */
  const hideInWalls = (ctx: EnemyContext, before: Cell[]) => {
    state.worm.segments.forEach((c, i) => {
      const shown = inRoom(ctx, c) || (!!before[i] && inRoom(ctx, before[i]));
      state.parts[i].setVisible(shown);
      state.parts[i].body.enable = shown;
    });
  };
  const inWalls = (ctx: EnemyContext) => state.worm.segments.some((c) => !inRoom(ctx, c));

  /** Phase two: drops an egg from its tail now and then, while it is all out of the walls. */
  const layEggs = (ctx: EnemyContext, b: BossPiece) => {
    const { segments } = state.worm;
    const tail = segments[segments.length - 1];
    const tick = broodTick(b.nextEggAt, ctx.time, {
      length: segments.length,
      aboveGround: !b.tunnel && !b.rampage && !inWalls(ctx) && ctx.isWalkable(tail),
      phaseTwo: inPhaseTwo(b.shared.hp, b.shared.maxHp),
      brood: b.shared.brood.filter((parts) => parts.some((p) => p.active)).length,
    });
    b.nextEggAt = tick.nextLayAt;
    if (tick.lay) ctx.spawnEnemy(wormEgg(scene, ctx, b.shared, tail));
  };

  /** Starts a rampage round on the shared clock; this piece joins it once through any tunnel, if it is long enough. */
  const joinRampage = (ctx: EnemyContext, b: BossPiece) => {
    const { shared } = b;
    if (shared.nextRampageAt === 0) shared.nextRampageAt = ctx.time + WORM_BOSS.rampageEveryMs;
    if (ctx.time >= shared.nextRampageAt) {
      shared.rampageRound++;
      shared.nextRampageAt = ctx.time + WORM_BOSS.rampageEveryMs;
    }
    if (b.rampageRound === shared.rampageRound || b.tunnel) return;
    b.rampageRound = shared.rampageRound;
    if (!canAttack(state.parts.length)) return;
    // A late joiner (it was tunnelling) keeps a full cooldown before the next round.
    shared.nextRampageAt = Math.max(shared.nextRampageAt, ctx.time + WORM_BOSS.rampageEveryMs);
    b.rampage = { phase: 'charging', until: ctx.time + WORM_BOSS.rampageChargeMs, lunges: 0 };
  };

  /**
   * Before a lunge's (or tunnel's) next step: it smashes a rock it bursts through, and once it is
   * out of room and its last glide is done, slams into whatever is ahead. True when it is over.
   */
  const dashOver = (ctx: EnemyContext, lunge: Lunge): boolean => {
    const next = lunge.path[0];
    if (next && lunge.bursts.some((c) => sameCell(c, next)) && ctx.time >= state.nextStepAt) ctx.smashRock(next);
    if (next && (!inRoom(ctx, next) || ctx.isWalkable(next))) return false;
    if (ctx.time < state.nextStepAt) return false;
    const hit = next ?? lunge.stop;
    if (hit && ctx.tiles[hit.y]?.[hit.x] === 'rock') ctx.chipRock(hit, hitsToBreak('rock')! * WORM_BOSS.lungeRockShare);
    return true;
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
      if (!dashOver(ctx, r.lunge!)) return false;
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
      // The cooldown runs from the end of a rampage, not its start.
      b.shared.nextRampageAt = Math.max(b.shared.nextRampageAt, ctx.time + WORM_BOSS.rampageEveryMs);
      state.nextStepAt = ctx.time;
      return false;
    }
    const lunge = planLunge(ctx.tiles, ctx.doors, state.worm, ctx.playerTile);
    if (!lunge) {
      endLunge(ctx, r);
      return true;
    }
    r.phase = 'lunging';
    r.lunge = lunge;
    state.nextStepAt = ctx.time;
    return false;
  };

  /** Runs its tunnel through the walls: starts one when its head runs at an outer wall, ends it once it has run into something. */
  const updateTunnel = (ctx: EnemyContext, b: BossPiece) => {
    if (b.tunnel) {
      if (!dashOver(ctx, b.tunnel)) return;
      b.tunnel = undefined;
      b.readyAt = ctx.time + WORM_BOSS.burrowCooldownMs;
      return;
    }
    if (inWalls(ctx) || !diveCell(state.worm, ctx.tiles, ctx.doors, ctx.time, b.readyAt)) return;
    const tunnel = planTunnel(ctx.tiles, ctx.doors, state.worm);
    if (!tunnel) return;
    b.tunnel = tunnel;
    // Phase two: it comes out spitting.
    if (inPhaseTwo(b.shared.hp, b.shared.maxHp)) b.spitFrom = tunnel.wrap!.exit;
    shakeRocksLoose(ctx, b.shared, tunnel.path);
  };

  /** Runs the boss; true while the piece holds still. */
  const updateBoss = (ctx: EnemyContext, b: BossPiece): boolean => {
    tickRocks(ctx, b.shared);
    if (b.readyAt === 0) b.readyAt = ctx.time + WORM_BOSS.burrowCooldownMs;
    joinRampage(ctx, b);
    if (b.rampage) return updateRampage(ctx, b, b.rampage);
    layEggs(ctx, b);
    updateTunnel(ctx, b);
    return false;
  };

  /** The boss's next step: along its lunge or tunnel, else a crawl like any worm's. */
  const bossStep = (ctx: EnemyContext, b: BossPiece): Worm => {
    const { worm } = state;
    const lunge = b.rampage?.lunge ?? b.tunnel;
    if (lunge) {
      const next = lunge.path.shift()!;
      // Tunnelling through the walls leaves a hole at each end.
      if (lunge.wrap && sameCell(next, lunge.wrap.entry)) drawHole(ctx, b.shared, next, OPPOSITE[lunge.heading]);
      if (lunge.wrap && sameCell(next, lunge.wrap.exit)) drawHole(ctx, b.shared, next, lunge.heading);
      return createWorm([next, ...worm.segments.slice(0, -1)], lunge.heading);
    }
    const rock = breakOut(worm, ctx.tiles);
    if (rock) ctx.smashRock(rock);
    return bossCrawl(worm, ctx.tiles, state.rng);
  };

  /** After a boss step, in phase two: each segment spits out both flanks as it leaves the exit hole. */
  const spitOut = (ctx: EnemyContext, b: BossPiece, before: Cell[]) => {
    const exit = b.spitFrom;
    if (!exit) return;
    const after = state.worm.segments;
    const speed = TUNING.wormBoss.shotSpeed;
    const wave = spitWave(after, state.worm.heading);
    after.forEach((c, i) => {
      if (!sameCell(before[i], exit) || sameCell(c, exit)) return;
      const at = ctx.tileCenter(c);
      for (const a of wave[i].angles) ctx.fireEnemyShot(at.x, at.y, Math.cos(a) * speed, Math.sin(a) * speed);
    });
    // Done once the whole body is through (the head may not have reached the hole yet).
    if (!after.some((c) => sameCell(c, exit)) && !b.tunnel?.path.some((c) => sameCell(c, exit))) b.spitFrom = undefined;
  };

  const enemy: Enemy = {
    parts: state.parts,
    collidesWithTerrain: false,
    update(ctx: EnemyContext) {
      state.boss?.shared.bodies.set(state, state.worm.segments);
      if (state.boss && updateBoss(ctx, state.boss)) return;
      if (ctx.time < state.nextStepAt) return;
      const phaseTwo = state.boss && inPhaseTwo(state.boss.shared.hp, state.boss.shared.maxHp);
      const dashing = state.boss && (state.boss.rampage?.lunge ?? state.boss.tunnel);
      const stepMs = dashing ? WORM_BOSS.lungeStepMs : style.stepMs * (phaseTwo ? WORM_BOSS.phaseTwoStepFactor : 1);
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
        spitOut(ctx, state.boss, before);
        hideInWalls(ctx, before);
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
          ...(boss ? { boss: splitPiece(boss, worm, i === 0) } : {}),
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

/**
 * A piece left after a kill: the one that keeps the head (`front`) races on through its tunnel,
 * and a rampage goes on in every piece, a back half starting its own lunge at once.
 */
function splitPiece(parent: BossPiece, worm: Worm, front: boolean): BossPiece {
  const { tunnel, spitFrom, rampage } = parent;
  return {
    shared: parent.shared,
    readyAt: parent.readyAt,
    nextEggAt: parent.nextEggAt,
    rampageRound: parent.rampageRound,
    tunnel: front && tunnel ? { ...tunnel, path: [...tunnel.path] } : undefined,
    spitFrom: spitFrom && worm.segments.some((c) => sameCell(c, spitFrom)) ? spitFrom : undefined,
    rampage: rampage && carryRampage(rampage, front),
  };
}

function carryRampage(r: Rampage, front: boolean): Rampage {
  if (front) return { ...r, lunge: r.lunge && { ...r.lunge, path: [...r.lunge.path] } };
  // A back half cut off mid-lunge picks its own line straight away.
  return r.lunge ? { ...r, phase: 'pausing', until: 0, lunge: undefined } : { ...r };
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
