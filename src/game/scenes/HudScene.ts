import Phaser from 'phaser';
import { currentFloorIndex, minimapRooms, roomLabel } from '../../core/map/world';
import { PASSIVE_POOL } from '../../core/rooms/roomGenerator';
import { WEAPON, type PassiveLevels } from '../../core/player/weaponModel';
import { BossBarView } from '../ui/bossBarView';
import { COLORS } from '../config';
import { CELL_PX_H, LABEL_STRIP_H } from '../geometry';
import { HUD_KEYS } from '../../core/art/catalogue';
import { SCRAP_SIZE } from '../../core/art/hud';
import { ART_SCALE, bakedArt } from '../art/bake';

/** The minimap's ink on its paper scrap: rooms seen, the room the player is in, and rooms only glimpsed. */
const MAP_INK = { visited: 0x9a8a6a, current: 0x4a3a2a, outline: 0x6a5a44 };
import type { GameScene } from './GameScene';

const HEART = { size: 18, gap: 6, x: 14, y: 14 };
/** Minimap window in the top-right corner, centred on the current room. */
const MAP = { w: 150, h: 84, margin: 10, cellW: 16, cellH: 10, gap: 2 };
/** The row of owned passives under the keys and bombs. */
const PASSIVES = { x: HEART.x + 7, y: HEART.y + HEART.size + 44, radius: 6, pitch: 20 };
/** Chest stat-up totals, under the passives. */
const STAT_UPS = { x: HEART.x, y: PASSIVES.y + 12 };

