import type Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction } from '../../core/floorGenerator';
import { createRng, type Rng } from '../../core/rng';
import { WORM_BOSS_LENGTH } from '../../core/roomGenerator';
import { createWorm, killSegment, splitBoss, nextStepDue, stepWorm, type Worm, type WormPiece } from '../../core/wormChain';
import { broodTick, eggStage, WORM_BROOD } from '../../core/wormBrood';
import {
  absorbHit,
  bossCrawl,
  breakOut,
  canAttack,
  halfPools,
  inLastStand,
  isRoaring,
  lastStandPool,
  lungeCracks,
  planLunge,
  planRockfall,
  roarTick,
  rockfallAt,
  splitsAt,
  spitWave,
  WORM_BOSS,
  type Lunge,
  type Roar,
  type SpitShot,
} from '../../core/wormBossAttack';
import type { BarHalf, BossBarSnapshot } from '../../core/bossBar';
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
  // Its hit points are the whole worm's, shared out only to size its pool.
  segmentHp: TUNING.wormBoss.hp / WORM_BOSS_LENGTH,
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
 * What every piece of the worm boss shares: its hit points (its split is judged on the whole
 * worm), the rocks it shakes loose, the rampage clock, its brood, and the holes its lunges leave
 * in the walls, which stay for the whole fight.
 */
interface WormBossShared {
  maxHp: number;
  hp: number;
  pieces: number;
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
  /** The parts of each egg and hatchling from before its split; one counts while any of its parts lives. */
  brood: EnemySprite[][];
  /** Its health bar (core/bossBar), kept up to date in place: the scene shows this very object. */
  bar: BossBarSnapshot;
  tickedAt: number;
  rng: Rng;
}

interface BossPiece {
  shared: WormBossShared;
  /** Its last stand: a wave of spit running down the body, from where each segment lies as it fires. */
  spit?: { start: number; shots: SpitShot[]; fired: number };
  /** When it next drops an egg (core/wormBrood); off while it can't. */
  nextEggAt?: number;
  /** A half of the split boss: its own pool of hit points; it dies whole once this is empty. */
  pool?: number;
  /** A half's piece of the health bar. */
  half?: BarHalf;
  /** The roar that opens its last stand, and its pool as the roar began (it heals from there). */
  roar?: Roar;
  poolAtRoar?: number;
  /** The last rampage round it has joined, or sat out (too short). */
  rampageRound: number;
  rampage?: Rampage;
}

