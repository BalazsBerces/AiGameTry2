import type Phaser from 'phaser';
import type { Cell } from '../../core/floorGenerator';
import { createRng } from '../../core/rng';
import {
  branchSweepHits,
  branchSweepPhase,
  inSweepRange,
  planBranchSweep,
  planRootEruption,
  planSeedVolley,
  rootEruptionAt,
  SWEEP,
  type BranchSweep,
  type RootEruption,
  type SeedVolley,
} from '../../core/treantAttack';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Floor 1 boss, rooted at the cave mouth: sends fans of roots erupting along the ground toward
 * the player, taking turns with volleys of seed pods lobbed around them that sprout rock or
 * thorn where they land; whoever comes close gets a telegraphed sweep of its branches. Each fan is telegraphed on the ground before it bursts, each pod's
 * landing spot is shadowed while it flies; the attacks are planned by core/treantAttack, this
 * only draws them, hurts the player standing on an erupting cell and lands the pods.
 */
export function createTreant(scene: Phaser.Scene, x: number, y: number, cell: Cell): Enemy {
  const { radius, hp, restMs } = TUNING.treant;
  const sprite = scene.add.circle(x, y, radius, COLORS.treantCanopy).setStrokeStyle(6, COLORS.treantBark) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setCircle(radius);
  sprite.body.setImmovable(true);
  // Gnarled trunk crown and glowing eyes, drawn over the canopy.
  const decor: Phaser.GameObjects.Shape[] = [
    scene.add.star(x, y, 6, radius * 0.3, radius * 0.7, COLORS.treantBark),
    scene.add.rectangle(x - radius * 0.22, y - radius * 0.08, 8, 5, COLORS.treantEyes),
    scene.add.rectangle(x + radius * 0.22, y - radius * 0.08, 8, 5, COLORS.treantEyes),
  ];
  const ground = scene.add.graphics().setDepth(1);

  let attack: RootEruption | undefined;
  let attackStart = 0;
  let nextAttackAt = 0;
  // Seed volleys take turns with the root eruptions.
  let volley: SeedVolley | undefined;
  let podsLanded = false;
  let throwSeedsNext = false;
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  const pods = scene.add.graphics().setDepth(12);
  // The branch sweep runs alongside the other attacks whenever the player comes close.
  let sweep: BranchSweep | undefined;
  let sweepStart = 0;
  let nextSweepAt = 0;
  const branches = scene.add.graphics().setDepth(9);
  const home = { x: cell.x + 0.5, y: cell.y + 0.5 };

  /** The arc fills in while telegraphed, then the branches lash across it. */
  const drawSweep = (s: BranchSweep, elapsed: number) => {
    branches.clear();
    const phase = branchSweepPhase(s, elapsed);
    if (phase === 'over') return;
    const reach = s.range * TUNING.tile;
    if (phase === 'telegraph') {
      const warn = elapsed / s.telegraphMs;
      branches.fillStyle(COLORS.sweepTelegraph, 0.12 + 0.25 * warn).slice(x, y, reach, s.aim - s.halfArc, s.aim + s.halfArc).fillPath();
      branches.lineStyle(2, COLORS.sweepTelegraph, 0.8).slice(x, y, reach, s.aim - s.halfArc, s.aim + s.halfArc).strokePath();
      return;
    }
    const swing = (elapsed - s.telegraphMs) / (s.durationMs - s.telegraphMs);
    const at = s.aim - s.halfArc + 2 * s.halfArc * Math.min(1, swing);
    branches.fillStyle(COLORS.sweep, 0.45).slice(x, y, reach, s.aim - s.halfArc, at).fillPath();
    for (const spread of [-0.12, 0, 0.12]) {
      branches.lineStyle(7, COLORS.treantBark, 1).lineBetween(x, y, x + Math.cos(at + spread) * reach, y + Math.sin(at + spread) * reach);
    }
  };

  const updateSweep = (ctx: EnemyContext) => {
    const origin = ctx.tileCenter({ x: 0, y: 0 });
    const player = { x: (ctx.player.x - origin.x) / TUNING.tile + 0.5, y: (ctx.player.y - origin.y) / TUNING.tile + 0.5 };
    if (!sweep && ctx.time >= nextSweepAt && inSweepRange(home, player)) {
      sweep = planBranchSweep(home, player);
      sweepStart = ctx.time;
    }
    if (!sweep) return;
    const elapsed = ctx.time - sweepStart;
    drawSweep(sweep, elapsed);
    if (branchSweepHits(sweep, elapsed, player)) ctx.hurtPlayer();
    if (branchSweepPhase(sweep, elapsed) === 'over') {
      sweep = undefined;
      branches.clear();
      nextSweepAt = ctx.time + SWEEP.cooldownMs;
    }
  };

  const drawRoots = (ctx: EnemyContext, telegraph: Cell[], hurting: Cell[]) => {
    const t = TUNING.tile;
    ground.clear();
    for (const c of telegraph) {
      const p = ctx.tileCenter(c);
      ground.fillStyle(COLORS.rootTelegraph, 0.28).fillRect(p.x - t / 2 + 4, p.y - t / 2 + 4, t - 8, t - 8);
      ground.lineStyle(2, COLORS.rootTelegraph, 0.7).strokeRect(p.x - t / 2 + 4, p.y - t / 2 + 4, t - 8, t - 8);
    }
    for (const c of hurting) {
      const p = ctx.tileCenter(c);
      ground.fillStyle(COLORS.root, 1);
      for (const dx of [-12, 0, 12]) ground.fillTriangle(p.x + dx - 7, p.y + 16, p.x + dx + 7, p.y + 16, p.x + dx, p.y - 18);
    }
  };

  /** Pods arc from the canopy to their cells, each landing spot shadowed until it comes down. */
  const drawPods = (ctx: EnemyContext, v: SeedVolley, elapsed: number) => {
    const t = Math.min(1, elapsed / v.flightMs);
    ground.clear();
    pods.clear();
    if (t >= 1) return;
    for (const pod of v.pods) {
      const p = ctx.tileCenter(pod.cell);
      ground.fillStyle(COLORS.podShadow, 0.2 + 0.4 * t).fillEllipse(p.x, p.y + 6, 12 + 26 * t, 6 + 12 * t);
      const lift = Math.sin(Math.PI * t) * TUNING.tile * 2.5;
      pods.fillStyle(COLORS.seedPod, 1).fillCircle(x + (p.x - x) * t, y + (p.y - y) * t - lift, 9);
    }
  };

  const updateVolley = (ctx: EnemyContext, v: SeedVolley) => {
    const elapsed = ctx.time - attackStart;
    drawPods(ctx, v, elapsed);
    if (elapsed >= v.flightMs && !podsLanded) {
      podsLanded = true;
      for (const pod of v.pods) ctx.landSeedPod(pod.cell, pod.sprout);
    }
    if (elapsed > v.durationMs) {
      volley = undefined;
      nextAttackAt = ctx.time + restMs;
    }
  };

  const enemy = singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    if (nextAttackAt === 0) nextAttackAt = ctx.time;
    updateSweep(ctx);
    if (!attack && !volley && ctx.time >= nextAttackAt) {
      if (throwSeedsNext) {
        volley = planSeedVolley(ctx.tiles, ctx.doors, cell, ctx.playerTile, rng);
        podsLanded = false;
      } else {
        attack = planRootEruption(ctx.tiles, cell, ctx.playerTile);
      }
      throwSeedsNext = !throwSeedsNext;
      attackStart = ctx.time;
    }
    if (volley) updateVolley(ctx, volley);
    if (!attack) return;
    const elapsed = ctx.time - attackStart;
    const { telegraph, hurting } = rootEruptionAt(attack, elapsed);
    drawRoots(ctx, telegraph, hurting);
    if (hurting.some((c) => c.x === ctx.playerTile.x && c.y === ctx.playerTile.y)) ctx.hurtPlayer();
    if (elapsed > attack.durationMs) {
      attack = undefined;
      ground.clear();
      nextAttackAt = ctx.time + restMs;
    }
  });
  const hit = enemy.hit;
  enemy.hit = (part, damage) => {
    const remaining = hit(part, damage);
    if (!remaining.length) {
      for (const d of decor) d.destroy();
      ground.destroy();
      pods.destroy();
      branches.destroy();
    }
    return remaining;
  };
  return enemy;
}
