import type Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction } from '../../../core/map/floorGenerator';
import { createRng, type Rng } from '../../../core/rng';
import { WORM_BOSS_LENGTH } from '../../../core/rooms/roomGenerator';
import { createWorm, killSegment, splitBoss, nextStepDue, stepWorm, type Worm, type WormPiece } from '../../../core/bosses/wormChain';
import { broodTick, eggStage, planEggLob, WORM_BROOD } from '../../../core/bosses/wormBrood';
import {
  absorbHit,
  bossCrawl,
  breakOut,
  canAttack,
  canBeHurt,
  chainAt,
  deathChain,
  halfPools,
  inLastStand,
  isRoaring,
  lastStandPool,
  lungeCracks,
  momentTick,
  planLunge,
  planRockfall,
  rockfallAt,
  splitsAt,
  splitStop,
  spitWave,
  WORM_BOSS,
  type BossMoment,
  type Lunge,
  type SpitShot,
} from '../../../core/bosses/wormBossAttack';
import type { BarHalf, BossBarSnapshot } from '../../../core/bosses/bossBar';
import { hitsToBreak } from '../../../core/map/tiles';
import { COLORS, TUNING } from '../../config';
import { shellBurst, shakeScreen, spray } from '../../effects/shellBurst';
import { championBoost, championColor, flash, singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from '../enemy';

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
  /** Pieces still alive, and dead ones still blowing apart; the fight is over once both are none. */
  pieces: number;
  corpses: number;
  /** When the last piece to die will have blown apart: any piece left holds still until then. */
  deathHoldUntil?: number;
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
  /** Floor decals, each drawn once and kept for the whole fight: holes and rubble, and ichor splats. */
  marks: Phaser.GameObjects.Graphics;
  holeCells: Cell[];
  /** The parts of each egg and hatchling from before its split; one counts while any of its parts lives. */
  brood: EnemySprite[][];
  /** Eggs in the air, each lobbed at `start` from where one of its segments was; they count toward the brood. */
  lobs: { eggs: { from: { x: number; y: number }; cell: Cell }[]; start: number }[];
  /** Eggs in flight, over everything, redrawn every frame. */
  air: Phaser.GameObjects.Graphics;
  /** Its health bar (core/bossBar), kept up to date in place: the scene shows this very object. */
  bar: BossBarSnapshot;
  tickedAt: number;
  rng: Rng;
  scene: Phaser.Scene;
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
  /** The moments it holds still for (its split, its roar), and its pool as the roar began (it heals from there). */
  moment?: BossMoment;
  /** A half's end torn open at the split, which twitches and spurts through the stop, and when it next spurts. */
  rawEnd?: 'head' | 'tail';
  nextSpurtAt?: number;
  poolAtRoar?: number;
  /** Dead, and blowing apart. */
  dying?: Dying;
  /** The last rampage round it has joined, or sat out (too short). */
  rampageRound: number;
  rampage?: Rampage;
}