/** A rampage: charge up, then lunges with a pause between each; over as the last one ends. */
interface Rampage {
  phase: 'charging' | 'lunging' | 'pausing' | 'over';
  /** When a charge or pause ends. */
  until: number;
  lunges: number;
  /** Its last stand: it never stops lunging, and spits after each lunge through the walls. */
  endless?: boolean;
  lunge?: Lunge;
  /** The next lunge, planned as the pause before it starts; null if it has nowhere to go. */
  next?: Lunge | null;
  /** The warning crack flowing along the next (then current) lunge's path, and when it set off. */
  crack?: { lunge: Lunge; start: number };
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

/** A lunge tunnelling into the wall shakes rocks loose over the player, if the shared rockfall cooldown is up; none land on `avoid`. */
function shakeRocksLoose(ctx: EnemyContext, shared: WormBossShared, avoid: Cell[]) {
  if (ctx.time < shared.nextRockfallAt) return;
  shared.nextRockfallAt = ctx.time + WORM_BOSS.rockfallCooldownMs;
  const cells = planRockfall(ctx.tiles, ctx.playerTile, [...[...shared.bodies.values()].flat(), ...avoid], ctx.doors, shared.rng);
  shared.rocks.push({ cells, start: ctx.time });
}

/**
 * A crack across the tile at `at`, running along `heading` (`share` of the way across): jagged,
 * the same for a cell every frame. It warns of a lunge, walls included where it will tunnel.
 */
function drawCrack(g: Phaser.GameObjects.Graphics, at: { x: number; y: number }, cell: Cell, heading: Direction, share = 1) {
  const t = TUNING.tile;
  const along = STEP[heading];
  const side = { x: -along.y, y: along.x };
  const wobble = ((cell.x * 7 + cell.y * 13) % 3) - 1;
  const bend = (u: number, i: number) => {
    const off = (i % 2 ? 0.12 : -0.06) * t + wobble * 0.04 * t;
    return { u, off };
  };
  const knees = [-0.5, -0.2, 0.15, 0.5].map(bend);
  // Only as far as the crack has grown into this cell (`share` of it).
  const end = -0.5 + share;
  const shown = knees.filter((k) => k.u <= end);
  const next = knees[shown.length];
  if (next && shown.length) {
    const last = shown[shown.length - 1];
    const f = (end - last.u) / (next.u - last.u);
    shown.push({ u: end, off: last.off + (next.off - last.off) * f });
  }
  if (shown.length < 2) return;
  const points = shown.map(({ u, off }) => ({ x: at.x + along.x * u * t + side.x * off, y: at.y + along.y * u * t + side.y * off }));
  g.lineStyle(3, COLORS.wormHole, 0.9).strokePoints(points);
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

/** A worm moving cell by cell per WormChain; its parts glide between cells. The boss also rampages, lunging through the walls. */
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

  /** Before its split: drops eggs from its tail end now and then, while it is all out of the walls. */
  const layEggs = (ctx: EnemyContext, b: BossPiece) => {
    const { segments } = state.worm;
    const tail = segments[segments.length - 1];
    const tick = broodTick(b.nextEggAt, ctx.time, {
      split: b.pool !== undefined,
      aboveGround: !b.rampage && !inWalls(ctx) && ctx.isWalkable(tail),
      brood: b.shared.brood.filter((parts) => parts.some((p) => p.active)).length,
    });
    b.nextEggAt = tick.nextLobAt;
    for (const cell of segments.slice(segments.length - tick.eggs)) ctx.spawnEnemy(wormEgg(scene, ctx, b.shared, cell));
  };

  /** Starts a rampage round on the shared clock; this piece joins it if it is long enough. */
  const joinRampage = (ctx: EnemyContext, b: BossPiece) => {
    const { shared } = b;
    // The last half left rampages without end, from wherever it is in the rampage now.
    if (inLastStand(b.pool !== undefined, shared.pieces)) {
      b.rampage ??= { phase: 'charging', until: ctx.time + WORM_BOSS.rampageChargeMs, lunges: 0 };
      b.rampage.endless = true;
      return;
    }
    if (shared.nextRampageAt === 0) shared.nextRampageAt = ctx.time + WORM_BOSS.rampageEveryMs;
    if (ctx.time >= shared.nextRampageAt) {
      shared.rampageRound++;
      shared.nextRampageAt = ctx.time + WORM_BOSS.rampageEveryMs;
    }
    if (b.rampageRound === shared.rampageRound) return;
    b.rampageRound = shared.rampageRound;
    if (!canAttack(state.parts.length)) return;
    b.rampage = { phase: 'charging', until: ctx.time + WORM_BOSS.rampageChargeMs, lunges: 0 };
  };

  /**
   * Before a lunge's next step: it smashes a rock it bursts through, and once it is
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

  /** A lunge is over (it ran into something, or had nowhere to go): pause for the next, or end the rampage after the last. */
  const endLunge = (ctx: EnemyContext, b: BossPiece, r: Rampage) => {
    r.lunge = undefined;
    r.crack = undefined;
    r.lunges++;
    const last = !r.endless && r.lunges >= WORM_BOSS.rampageLunges;
    r.phase = last ? 'over' : 'pausing';
    r.until = ctx.time + (last ? 0 : WORM_BOSS.lungePauseMs);
    if (!last) planNext(ctx, b, r);
  };

  /** Plans the next lunge at the start of the pause before it, at the player as they stand now. */
  const planNext = (ctx: EnemyContext, b: BossPiece, r: Rampage) => {
    r.next = planLunge(ctx.tiles, ctx.doors, state.worm, ctx.playerTile, b.shared.rng) ?? null;
    // The lunge eats its path as it goes; the crack keeps its own.
    if (r.next) r.crack = { lunge: { ...r.next, path: [...r.next.path] }, start: ctx.time };
  };

  /** The warning before a lunge: a crack flowing out of the head along its path, on ahead of the worm as it lunges. */
  const drawLungeCrack = (ctx: EnemyContext, b: BossPiece, r: Rampage) => {
    if (!r.crack) return;
    const { lunge, start } = r.crack;
    // Out of the far wall it runs the new way.
    const { wrap } = lunge;
    const exitAt = wrap ? lunge.path.findIndex((c) => sameCell(c, wrap.exit)) : Infinity;
    const along = (i: number) => (wrap && i >= exitAt ? wrap.heading : lunge.heading);
    const { whole, tip } = lungeCracks(lunge, ctx.time - start);
    const g = b.shared.ground;
    whole.forEach((c, i) => drawCrack(g, ctx.tileCenter(c), c, along(i)));
    if (tip) drawCrack(g, ctx.tileCenter(tip.cell), tip.cell, along(whole.length), tip.share);
  };

  /** Runs a rampage; true while the piece holds still (charging, pausing). */
  const updateRampage = (ctx: EnemyContext, b: BossPiece, r: Rampage): boolean => {
    const head = state.parts[0];
    if (r.phase === 'lunging') {
      if (!dashOver(ctx, r.lunge!)) {
        drawLungeCrack(ctx, b, r);
        return false;
      }
      // Its last stand: out of the walls and stretched along its lane, it spits down its whole length.
      if (r.lunge!.wrap && r.endless) {
        b.spit = { start: ctx.time, shots: spitWave(state.worm.segments, state.worm.heading), fired: 0 };
      }
      endLunge(ctx, b, r);
    }
    // The first lunge is planned as the charge-up's last stretch begins, like a pause.
    if (r.phase === 'charging' && r.next === undefined && ctx.time >= r.until - WORM_BOSS.lungePauseMs) planNext(ctx, b, r);
    if (ctx.time < r.until) {
      for (const p of state.parts) p.body.setVelocity(0, 0);
      drawLungeCrack(ctx, b, r);
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
    if (r.phase === 'over') {
      b.rampage = undefined;
      // The cooldown runs from the end of a rampage, not its start.
      b.shared.nextRampageAt = Math.max(b.shared.nextRampageAt, ctx.time + WORM_BOSS.rampageEveryMs);
      state.nextStepAt = ctx.time;
      return false;
    }
    const lunge = r.next === undefined ? planLunge(ctx.tiles, ctx.doors, state.worm, ctx.playerTile, b.shared.rng) : r.next;
    r.next = undefined;
    if (!lunge) {
      endLunge(ctx, b, r);
      return true;
    }
    r.phase = 'lunging';
    r.lunge = lunge;
    state.nextStepAt = ctx.time;
    return false;
  };

  /** Fires the spit wave's shots as they fall due, each from its segment as it is now; none from inside a wall. */
  const fireSpit = (ctx: EnemyContext, b: BossPiece) => {
    const spit = b.spit;
    if (!spit) return;
    const speed = TUNING.wormBoss.shotSpeed;
    while (spit.fired < spit.shots.length && spit.shots[spit.fired].atMs <= ctx.time - spit.start) {
      const shot = spit.shots[spit.fired++];
      const part = state.parts[shot.segment];
      if (!part?.active || !part.visible) continue;
      for (const a of shot.angles) ctx.fireEnemyShot(part.x, part.y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
    if (spit.fired >= spit.shots.length) b.spit = undefined;
  };

  /**
   * Its last stand opens with a roar (core/wormBossAttack `roarTick`). Until then it finishes any
   * lunge and crawls out of the walls; then it holds still and can't be hurt, its head swelling
   * and throbbing while rings spread from it. True while it waits or roars (no rampage, no eggs).
   */
  const lastStandRoar = (ctx: EnemyContext, b: BossPiece): boolean => {
    const was = b.roar;
    const lastStand = inLastStand(b.pool !== undefined, b.shared.pieces);
    b.roar = roarTick(b.roar, ctx.time, { lastStand, aboveGround: !inWalls(ctx) && !b.rampage?.lunge });
    const head = state.parts[0];
    if (b.roar?.phase === 'waiting') {
      // Out of its lunge, it drops the rampage and crawls on out of the walls.
      if (b.rampage && !b.rampage.lunge) {
        b.rampage = undefined;
        head.setScale(1);
        state.nextStepAt = ctx.time;
      }
      return false;
    }
    if (b.roar?.phase === 'done' && was?.phase === 'roaring') {
      // The roar is over, its heal done: on into its endless rampage.
      healDuringRoar(b, WORM_BOSS.roarMs);
      head.setScale(1);
      state.nextStepAt = ctx.time;
    }
    if (b.roar?.phase !== 'roaring' || !isRoaring(b.roar, ctx.time)) return false;
    if (was?.phase !== 'roaring') {
      b.rampage = undefined;
      b.spit = undefined;
      b.shared.bar.rage = true;
      b.poolAtRoar = b.pool;
      // Settle on its cells: it roars where it stands.
      state.worm.segments.forEach((c, i) => {
        const at = ctx.tileCenter(c);
        state.parts[i].body.reset(at.x, at.y);
      });
    }
    for (const p of state.parts) p.body.setVelocity(0, 0);
    const roar = TUNING.wormRoar;
    head.setScale(roar.headScale + 0.25 * Math.abs(Math.sin(ctx.time / 55)));
    const since = ctx.time - (b.roar.until - WORM_BOSS.roarMs);
    healDuringRoar(b, since);
    const g = b.shared.ground;
    for (let start = 0; start <= since; start += roar.ringEveryMs) {
      // Each ring grows out from the head and fades as it goes.
      const k = (since - start) / roar.ringMs;
      if (k >= 1) continue;
      const radius = TUNING.wormBoss.segmentSize * 0.6 + k * roar.ringTiles * TUNING.tile;
      g.lineStyle(4 * (1 - k) + 1, style.headColor, 0.8 * (1 - k)).strokeCircle(head.x, head.y, radius);
    }
    return true;
  };

  /** Its last stand's second wind, `sinceMs` into the roar: the pool (and the bar with it) fills back up. */
  const healDuringRoar = (b: BossPiece, sinceMs: number) => {
    if (b.poolAtRoar === undefined || b.pool === undefined || !b.half) return;
    const pool = lastStandPool(b.poolAtRoar, b.half.startPool, sinceMs);
    b.shared.hp += pool - b.pool;
    b.shared.bar.hp = b.shared.hp;
    b.pool = pool;
    b.half.pool = pool;
  };

  /** Runs the boss; true while the piece holds still. */
  const updateBoss = (ctx: EnemyContext, b: BossPiece): boolean => {
    tickRocks(ctx, b.shared);
    ctx.showBossBar(b.shared.bar);
    fireSpit(ctx, b);
    if (lastStandRoar(ctx, b)) return true;
    if (b.roar?.phase === 'waiting' && !b.rampage) return false;
    joinRampage(ctx, b);
    if (b.rampage) return updateRampage(ctx, b, b.rampage);
    layEggs(ctx, b);
    return false;
  };

  /** The boss's next step: along its lunge, else a crawl like any worm's (turning at the walls). */
  const bossStep = (ctx: EnemyContext, b: BossPiece): Worm => {
    const { worm } = state;
    const lunge = b.rampage?.lunge;
    if (lunge) {
      const next = lunge.path.shift()!;
      const { wrap } = lunge;
      // Tunnelling into the wall shakes rocks loose; each end leaves a hole.
      if (wrap && sameCell(next, wrap.entry)) {
        drawHole(ctx, b.shared, next, OPPOSITE[lunge.heading]);
        shakeRocksLoose(ctx, b.shared, lunge.path);
      }
      if (wrap && sameCell(next, wrap.exit)) {
        drawHole(ctx, b.shared, next, wrap.heading);
        lunge.heading = wrap.heading;
      }
      return createWorm([next, ...worm.segments.slice(0, -1)], lunge.heading);
    }
    const rock = breakOut(worm, ctx.tiles);
    if (rock) ctx.smashRock(rock);
    return bossCrawl(worm, ctx.tiles, state.rng);
  };

  const enemy: Enemy = {
    parts: state.parts,
    collidesWithTerrain: false,
    invulnerable: () => isRoaring(state.boss?.roar, scene.time.now),
    update(ctx: EnemyContext) {
      state.boss?.shared.bodies.set(state, state.worm.segments);
      if (state.boss && updateBoss(ctx, state.boss)) return;
      if (ctx.time < state.nextStepAt) return;
      const stepMs = state.boss?.rampage?.lunge ? WORM_BOSS.lungeStepMs : style.stepMs;
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
      if (state.boss) hideInWalls(ctx, before);
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
      if (state.boss) return hitBoss(state.boss, part, index, damage);
      state.hp[index] -= damage;
      if (state.hp[index] > 0) {
        flash(scene, part);
        return [enemy];
      }
      part.destroy();
      return splitAt(state.worm, index).map(({ worm, from }, i) =>
        wormEnemy(scene, style, {
          worm,
          parts: from.map((k) => state.parts[k]),
          hp: from.map((k) => state.hp[k]),
          rng: state.rng.fork(`split ${index} ${i}`),
          nextStepAt: state.nextStepAt,
        }),
      );
    },
  };

  /**
   * The boss never breaks apart segment by segment: the whole worm is one pool of hit points
   * until it splits (core/wormBossAttack `splitsAt`), and then each half is one pool of its own,
   * dying whole once it is empty.
   */
  const hitBoss = (b: BossPiece, part: EnemySprite, index: number, damage: number): Enemy[] => {
    const { shared } = b;
    // Roaring, it doesn't even notice.
    if (isRoaring(b.roar, scene.time.now)) return [enemy];
    const had = b.pool ?? shared.hp;
    const { pool: left, breaks } = absorbHit(had, damage);
    shared.hp -= had - left;
    shared.bar.hp = shared.hp;
    if (b.pool !== undefined) b.pool = left;
    if (b.half) {
      b.half.pool = left;
      b.half.alive = !breaks;
    }
    if (breaks) {
      for (const p of state.parts) p.destroy();
      shared.bodies.delete(state);
      dropPiece(shared);
      return [];
    }
    if (b.pool !== undefined || !splitsAt(shared.hp, shared.maxHp, index, state.parts.length)) {
      flash(scene, part);
      return [enemy];
    }
    part.destroy();
    shared.bodies.delete(state);
    const halves = splitBoss(state.worm, index);
    shared.pieces += halves.length;
    dropPiece(shared);
    const pools = halfPools(shared.hp, halves.map(({ from }) => from.length));
    // The bar rips in two, front half (the old head) on the left.
    const bars = pools.map((pool) => ({ pool, startPool: pool, alive: true }));
    shared.bar.halves = bars;
    return halves.map(({ worm, from }, i) =>
      wormEnemy(scene, style, {
        worm,
        parts: from.map((k) => state.parts[k]),
        hp: from.map((k) => state.hp[k]),
        rng: state.rng.fork(`split ${index} ${i}`),
        nextStepAt: state.nextStepAt,
        boss: { ...splitPiece(b, worm, i === 0), pool: pools[i], half: bars[i] },
      }),
    );
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

/** A boss piece is gone (killed, or replaced by what it broke into); the fight's ground marks go with the last. */
function dropPiece(shared: WormBossShared) {
  shared.pieces--;
  if (shared.pieces > 0) return;
  shared.ground.destroy();
  shared.holes.destroy();
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
 * A piece left after a kill: a rampage goes on in every piece, the one that keeps the head
 * (`front`) carrying on its lunge and a back half starting its own at once.
 */
function splitPiece(parent: BossPiece, worm: Worm, front: boolean): BossPiece {
  const { spit, rampage } = parent;
  return {
    shared: parent.shared,
    nextEggAt: parent.nextEggAt,
    rampageRound: parent.rampageRound,
    // The front half, its segments numbered as before, spits on.
    spit: front && spit ? { ...spit, shots: spit.shots.filter((shot) => shot.segment < worm.segments.length) } : undefined,
    rampage: rampage && carryRampage(rampage, front),
  };
}

function carryRampage(r: Rampage, front: boolean): Rampage {
  const copy = (lunge: Lunge) => ({ ...lunge, path: [...lunge.path] });
  if (front) return { ...r, lunge: r.lunge && copy(r.lunge), next: r.next && copy(r.next) };
  // A back half plans its own lunges (straight away, if cut off mid-lunge).
  const own = { next: undefined, crack: undefined };
  return r.lunge ? { ...r, ...own, phase: 'pausing', until: 0, lunge: undefined } : { ...r, ...own };
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
        rocks: [],
        nextRockfallAt: 0,
        bodies: new Map(),
        rampageRound: 0,
        nextRampageAt: 0,
        ground: scene.add.graphics().setDepth(1),
        holes,
        holeCells: [],
        brood: [],
        bar: { maxHp: cells.length * style.segmentHp, hp: cells.length * style.segmentHp, rage: false },
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
    ...(shared ? { boss: { shared, rampageRound: 0 } } : {}),
  });
}
