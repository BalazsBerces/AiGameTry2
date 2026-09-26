import type Phaser from 'phaser';
import {
  createWitch,
  damageFactor,
  isDark,
  lightSources,
  relightTarget,
  snuffCandle,
  updateWitch,
  type Witch,
} from '../../../core/bosses/candleWitch';
import type { Cell } from '../../../core/map/floorGenerator';
import { COLORS, TUNING } from '../../config';
import { flash, type Enemy, type EnemyContext, type EnemySprite } from '../enemy';

/** Soft round brushes the dark is erased with: a flame's glow and the player's own small circle of sight. */
const LIGHTS = { flame: { key: 'witch-light-flame', tiles: 3.4 }, player: { key: 'witch-light-player', tiles: 1.5 } };
/** Above everything in the room but flames and enemy shots, which stay readable in the dark. */
export const DARK_DEPTH = 50;

function makeLight(scene: Phaser.Scene, key: string, radius: number) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, radius * 2, radius * 2)!;
  const g = tex.getContext();
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, radius * 2, radius * 2);
  tex.refresh();
}

type At = (c: Cell) => { x: number; y: number };

/**
 * Floor 3 boss (one of the floor's pool): a witch floating over an open crypt with a candle in
 * each corner (`candleCells`). Every lit candle fires its own pattern and she casts curses at
 * the player; one shot snuffs a candle, and every so often she floats over to relight one,
 * taking heavy damage while she does. Below half her hit points the room goes dark but for the
 * lit candles, her flame and a little light around the player. The rules are core/candleWitch's.
 */
export function createCandleWitch(scene: Phaser.Scene, cell: Cell, candleCells: Cell[], at: At, roomSize: { width: number; height: number }): Enemy {
  const { hp: maxHp, radius, speed, relightSpeed, candleShotSpeed, curseSpeed } = TUNING.candleWitch;
  const t = TUNING.tile;
  const start = at(cell);
  const origin = at({ x: 0, y: 0 });
  const toTiles = (p: { x: number; y: number }) => ({ x: (p.x - origin.x) / t + 0.5, y: (p.y - origin.y) / t + 0.5 });
  const fromTiles = (p: { x: number; y: number }) => ({ x: origin.x + (p.x - 0.5) * t, y: origin.y + (p.y - 0.5) * t });

  const sprite = scene.add.circle(start.x, start.y, radius, COLORS.witchRobe).setStrokeStyle(3, COLORS.witchTrim) as unknown as EnemySprite;
  scene.physics.add.existing(sprite);
  sprite.body.setCircle(radius);
  const hat = scene.add.triangle(start.x, start.y, 0, 18, 11, 0, 22, 18, COLORS.witchTrim);
  const flame = scene.add.circle(start.x, start.y, 5, COLORS.witchFlame).setDepth(DARK_DEPTH + 1);
  const halo = scene.add.circle(start.x, start.y, radius + 8).setStrokeStyle(3, COLORS.witchFlame, 0.9).setVisible(false);
  const candles = candleCells.map((c) => {
    const p = at(c);
    const wax = scene.add.rectangle(p.x, p.y + 4, 12, 24, COLORS.candleWax).setStrokeStyle(2, COLORS.witchTrim) as unknown as EnemySprite;
    scene.physics.add.existing(wax);
    wax.body.setImmovable(true);
    return wax;
  });
  const flames = candles.map((c) => scene.add.circle(c.x, c.y - 18, 6, COLORS.witchFlame).setDepth(DARK_DEPTH + 1));
  makeLight(scene, LIGHTS.flame.key, LIGHTS.flame.tiles * t);
  makeLight(scene, LIGHTS.player.key, LIGHTS.player.tiles * t);

  let hp = maxHp;
  let witch: Witch | undefined;
  let dark: Phaser.GameObjects.RenderTexture | undefined;
  let wander = start;

  const fire = (ctx: EnemyContext, from: { x: number; y: number }, angles: number[], shotSpeed: number) => {
    for (const a of angles) ctx.fireEnemyShot(from.x, from.y, Math.cos(a) * shotSpeed, Math.sin(a) * shotSpeed);
  };

  /** Floats to hover over the candle she is relighting, or drifts between random spots in the room. */
  const drift = (w: Witch) => {
    const target = relightTarget(w);
    let goal = wander;
    if (target) {
      const c = at(target);
      goal = { x: c.x, y: c.y - t * 0.8 };
    } else if (Math.hypot(goal.x - sprite.x, goal.y - sprite.y) < 8) {
      wander = at({ x: 3 + Math.floor(Math.random() * (roomSize.width - 6)), y: 2 + Math.floor(Math.random() * (roomSize.height - 4)) });
    }
    const dx = goal.x - sprite.x;
    const dy = goal.y - sprite.y;
    const len = Math.hypot(dx, dy);
    const v = Math.min(target ? relightSpeed : speed, len * 6);
    if (len < 4) sprite.body.setVelocity(0, 0);
    else sprite.body.setVelocity((dx / len) * v, (dy / len) * v);
  };

  /** Dark, erased back to light around every flame and a little around the player. */
  const drawDark = (ctx: EnemyContext, w: Witch) => {
    if (!isDark(hp, maxHp)) return;
    const left = origin.x - t / 2 - t;
    const top = origin.y - t / 2 - t;
    dark ??= scene.add.renderTexture(left, top, (roomSize.width + 2) * t, (roomSize.height + 2) * t).setOrigin(0, 0).setDepth(DARK_DEPTH);
    dark.clear().fill(0x000000, 0.93);
    const light = (p: { x: number; y: number }, brush: { key: string; tiles: number }) => {
      const r = brush.tiles * t;
      dark!.erase(brush.key, p.x - r - left, p.y - r - top);
    };
    for (const p of lightSources(w, toTiles(flame))) light(fromTiles(p), LIGHTS.flame);
    light(ctx.player, LIGHTS.player);
  };

  const enemy: Enemy = {
    parts: [sprite, ...candles],
    collidesWithTerrain: false,
    flies: true,
    update(ctx: EnemyContext) {
      const out = updateWitch(witch ?? createWitch(ctx.time, candleCells), { time: ctx.time, player: toTiles(ctx.player), witch: toTiles(sprite) });
      witch = out.witch;
      for (const a of out.attacks) {
        if (a.from === 'witch') fire(ctx, sprite, a.angles, curseSpeed);
        else fire(ctx, candles[a.candle], a.angles, candleShotSpeed);
      }
      drift(witch);
      for (const c of candles) c.body.setVelocity(0, 0);
      witch.candles.forEach((c, i) => {
        flames[i].setVisible(c.lit);
        candles[i].setFillStyle(c.lit ? COLORS.candleWax : COLORS.candleSnuffed);
      });
      halo.setVisible(!!relightTarget(witch)).setPosition(sprite.x, sprite.y);
      hat.setPosition(sprite.x, sprite.y - radius - 4);
      flame.setPosition(sprite.x, sprite.y - radius - 16);
      drawDark(ctx, witch);
    },
    // Her candles are wax and flame: bumping into one doesn't hurt.
    harmless: (part) => part !== sprite,
    hit(part, damage) {
      const candle = candles.indexOf(part);
      if (candle >= 0) {
        if (witch?.candles[candle].lit) witch = snuffCandle(witch, candle);
        return [enemy];
      }
      hp -= damage * (witch ? damageFactor(witch) : 1);
      if (hp > 0) {
        flash(scene, sprite);
        return [enemy];
      }
      for (const o of [sprite, hat, flame, halo, ...candles, ...flames]) o.destroy();
      dark?.destroy();
      return [];
    },
  };
  return enemy;
}