/** A dead piece blowing apart: when it died, and how many of its segments have popped. */
interface Dying {
  at: number;
  popped: number;
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

/**
 * Draws falling rocks' shadows and lands them, and eggs in flight; once per frame, whichever
 * piece asks first.
 */
function tickGround(scene: Phaser.Scene, ctx: EnemyContext, shared: WormBossShared) {
  if (shared.tickedAt === ctx.time) return;
  shared.tickedAt = ctx.time;
  const t = TUNING.tile;
  const g = shared.ground.clear();
  flyEggs(scene, ctx, shared);
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

/**
 * Eggs arc from the segments that threw them to their cells like a Treant's seed pods, each
 * landing spot shadowed until it comes down; there it lands, harmless, as an egg.
 */
function flyEggs(scene: Phaser.Scene, ctx: EnemyContext, shared: WormBossShared) {
  const air = shared.air.clear();
  shared.lobs = shared.lobs.filter((lob) => {
    const k = (ctx.time - lob.start) / WORM_BROOD.flightMs;
    if (k >= 1) {
      for (const { cell } of lob.eggs) ctx.spawnEnemy(wormEgg(scene, ctx, shared, cell));
      return false;
    }
    for (const { from, cell } of lob.eggs) {
      const p = ctx.tileCenter(cell);
      shared.ground.fillStyle(COLORS.podShadow, 0.2 + 0.4 * k).fillEllipse(p.x, p.y + 6, 12 + 26 * k, 6 + 12 * k);
      const lift = Math.sin(Math.PI * k) * TUNING.tile * 2.5;
      const x = from.x + (p.x - from.x) * k;
      const y = from.y + (p.y - from.y) * k - lift;
      air.fillStyle(COLORS.wormEgg, 1).fillEllipse(x, y, 16, 20);
      air.lineStyle(2, COLORS.wormBossBody, 1).strokeEllipse(x, y, 16, 20);
    }
    return true;
  });
}

/** A lunge tunnelling into the wall shakes rocks loose across the room, if the shared rockfall cooldown is up; none land on `avoid`. */
function shakeRocksLoose(ctx: EnemyContext, shared: WormBossShared, avoid: Cell[]) {
  if (ctx.time < shared.nextRockfallAt) return;
  shared.nextRockfallAt = ctx.time + WORM_BOSS.rockfallCooldownMs;
  const cells = planRockfall(ctx.tiles, [...[...shared.bodies.values()].flat(), ...avoid], ctx.doors, shared.rng);
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
  const g = shared.marks;
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

  /** Before its split: lobs eggs around itself, from any of its segments, now and then, while it is all out of the walls. */
  const lobEggs = (ctx: EnemyContext, b: BossPiece) => {
    const { shared } = b;
    const living = shared.brood.filter((parts) => parts.some((p) => p.active));
    const inFlight = shared.lobs.flatMap((lob) => lob.eggs.map(({ cell }) => cell));
    const tick = broodTick(b.nextEggAt, ctx.time, {
      split: b.pool !== undefined,
      aboveGround: !b.rampage && !inWalls(ctx),
      brood: living.length + inFlight.length,
    });
    b.nextEggAt = tick.nextLobAt;
    if (!tick.eggs) return;
    // Never onto an egg on its way down, or anything of the brood already there.
    const taken = [...inFlight, ...living.flat().filter((p) => p.active).map((p) => ctx.tileOf(p.x, p.y))];
    const eggs = planEggLob(ctx.tiles, ctx.doors, state.worm.segments, ctx.playerTile, taken, tick.eggs, shared.rng).map(({ from, cell }) => {
      const part = state.parts[state.worm.segments.findIndex((c) => sameCell(c, from))];
      return { from: { x: part.x, y: part.y }, cell };
    });
    if (eggs.length) shared.lobs.push({ eggs, start: ctx.time });
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
      drawLungeCrack(ctx, b, r);
      // The one warning, as it charges up: its head swells and throbs while the body shudders.
      const charging = r.phase === 'charging';
      if (charging) head.setScale(1.15 + 0.2 * Math.abs(Math.sin(ctx.time / 70)));
      // It holds still on the cells it lunges from: it may have been caught mid-glide, or
      // overshot its last cell a little.
      state.worm.segments.forEach((c, i) => {
        const at = ctx.tileCenter(c);
        const shudder = charging && i > 0 ? 4 : 0;
        state.parts[i].body.reset(at.x + (Math.random() - 0.5) * shudder, at.y + (Math.random() - 0.5) * shudder);
      });
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
    const { shotSpeed: speed, shotRadius } = TUNING.wormBoss;
    while (spit.fired < spit.shots.length && spit.shots[spit.fired].atMs <= ctx.time - spit.start) {
      const shot = spit.shots[spit.fired++];
      const part = state.parts[shot.segment];
      if (!part?.active || !part.visible) continue;
      for (const a of shot.angles) ctx.fireEnemyShot(part.x, part.y, Math.cos(a) * speed, Math.sin(a) * speed, false, 0, shotRadius);
    }
    if (spit.fired >= spit.shots.length) b.spit = undefined;
  };

  /** It holds still on its cells, even ones inside a wall, where those segments stay out of sight. */
  const holdStill = (ctx: EnemyContext) => {
    state.worm.segments.forEach((c, i) => {
      const at = ctx.tileCenter(c);
      state.parts[i].body.reset(at.x, at.y);
    });
    hideInWalls(ctx, state.worm.segments);
  };

  /** Its end torn open at the split twitches on its cell and spurts dark droplets now and then. */
  const twitchRawEnd = (ctx: EnemyContext, b: BossPiece) => {
    const part = b.rawEnd && state.parts[b.rawEnd === 'head' ? 0 : state.parts.length - 1];
    if (!part?.visible) return;
    const twitch = 5;
    part.body.reset(part.x + (Math.random() - 0.5) * twitch, part.y + (Math.random() - 0.5) * twitch);
    if (ctx.time < (b.nextSpurtAt ?? 0)) return;
    b.nextSpurtAt = ctx.time + TUNING.shellBurst.spurtEveryMs * (0.6 + Math.random() * 0.8);
    spray(scene, part, 2 + Math.floor(Math.random() * 3));
  };

  /**
   * The moments it holds still for, unhurtable (core/wormBossAttack `momentTick`): the stop at
   * its split, and the hold while its twin blows apart, after each of which it crawls on (out of
   * any wall); and the roar that opens its last stand. Before the roar it finishes any lunge and
   * crawls out of the walls; then its head swells and throbs while rings spread from it. True
   * while it holds still or waits to roar (no rampage, no eggs).
   */
  const holdMoments = (ctx: EnemyContext, b: BossPiece): boolean => {
    const was = b.moment;
    const lastStand = inLastStand(b.pool !== undefined, b.shared.pieces);
    b.moment = momentTick(b.moment, ctx.time, {
      lastStand,
      aboveGround: !inWalls(ctx) && !b.rampage?.lunge,
      deathHoldUntil: b.shared.deathHoldUntil,
    });
    const head = state.parts[0];
    if (b.moment?.phase === 'splitStop' || b.moment?.phase === 'deathHold') {
      // It drops whatever it was doing, mid-lunge too; caught charging up, its head goes back to size.
      b.rampage = undefined;
      b.spit = undefined;
      head.setScale(1);
      holdStill(ctx);
      if (b.moment.phase === 'splitStop') twitchRawEnd(ctx, b);
      return true;
    }
    if (was?.phase === 'splitStop' || was?.phase === 'deathHold') state.nextStepAt = ctx.time;
    if (b.moment?.phase === 'waiting') {
      // Out of its lunge, it drops the rampage and crawls on out of the walls.
      if (b.rampage && !b.rampage.lunge) {
        b.rampage = undefined;
        head.setScale(1);
        state.nextStepAt = ctx.time;
      }
      return false;
    }
    if (b.moment?.phase === 'done' && was?.phase === 'roaring') {
      // The roar is over, its heal done: on into its endless rampage.
      healDuringRoar(b, WORM_BOSS.roarMs);
      head.setScale(1);
      state.nextStepAt = ctx.time;
    }
    if (b.moment?.phase !== 'roaring' || !isRoaring(b.moment, ctx.time)) return false;
    if (was?.phase !== 'roaring') {
      b.rampage = undefined;
      b.spit = undefined;
      b.shared.bar.rage = true;
      b.shared.bar.roar = { from: ctx.time, until: b.moment.until };
      b.poolAtRoar = b.pool;
      shakeScreen(scene, 'roar');
      // Settle on its cells: it roars where it stands.
      state.worm.segments.forEach((c, i) => {
        const at = ctx.tileCenter(c);
        state.parts[i].body.reset(at.x, at.y);
      });
    }
    for (const p of state.parts) p.body.setVelocity(0, 0);
    const roar = TUNING.wormRoar;
    head.setScale(roar.headScale + 0.25 * Math.abs(Math.sin(ctx.time / 55)));
    const since = ctx.time - (b.moment.until - WORM_BOSS.roarMs);
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

  /**
   * A dead piece blows apart (core/wormBossAttack `deathChain`): it lies still where it died while
   * its segments pop one by one from its tail, each in a small shell burst, the head last in the
   * big one; then it is out of the fight, and with the last piece the fight is over.
   */
  const blowApart = (ctx: EnemyContext, b: BossPiece, dying: Dying) => {
    if (dying.popped === 0) {
      state.parts[0].setScale(1);
      holdStill(ctx);
    }
    const { popped, over } = chainAt(state.parts.length, ctx.time - dying.at);
    for (const { segment, big } of deathChain(state.parts.length).pops.slice(dying.popped, popped.length)) {
      const part = state.parts[segment];
      // Out of sight in a wall, it goes quietly.
      if (part.visible) shellBurst(scene, part, big ? 'head' : 'pop', big ? style.headColor : style.bodyColor, b.shared.marks);
      part.setVisible(false);
      part.body.enable = false;
      shakeScreen(scene, big ? 'head' : 'pop');
    }
    dying.popped = popped.length;
    if (b.half?.death) b.half.death = { ...b.half.death, pops: popped.length, blown: over };
    if (!over) return;
    const { shared } = b;
    shared.corpses--;
    shared.bodies.delete(state);
    ctx.removeEnemy(enemy);
    if (fightOver(shared)) endFight(shared);
  };

  /**
   * A piece's pool is empty: it dies, but stays in the fight to blow apart, harmless and
   * unhurtable, while its twin (if any) holds still.
   */
  const die = (b: BossPiece) => {
    const now = scene.time.now;
    b.dying = { at: now, popped: 0 };
    if (b.half) b.half.death = { pops: 0, of: state.parts.length, blown: false };
    b.rampage = undefined;
    b.spit = undefined;
    b.shared.pieces--;
    b.shared.corpses++;
    b.shared.deathHoldUntil = now + deathChain(state.parts.length).totalMs;
  };

  /** Runs the boss; true while the piece holds still. */
  const updateBoss = (ctx: EnemyContext, b: BossPiece): boolean => {
    tickGround(scene, ctx, b.shared);
    ctx.showBossBar(b.shared.bar);
    if (b.dying) {
      blowApart(ctx, b, b.dying);
      return true;
    }
    fireSpit(ctx, b);
    if (holdMoments(ctx, b)) return true;
    if (b.moment?.phase === 'waiting' && !b.rampage) return false;
    joinRampage(ctx, b);
    if (b.rampage) return updateRampage(ctx, b, b.rampage);
    lobEggs(ctx, b);
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
    // The boss's pieces are one body: their shared fight state stands for it.
    hitGroup: state.boss?.shared,
    invulnerable: () => !!state.boss?.dying || !canBeHurt(state.boss?.moment, scene.time.now),
    // Blowing apart, it no longer hurts on touch.
    harmless: () => !!state.boss?.dying,
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
    // Holding still for a moment (its split, its twin's death, its roar), or blowing apart, it doesn't even notice.
    if (b.dying || !canBeHurt(b.moment, scene.time.now)) return [enemy];
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
      die(b);
      return [enemy];
    }
    if (b.pool !== undefined || !splitsAt(shared.hp, shared.maxHp, index, state.parts.length)) {
      flash(scene, part);
      return [enemy];
    }
    // It tears apart: the segment hit bursts, and the screen shakes.
    shellBurst(scene, part, 'split', style.bodyColor, shared.marks);
    shakeScreen(scene, 'split');
    part.destroy();
    shared.bodies.delete(state);
    const halves = splitBoss(state.worm, index);
    // The halves take its place.
    shared.pieces += halves.length - 1;
    const pools = halfPools(shared.hp, halves.map(({ from }) => from.length));
    // The bar rips in two, front half (the old head) on the left.
    const bars = pools.map((pool) => ({ pool, startPool: pool, alive: true }));
    shared.bar.halves = bars;
    shared.bar.splitAt = scene.time.now;
    return halves.map(({ worm, from }, i) =>
      wormEnemy(scene, style, {
        worm,
        parts: from.map((k) => state.parts[k]),
        hp: from.map((k) => state.hp[k]),
        rng: state.rng.fork(`split ${index} ${i}`),
        nextStepAt: state.nextStepAt,
        // The front half was torn off at its tail, the back half at its head.
        boss: { ...splitPiece(b, scene.time.now), pool: pools[i], half: bars[i], rawEnd: i === 0 ? 'tail' : 'head' },
      }),
    );
  };
  return enemy;
}

/**
 * One of the worm boss's brood, and every piece it splits into: it lives only as long as the
 * boss does, and pops, taken out of the fight, once the last boss piece has blown apart.
 */
function tethered(enemy: Enemy, shared: WormBossShared): Enemy {
  const brood: Enemy = {
    ...enemy,
    update(ctx) {
      if (!fightOver(shared)) {
        enemy.update(ctx);
        return;
      }
      for (const p of brood.parts) if (p.active && p.visible) shellBurst(shared.scene, p, 'pop', p.fillColor);
      ctx.removeEnemy(brood);
    },
    hit: (part, damage) => enemy.hit(part, damage).map((e) => (e === enemy ? brood : tethered(e, shared))),
  };
  return brood;
}

/**
 * An egg lobbed onto `cell`: it breaks in about two shots, wobbles for its last stretch and then
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

const fightOver = (shared: WormBossShared) => shared.pieces === 0 && shared.corpses === 0;

/** The last boss piece has blown apart: the fight's ground marks go, its splats and holes fading out. */
function endFight(shared: WormBossShared) {
  shared.ground.destroy();
  shared.air.destroy();
  shared.scene.tweens.add({ targets: shared.marks, alpha: 0, delay: TUNING.shellBurst.restMs, duration: 1200, onComplete: () => shared.marks.destroy() });
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
 * A half left by the split, at `now`: it stops dead for a moment, dropping any rampage it was
 * in, and sits out the rest of the round.
 */
function splitPiece(parent: BossPiece, now: number): BossPiece {
  return {
    shared: parent.shared,
    nextEggAt: parent.nextEggAt,
    rampageRound: parent.rampageRound,
    moment: splitStop(now),
  };
}

export function spawnWorm(
  scene: Phaser.Scene,
  cells: Cell[],
  tileCenter: (c: Cell) => { x: number; y: number },
  style: WormStyle = REGULAR_WORM,
  boss = false,
): Enemy {
  // Made before the body so the worm crawls over its own holes and splats.
  const marks = boss ? scene.add.graphics() : undefined;
  const parts = cells.map((c) => {
    const p = tileCenter(c);
    const sprite = scene.add.rectangle(p.x, p.y, style.segmentSize, style.segmentSize, style.bodyColor) as unknown as EnemySprite;
    scene.physics.add.existing(sprite);
    return sprite;
  });
  // A worm still coiled on one cell (a hatchling) heads off any way; it turns if that is blocked.
  const heading = (cells.length > 1 && DIRECTIONS.find((d) => sameCell(cells[0], { x: cells[1].x + STEP[d].x, y: cells[1].y + STEP[d].y }))) || 'right';
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  const shared: WormBossShared | undefined = marks
    ? {
        maxHp: cells.length * style.segmentHp,
        hp: cells.length * style.segmentHp,
        pieces: 1,
        corpses: 0,
        rocks: [],
        nextRockfallAt: 0,
        bodies: new Map(),
        rampageRound: 0,
        nextRampageAt: 0,
        ground: scene.add.graphics().setDepth(1),
        marks,
        holeCells: [],
        brood: [],
        lobs: [],
        air: scene.add.graphics().setDepth(12),
        bar: { maxHp: cells.length * style.segmentHp, hp: cells.length * style.segmentHp, rage: false },
        tickedAt: -1,
        scene,
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
