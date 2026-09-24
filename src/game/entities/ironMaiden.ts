import type Phaser from 'phaser';
import { stepDownhill } from '../../core/grid';
import { canHurtMaiden, createIronMaiden, IRON_MAIDEN, spikeAt, updateIronMaiden, type IronMaiden } from '../../core/ironMaiden';
import { createRng } from '../../core/rng';
import { COLORS, TUNING } from '../config';
import { flash, type Enemy, type EnemyContext, type EnemySprite } from './enemy';

/**
 * Floor 3 boss, a walking torture device (one of the floor's pool): it walks at the player shut,
 * stomping out rings of shots, stops and shudders, then swings open to spray spikes, and only
 * then can it be hurt. Spikes it drives up through the floor burst into more shots; below half
 * its hit points it swings its snapped chains in turning rings. The cycle is core/ironMaiden's.
 */
export function createIronMaidenBoss(scene: Phaser.Scene, x: number, y: number): Enemy {
  const { hp: maxHp, width, height, speed, shotSpeed } = TUNING.ironMaiden;
  const sprite = scene.add.rectangle(x, y, width, height, COLORS.maidenIron).setStrokeStyle(3, COLORS.maidenRivets) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setImmovable(true);
  // The inside (shown when open), its two doors, and the face on the lid.
  const inside = scene.add.rectangle(x, y, width - 10, height - 10, COLORS.maidenInside).setVisible(false);
  const doors = [0, 1].map(() => scene.add.rectangle(x, y, width / 2, height, COLORS.maidenIron).setStrokeStyle(2, COLORS.maidenRivets).setVisible(false));
  const face = scene.add.rectangle(x, y - height * 0.22, width * 0.4, 6, COLORS.maidenRivets);
  const ground = scene.add.graphics().setDepth(1);
  const chains = scene.add.graphics().setDepth(9);
  const rng = createRng(Math.floor(Math.random() * 2 ** 31));
  let hp = maxHp;
  let maiden: IronMaiden | undefined;

  /** Draws the maiden shut, shuddering before it opens, or swung open. */
  const drawBody = (m: IronMaiden, time: number) => {
    const open = m.phase === 'open';
    const shake = m.phase === 'telegraph' ? Math.sin(time / 25) * 3 : 0;
    sprite.setFillStyle(open ? COLORS.maidenInside : COLORS.maidenIron);
    sprite.setStrokeStyle(3, m.phase === 'telegraph' ? COLORS.maidenGlow : COLORS.maidenRivets);
    inside.setVisible(open).setPosition(sprite.x, sprite.y);
    face.setVisible(!open).setPosition(sprite.x + shake, sprite.y - height * 0.22);
    doors.forEach((d, i) => d.setVisible(open).setPosition(sprite.x + (i === 0 ? -1 : 1) * width * 0.75, sprite.y));
  };

  const drawSpikes = (ctx: EnemyContext, m: IronMaiden) => {
    const t = TUNING.tile;
    ground.clear();
    for (const s of m.spikes) {
      const p = ctx.tileCenter(s.cell);
      const state = spikeAt(s, ctx.time);
      if (state === 'warning') {
        ground.fillStyle(COLORS.maidenGlow, 0.25).fillCircle(p.x, p.y, t * 0.35);
        ground.lineStyle(2, COLORS.maidenGlow, 0.8).strokeCircle(p.x, p.y, t * 0.35);
      } else if (state === 'out') {
        ground.fillStyle(COLORS.maidenRivets, 1);
        for (const [dx, dy] of [[-10, 8], [10, 8], [0, -6]]) ground.fillTriangle(p.x + dx - 6, p.y + dy + 8, p.x + dx + 6, p.y + dy + 8, p.x + dx, p.y + dy - 12);
        if (s.cell.x === ctx.playerTile.x && s.cell.y === ctx.playerTile.y) ctx.hurtPlayer();
      }
    }
  };

  const drawChains = (time: number, phaseTwo: boolean, walking: boolean) => {
    chains.clear();
    if (!phaseTwo || !walking) return;
    const turn = (time / 1000) * ((IRON_MAIDEN.chainSpinDegPerSec * Math.PI) / 180);
    chains.lineStyle(4, COLORS.maidenRivets, 0.9);
    for (let i = 0; i < IRON_MAIDEN.chainArms; i++) {
      const a = turn + (2 * Math.PI * i) / IRON_MAIDEN.chainArms;
      chains.lineBetween(sprite.x, sprite.y, sprite.x + Math.cos(a) * width * 1.6, sprite.y + Math.sin(a) * width * 1.6);
    }
  };

  const fire = (ctx: EnemyContext, from: { x: number; y: number }, angles: number[]) => {
    for (const a of angles) ctx.fireEnemyShot(from.x, from.y, Math.cos(a) * shotSpeed, Math.sin(a) * shotSpeed);
  };

  const walkAt = (ctx: EnemyContext) => {
    const here = ctx.tileOf(sprite.x, sprite.y);
    const next = here.x === ctx.playerTile.x && here.y === ctx.playerTile.y ? undefined : stepDownhill(ctx.walkDistance, here);
    const target = next ? ctx.tileCenter(next) : ctx.player;
    const dx = target.x - sprite.x;
    const dy = target.y - sprite.y;
    const len = Math.hypot(dx, dy) || 1;
    sprite.body.setVelocity((dx / len) * speed, (dy / len) * speed);
  };

  const enemy: Enemy = {
    parts: [sprite],
    collidesWithTerrain: true,
    update(ctx: EnemyContext) {
      const phaseTwo = hp <= maxHp / 2;
      const aim = Math.atan2(ctx.player.y - sprite.y, ctx.player.x - sprite.x);
      const out = updateIronMaiden(maiden ?? createIronMaiden(ctx.time), { time: ctx.time, phaseTwo, aim, player: ctx.playerTile, tiles: ctx.tiles, rng });
      maiden = out.maiden;
      for (const attack of out.attacks) {
        if (attack.kind === 'spike') fire(ctx, ctx.tileCenter(attack.cell), attack.angles);
        else fire(ctx, sprite, attack.angles);
        if (attack.kind === 'stomp') {
          const wave = scene.add.circle(sprite.x, sprite.y, width / 2).setStrokeStyle(4, COLORS.maidenGlow).setDepth(2);
          scene.tweens.add({ targets: wave, scale: 3, alpha: 0, duration: 350, onComplete: () => wave.destroy() });
        }
      }
      if (maiden.phase === 'walk') walkAt(ctx);
      else sprite.body.setVelocity(0, 0);
      drawBody(maiden, ctx.time);
      drawSpikes(ctx, maiden);
      drawChains(ctx.time, phaseTwo, maiden.phase === 'walk');
    },
    // Shut, it turns every blow aside.
    blocks: () => !maiden || !canHurtMaiden(maiden),
    hit(_part, damage) {
      if (!maiden || !canHurtMaiden(maiden)) return [enemy];
      hp -= damage;
      if (hp > 0) {
        flash(scene, sprite);
        return [enemy];
      }
      for (const o of [sprite, inside, face, ground, chains, ...doors]) o.destroy();
      return [];
    },
  };
  return enemy;
}
