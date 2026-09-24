import type Phaser from 'phaser';
import { createRng } from '../../core/rng';
import { canHurtTreant, createTreant as createTreantBrain, TREANT, updateTreant, type Treant } from '../../core/treant';
import {
  branchSweepHits,
  branchSweepPhase,
  RING,
  ringGaps,
  ringHits,
  ringWarning,
  rootEruptionAt,
  type BranchRing,
  type BranchSweep,
  type Point,
  type SeedVolley,
} from '../../core/treantAttack';
import type { Cell } from '../../core/floorGenerator';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/** How the last stand's roots look; placeholders for playtest tuning. Distances in tiles. */
const RING_LOOK = {
  /** Circles of roots round the Treant, from just outside its body, this far apart (and this far apart round each circle). */
  firstRadius: 1.3,
  spacing: 0.8,
  /** Root clusters drawn at this share of the root eruption's size. */
  scale: 0.8,
  growMs: 140,
  sinkMs: 160,
  /** The ground marks drawn while the ring is still a warning. */
  warnSize: 20,
};

/** Rises past 1 and settles back: a root popping up out of the ground. */
function easeOutBack(p: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

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
  // The tree itself stands over its own branches.
  sprite.setDepth(9.5);
  for (const d of decor) d.shape.setDepth(9.6);
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  let brain: Treant | undefined;
  let health = hp;
  /** Keeps the last stand's branches to the room's floor. */
  let ringMask: Phaser.GameObjects.Graphics | undefined;

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

  /** Sinking `p` of the way (0-1) into the ground: shrinking, fading, and out of reach of shots and touch. */
  const drawUnderground = (p: number) => {
    sprite.body.enable = false;
    const scale = 1 - 0.7 * Math.min(1, p);
    for (const shape of [sprite, ...decor.map((d) => d.shape)]) shape.setScale(scale).setAlpha(1 - Math.min(1, p));
  };

  /** A ring of roots marks where it will come up, filling in until it does. */
  const drawMark = (ctx: EnemyContext, cell: Cell, p: number) => {
    const c = ctx.tileCenter(cell);
    ground.fillStyle(COLORS.rootTelegraph, 0.15 + 0.3 * Math.min(1, p)).fillCircle(c.x, c.y, radius);
    ground.lineStyle(3, COLORS.rootTelegraph, 0.9).strokeCircle(c.x, c.y, radius);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const [x, y] = [c.x + Math.cos(a) * radius, c.y + Math.sin(a) * radius];
      ground.fillStyle(COLORS.root, 1).fillTriangle(x - 5, y + 6, x + 5, y + 6, x, y - 10 * Math.min(1, p));
    }
  };

  /** One root cluster of the last stand, fixed in the ground; the gaps sweep over it. */
  interface RingRoot {
    x: number;
    y: number;
    /** Its angle from the Treant, in radians. */
    angle: number;
    up: boolean;
    /** When it last burst up or started sinking. */
    since: number;
    sway: number;
  }
  let ringRoots: RingRoot[] | undefined;

  /** Roots planted in circles round the Treant, `spacing` tiles apart, on open ground only. */
  const plantRingRoots = (ctx: EnemyContext, ring: BranchRing): RingRoot[] => {
    const roots: RingRoot[] = [];
    const reach = Math.hypot(ctx.tiles[0].length, ctx.tiles.length);
    for (let r = RING_LOOK.firstRadius; r < reach; r += RING_LOOK.spacing) {
      const n = Math.max(6, Math.round((2 * Math.PI * r) / RING_LOOK.spacing));
      const offset = (rng.next() * 2 * Math.PI) / n;
      for (let i = 0; i < n; i++) {
        const angle = offset + (i * 2 * Math.PI) / n;
        const at = { x: ring.centre.x + Math.cos(angle) * r, y: ring.centre.y + Math.sin(angle) * r };
        if (!ctx.isWalkable({ x: Math.floor(at.x), y: Math.floor(at.y) })) continue;
        roots.push({ ...toWorld(ctx, at), angle, up: false, since: -Infinity, sway: rng.next() * 2 * Math.PI });
      }
    }
    return roots;
  };

  /** The root eruption's three spikes, `grow` of the way up (overshooting a little as they pop). */
  const drawRootCluster = (px: number, py: number, grow: number, lean: number) => {
    const s = RING_LOOK.scale;
    branches.fillStyle(COLORS.root, 1);
    for (const dx of [-12, 0, 12]) {
      const bx = px + dx * s;
      branches.fillTriangle(bx - 7 * s, py + 16 * s, bx + 7 * s, py + 16 * s, bx + lean, py + 16 * s - 34 * s * grow);
    }
  };

  const drawRootWarning = (px: number, py: number, alpha: number) => {
    const half = RING_LOOK.warnSize / 2;
    branches.fillStyle(COLORS.rootTelegraph, alpha).fillRect(px - half, py - half, half * 2, half * 2);
    branches.lineStyle(2, COLORS.rootTelegraph, Math.min(1, alpha * 2.5)).strokeRect(px - half, py - half, half * 2, half * 2);
  };

  /**
   * The last stand drawn in the root eruption's own roots, packed in circles round the Treant.
   * While it is a warning, the ground outside the gaps is marked as roots mark it before they
   * burst; then roots burst up wherever the gaps are not, sinking as a gap's front edge reaches
   * them and bursting up again behind it. Clipped to the room's floor.
   */
  const drawRing = (ctx: EnemyContext, ring: BranchRing) => {
    branches.clear();
    if (!ringMask) {
      const corner = ctx.tileCenter({ x: 0, y: 0 });
      const t = TUNING.tile;
      ringMask = scene.make.graphics({}).fillRect(corner.x - t / 2, corner.y - t / 2, ctx.tiles[0].length * t, ctx.tiles.length * t);
      branches.setMask(ringMask.createGeometryMask());
    }
    ringRoots ??= plantRingRoots(ctx, ring);
    const half = (RING.gapDeg / 2) * (Math.PI / 180);
    const gaps = ringGaps(ring);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const outside = (a: number) => gaps.every((g) => Math.abs(wrap(a - g)) > half);
    const now = ctx.time;

    if (ringWarning(ring, now)) {
      const warn = Math.min(1, (now - ring.start) / RING.warnMs);
      for (const root of ringRoots) if (outside(root.angle)) drawRootWarning(root.x, root.y, 0.12 + 0.25 * warn);
      return;
    }
    for (const root of ringRoots) {
      const up = outside(root.angle);
      if (up !== root.up) [root.up, root.since] = [up, now];
      const t = now - root.since;
      if (up) {
        const grow = easeOutBack(Math.min(1, t / RING_LOOK.growMs));
        drawRootCluster(root.x, root.y, grow, Math.sin(now / 350 + root.sway) * 3);
      } else if (t < RING_LOOK.sinkMs) {
        drawRootCluster(root.x, root.y, 1 - t / RING_LOOK.sinkMs, 0);
      }
    }
  };

  /** Up out of the ground on `cell`: whoever stands there is hurt and shoved clear. */
  const burst = (ctx: EnemyContext, cell: Cell) => {
    const c = ctx.tileCenter(cell);
    sprite.body.enable = true;
    sprite.body.reset(c.x, c.y);
    for (const shape of [sprite, ...decor.map((d) => d.shape)]) shape.setScale(1).setAlpha(1);
    const clear = radius + TUNING.playerSize / 2;
    if (Math.hypot(ctx.player.x - c.x, ctx.player.y - c.y) < clear) {
      ctx.hurtPlayer();
      ctx.pushPlayerOut(c, clear + 4);
    }
    scene.tweens.add({ targets: sprite, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.easeOut' });
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
      if (e.kind === 'crumble') for (const c of e.cells) ctx.crushSprout(c);
      if (e.kind === 'burst') burst(ctx, e.cell);
    }

    sprite.body.setVelocity((step.walk?.x ?? 0) * walkSpeed, (step.walk?.y ?? 0) * walkSpeed);
    for (const d of decor) d.shape.setPosition(sprite.x + d.dx, sprite.y + d.dy);

    ground.clear();
    pods.clear();
    if (brain.phase === 'sinking' || brain.phase === 'marked') {
      branches.clear();
      drawUnderground(brain.phase === 'sinking' ? (ctx.time - brain.phaseStart) / TREANT.sinkMs : 1);
      if (brain.phase === 'marked') drawMark(ctx, brain.burstAt!, (ctx.time - brain.phaseStart) / TREANT.markMs);
      return;
    }
    if (brain.ring) {
      drawRing(ctx, brain.ring);
      if (ringHits(brain.ring, ctx.time, player)) ctx.hurtPlayer();
      return;
    }
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
    // Underground, nothing reaches it.
    if (brain && !canHurtTreant(brain)) return [enemy];
    health -= damage;
    const remaining = hit(part, damage);
    if (!remaining.length) {
      for (const d of decor) d.shape.destroy();
      ground.destroy();
      pods.destroy();
      branches.destroy();
      ringMask?.destroy();
    }
    return remaining;
  };
  return enemy;
}