/** Overlay drawn in screen space on top of the game scene. */
export class HudScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private minimap!: Phaser.GameObjects.Graphics;
  private floorText!: Phaser.GameObjects.Text;
  private keysText!: Phaser.GameObjects.Text;
  private bombsText!: Phaser.GameObjects.Text;
  private roomText!: Phaser.GameObjects.Text;
  private statUpsText!: Phaser.GameObjects.Text;
  private bossBar!: BossBarView;
  /** Paper hearts, one per heart the player can hold, made as they are needed. */
  private hearts: Phaser.GameObjects.Image[] = [];
  /** The HUD is drawn in paper (its art is baked); otherwise in plain shapes. */
  private paper = false;

  constructor() {
    super('hud');
  }

  create() {
    this.graphics = this.add.graphics();
    this.hearts = [];
    this.paper = !!bakedArt(HUD_KEYS.scrap);
    const x = this.scale.width - MAP.w - MAP.margin;
    if (this.paper) {
      // The map on a torn scrap of paper, a little larger than its window.
      this.hudImage(HUD_KEYS.scrap, x - (SCRAP_SIZE.w - MAP.w) / 2, MAP.margin - (SCRAP_SIZE.h - MAP.h) / 2).setOrigin(0);
    } else {
      this.add.rectangle(x, MAP.margin, MAP.w, MAP.h, COLORS.minimapBackground, 0.7).setOrigin(0);
    }
    this.minimap = this.add.graphics();
    const mask = this.make.graphics({}).fillRect(x, MAP.margin, MAP.w, MAP.h);
    this.minimap.setMask(mask.createGeometryMask());
    if (this.paper) this.hudImage(HUD_KEYS.key, HEART.x + 4, HEART.y + HEART.size + 18).setScale(0.85 / ART_SCALE);
    else this.add.rectangle(HEART.x + 4, HEART.y + HEART.size + 18, 8, 16, COLORS.key);
    this.keysText = this.add.text(HEART.x + 14, HEART.y + HEART.size + 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: COLORS.text,
    });
    if (this.paper) this.hudImage(HUD_KEYS.bomb, HEART.x + 64, HEART.y + HEART.size + 16).setScale(0.85 / ART_SCALE);
    else this.add.circle(HEART.x + 64, HEART.y + HEART.size + 18, 7, COLORS.bomb).setStrokeStyle(2, COLORS.bombFuse);
    this.bombsText = this.add.text(HEART.x + 76, HEART.y + HEART.size + 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: COLORS.text,
    });
    this.statUpsText = this.add.text(STAT_UPS.x, STAT_UPS.y, '', { fontFamily: 'monospace', fontSize: '12px', color: COLORS.text });
    this.floorText = this.add
      .text(x + MAP.w, MAP.margin + MAP.h + 4, '', { fontFamily: 'monospace', fontSize: '14px', color: COLORS.text })
      .setOrigin(1, 0);
    // The current room's layout, in the strip under the playfield, so bad ones can be named.
    this.roomText = this.add
      .text(this.scale.width / 2, CELL_PX_H + LABEL_STRIP_H / 2, '', { fontFamily: 'monospace', fontSize: '12px', color: COLORS.text })
      .setOrigin(0.5);
    // The worm boss's bar takes the same strip while it shows.
    this.bossBar = new BossBarView(this, this.scale.width / 2, CELL_PX_H + LABEL_STRIP_H / 2);
  }

  update() {
    const game = this.scene.get('game') as GameScene;
    const { world } = game;
    this.roomText.setVisible(!this.bossBar.update(game.bossBar, game.now));
    this.drawHearts(world.player.health, world.player.maxHealth);
    this.drawPassives(world.player.passives);
    this.drawMinimap(world);
    this.floorText.setText(`FLOOR ${currentFloorIndex(world) + 1}`);
    this.roomText.setText(roomLabel(world.rooms.get(world.currentRoomId)!));
    this.keysText.setText(`x ${world.player.keys}`);
    this.bombsText.setText(`x ${world.player.bombs}`);
    const { damage, rate } = world.player.statUps;
    // Hidden until the first stat-up.
    this.statUpsText.setText(damage || rate ? `DMG +${(damage * WEAPON.damageUpStep).toFixed(1)}  RATE ×${rate}` : '');
  }

  /** A baked HUD piece at x,y (its centre), at its drawn size. */
  private hudImage(key: string, x: number, y: number) {
    return this.add.image(x, y, bakedArt(key)!.texture, key).setScale(1 / ART_SCALE);
  }

  private drawHearts(health: number, maxHealth: number) {
    const g = this.graphics.clear();
    if (this.paper) {
      const count = Math.ceil(maxHealth / 2);
      while (this.hearts.length < count) {
        const i = this.hearts.length;
        this.hearts.push(this.hudImage(HUD_KEYS.heart('empty'), HEART.x + i * (HEART.size + HEART.gap) + HEART.size / 2, HEART.y + HEART.size / 2));
      }
      this.hearts.forEach((heart, i) => {
        const halves = Phaser.Math.Clamp(health - i * 2, 0, 2);
        const key = HUD_KEYS.heart(halves === 2 ? 'full' : halves === 1 ? 'half' : 'empty');
        heart.setVisible(i < count).setTexture(bakedArt(key)!.texture, key);
      });
      return;
    }
    for (let i = 0; i < maxHealth / 2; i++) {
      const x = HEART.x + i * (HEART.size + HEART.gap);
      const halves = Phaser.Math.Clamp(health - i * 2, 0, 2);
      g.fillStyle(COLORS.heartEmpty).fillRect(x, HEART.y, HEART.size, HEART.size);
      if (halves > 0) g.fillStyle(COLORS.heart).fillRect(x, HEART.y, (HEART.size * halves) / 2, HEART.size);
    }
  }

  /** A dot per owned passive in its pickup's colour, below the keys and bombs; a white ring marks level 2. */
  private drawPassives(passives: PassiveLevels) {
    const g = this.graphics;
    PASSIVE_POOL.filter((p) => passives[p]).forEach((p, i) => {
      const x = PASSIVES.x + i * PASSIVES.pitch;
      g.fillStyle(COLORS.passive[p]).fillCircle(x, PASSIVES.y, PASSIVES.radius);
      if (passives[p] === 2) g.lineStyle(2, 0xffffff).strokeCircle(x, PASSIVES.y, PASSIVES.radius + 3);
    });
  }

  private drawMinimap(world: GameScene['world']) {
    const g = this.minimap.clear();
    const currentCells = world.rooms.get(world.currentRoomId)!.floorRoom.cells;
    const focus = {
      x: currentCells.reduce((s, c) => s + c.x, 0) / currentCells.length,
      y: currentCells.reduce((s, c) => s + c.y, 0) / currentCells.length,
    };
    const centreX = this.scale.width - MAP.margin - MAP.w / 2;
    const centreY = MAP.margin + MAP.h / 2;
    const pitchX = MAP.cellW + MAP.gap;
    const pitchY = MAP.cellH + MAP.gap;

    for (const { room, visited, current: isCurrent } of minimapRooms(world)) {
      const { cells, kind } = room.floorRoom;
      // Each map cell is drawn on its own, joined to its room neighbours across the gap, so
      // wide, tall, big and L rooms all show their real shape.
      const has = (x: number, y: number) => cells.some((c) => c.x === x && c.y === y);
      const origin = (c: { x: number; y: number }) => ({
        x: centreX + (c.x - focus.x - 0.5) * pitchX,
        y: centreY + (c.y - focus.y - 0.5) * pitchY,
      });
      const { cellW: w, cellH: h, gap } = MAP;
      if (visited) {
        g.fillStyle(this.paper ? (isCurrent ? MAP_INK.current : MAP_INK.visited) : isCurrent ? COLORS.minimapCurrent : COLORS.minimapVisited);
        for (const c of cells) {
          const { x, y } = origin(c);
          const right = has(c.x + 1, c.y);
          const down = has(c.x, c.y + 1);
          g.fillRect(x, y, w + (right ? gap : 0), h);
          if (down) g.fillRect(x, y, w, h + gap);
          if (right && down && has(c.x + 1, c.y + 1)) g.fillRect(x + w, y + h, gap, gap);
        }
      } else {
        g.lineStyle(1, this.paper ? MAP_INK.outline : COLORS.minimapVisited);
        for (const c of cells) this.outlineCell(g, origin(c), c, has);
      }

      const icon = kind === 'item' ? COLORS.minimapItem : kind === 'boss' ? COLORS.minimapBoss : undefined;
      if (icon !== undefined) {
        const box = cells.map(origin);
        const x0 = Math.min(...box.map((b) => b.x));
        const y0 = Math.min(...box.map((b) => b.y));
        const x1 = Math.max(...box.map((b) => b.x)) + w;
        const y1 = Math.max(...box.map((b) => b.y)) + h;
        g.fillStyle(icon).fillCircle((x0 + x1) / 2, (y0 + y1) / 2, 3);
      }
    }
  }

  /**
   * Strokes the edges of one map cell that face out of its room. Edges run on across the gap
   * where the room continues, so a multi-cell room gets one unbroken outline, inner corners included.
   */
  private outlineCell(
    g: Phaser.GameObjects.Graphics,
    o: { x: number; y: number },
    c: { x: number; y: number },
    has: (x: number, y: number) => boolean,
  ) {
    const { cellW: w, cellH: h, gap } = MAP;
    const left = o.x + 0.5;
    const top = o.y + 0.5;
    const right = o.x + w - 0.5;
    const bottom = o.y + h - 0.5;
    const line = (x1: number, y1: number, x2: number, y2: number) => g.lineBetween(x1, y1, x2, y2);
    const across = gap + 1;
    const [r, d] = [has(c.x + 1, c.y), has(c.x, c.y + 1)];
    // Straight edges, carried over the gap to the next cell when its edge lies on the same line.
    if (!has(c.x, c.y - 1)) line(left, top, r && !has(c.x + 1, c.y - 1) ? right + across : right, top);
    if (!has(c.x - 1, c.y)) line(left, top, left, d && !has(c.x - 1, c.y + 1) ? bottom + across : bottom);
    if (!r) line(right, top, right, d && !has(c.x + 1, c.y + 1) ? bottom + across : bottom);
    if (!d) line(left, bottom, r && !has(c.x + 1, c.y + 1) ? right + across : right, bottom);
    // An L's inner corner: this cell has room on both sides of a diagonal cell the room leaves out.
    for (const dx of [-1, 1]) {
      for (const dy of [-1, 1]) {
        if (!has(c.x + dx, c.y) || !has(c.x, c.y + dy) || has(c.x + dx, c.y + dy)) continue;
        const cx = dx > 0 ? right : left;
        const cy = dy > 0 ? bottom : top;
        line(cx, cy, cx + dx * across, cy);
        line(cx, cy, cx, cy + dy * across);
      }
    }
  }
}
