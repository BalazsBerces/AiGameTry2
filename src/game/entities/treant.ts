import type Phaser from 'phaser';
import type { Cell } from '../../core/floorGenerator';
import { planRootEruption, rootEruptionAt, type RootEruption } from '../../core/treantAttack';
import { COLORS, TUNING } from '../config';
import { singlePartEnemy, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Floor 1 boss, rooted at the cave mouth: sends fans of roots erupting along the ground toward
 * the player. Each fan is telegraphed on the ground before it bursts; the attack is planned by
 * core/treantAttack, this only draws it and hurts the player standing on an erupting cell.
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

  const enemy = singlePartEnemy(scene, sprite, hp, (ctx: EnemyContext) => {
    sprite.body.setVelocity(0, 0);
    if (nextAttackAt === 0) nextAttackAt = ctx.time;
    if (!attack && ctx.time >= nextAttackAt) {
      attack = planRootEruption(ctx.tiles, cell, ctx.playerTile);
      attackStart = ctx.time;
    }
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
    }
    return remaining;
  };
  return enemy;
}
