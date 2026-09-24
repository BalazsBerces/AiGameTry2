import type Phaser from 'phaser';
import { createRng } from '../../core/rng';
import { createTreant as createTreantBrain, updateTreant, type Treant } from '../../core/treant';
import {
  branchSweepHits,
  branchSweepPhase,
  rootEruptionAt,
  type BranchSweep,
  type Point,
  type SeedVolley,
} from '../../core/treantAttack';
import type { Cell } from '../../core/floorGenerator';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Floor 1 boss. It walks slowly at the player, stopping to send fans of roots erupting along the
 * ground toward them; those take turns with volleys of seed pods lobbed around them (thrown on
 * the move) that sprout rock or thorn where they land. Whoever comes close gets a telegraphed
 * sweep of its branches, which it also stands still for. core/treant decides all of it and
 * core/treantAttack plans the attacks; this only moves and draws it, hurts the player standing on
 * an erupting cell or in a swinging arc, and lands the pods.
 */
export function createTreant(scene: Phaser.Scene, x: number, y: number, _cell: Cell): Enemy {
  const { radius, hp, walkSpeed } = TUNING.treant;
  const maxHp = hp;
  const sprite = scene.add.circle(x, y, radius, COLORS.treantCanopy).setStrokeStyle(6, COLORS.treantBark) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setCircle(radius);
  // It walks into walls and stone like any walker, but the player can't shove it about.
  sprite.body.pushable = false;
  // Gnarled trunk crown and glowing eyes, drawn over the canopy and carried along with it.
  const decor: { shape: Phaser.GameObjects.Shape; dx: number; dy: number }[] = [
    { shape: scene.add.star(x, y, 6, radius * 0.3, radius * 0.7, COLORS.treantBark), dx: 0, dy: 0 },
    { shape: scene.add.rectangle(x, y, 8, 5, COLORS.treantEyes), dx: -radius * 0.22, dy: -radius * 0.08 },
    { shape: scene.add.rectangle(x, y, 8, 5, COLORS.treantEyes), dx: radius * 0.22, dy: -radius * 0.08 },
  ];
  const ground = scene.add.graphics().setDepth(1);
  const pods = scene.add.graphics().setDepth(12);
  const branches = scene.add.graphics().setDepth(9);
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  let brain: Treant | undefined;
  let health = hp;

  /** Tile units (10.5 is the middle of tile 10) to world pixels and back. */
  const toTiles = (ctx: EnemyContext, p: Point): Point => {
    const origin = ctx.tileCenter({ x: 0, y: 0 });
    return { x: (p.x - origin.x) / TUNING.tile + 0.5, y: (p.y - origin.y) / TUNING.tile + 0.5 };
  };
  const toWorld = (ctx: EnemyContext, p: Point): Point => {
    const origin = ctx.tileCenter({ x: 0, y: 0 });
    return { x: origin.x + (p.x - 0.5) * TUNING.tile, y: origin.y + (p.y - 0.5) * TUNING.tile };
  };

  /** The arc fills in while telegraphed, then the branches lash across it. */
  const drawSweep = (ctx: EnemyContext, s: BranchSweep, elapsed: number) => {
    branches.clear();
    const phase = branchSweepPhase(s, elapsed);
    if (phase === 'over') return;
    const { x: cx, y: cy } = toWorld(ctx, s.from);
    const reach = s.range * TUNING.tile;
    if (phase === 'telegraph') {
      const warn = elapsed / s.telegraphMs;
      branches.fillStyle(COLORS.sweepTelegraph, 0.12 + 0.25 * warn).slice(cx, cy, reach, s.aim - s.halfArc, s.aim + s.halfArc).fillPath();
      branches.lineStyle(2, COLORS.sweepTelegraph, 0.8).slice(cx, cy, reach, s.aim - s.halfArc, s.aim + s.halfArc).strokePath();
      return;
    }
    const swing = (elapsed - s.telegraphMs) / (s.durationMs - s.telegraphMs);
    const at = s.aim - s.halfArc + 2 * s.halfArc * Math.min(1, swing);
    branches.fillStyle(COLORS.sweep, 0.45).slice(cx, cy, reach, s.aim - s.halfArc, at).fillPath();
    for (const spread of [-0.12, 0, 0.12]) {
      branches.lineStyle(7, COLORS.treantBark, 1).lineBetween(cx, cy, cx + Math.cos(at + spread) * reach, cy + Math.sin(at + spread) * reach);
    }
  };

  const drawRoots = (ctx: EnemyContext, telegraph: Cell[], hurting: Cell[]) => {
    const t = TUNING.tile;
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

  /** Pods arc from the canopy, wherever it has walked to, to their cells, each landing spot shadowed until it comes down. */
  const drawPods = (ctx: EnemyContext, v: SeedVolley, elapsed: number) => {
    const t = Math.min(1, elapsed / v.flightMs);
    if (t >= 1) return;
    for (const pod of v.pods) {
      const p = ctx.tileCenter(pod.cell);
      ground.fillStyle(COLORS.podShadow, 0.2 + 0.4 * t).fillEllipse(p.x, p.y + 6, 12 + 26 * t, 6 + 12 * t);
      const lift = Math.sin(Math.PI * t) * TUNING.tile * 2.5;
      pods.fillStyle(COLORS.seedPod, 1).fillCircle(sprite.x + (p.x - sprite.x) * t, sprite.y + (p.y - sprite.y) * t - lift, 9);
    }
  };

  const enemy = singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    brain ??= createTreantBrain(ctx.time);
    const player = toTiles(ctx, ctx.player);
    const step = updateTreant(brain, {
      time: ctx.time,
      at: toTiles(ctx, sprite),
      player,
      tiles: ctx.tiles,
      doors: ctx.doors,
      hp: health,
      maxHp,
      rng,
    });
    brain = step.treant;
    for (const e of step.events) {
      if (e.kind === 'podsLand') for (const pod of e.pods) ctx.landSeedPod(pod.cell, pod.sprout);
      if (e.kind === 'crush') ctx.crushSprout(e.cell);
    }

    sprite.body.setVelocity((step.walk?.x ?? 0) * walkSpeed, (step.walk?.y ?? 0) * walkSpeed);
    for (const d of decor) d.shape.setPosition(sprite.x + d.dx, sprite.y + d.dy);

    ground.clear();
    pods.clear();
    const { attack, sweep } = brain;
    if (attack?.kind === 'roots') {
      const { telegraph, hurting } = rootEruptionAt(attack.plan, ctx.time - attack.start);
      drawRoots(ctx, telegraph, hurting);
      if (hurting.some((c) => c.x === ctx.playerTile.x && c.y === ctx.playerTile.y)) ctx.hurtPlayer();
    }
    if (attack?.kind === 'seeds') drawPods(ctx, attack.plan, ctx.time - attack.start);
    if (sweep) {
      const elapsed = ctx.time - sweep.start;
      drawSweep(ctx, sweep.plan, elapsed);
      if (branchSweepHits(sweep.plan, elapsed, player)) ctx.hurtPlayer();
    } else {
      branches.clear();
    }
  });
  const hit = enemy.hit;
  enemy.hit = (part, damage) => {
    health -= damage;
    const remaining = hit(part, damage);
    if (!remaining.length) {
      for (const d of decor) d.shape.destroy();
      ground.destroy();
      pods.destroy();
      branches.destroy();
    }
    return remaining;
  };
  return enemy;
}
