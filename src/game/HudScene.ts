import Phaser from 'phaser';
import { currentFloorIndex, minimapRooms } from '../core/world';
import { COLORS } from './config';
import type { GameScene } from './GameScene';

const HEART = { size: 18, gap: 6, x: 14, y: 14 };
/** Minimap window in the top-right corner, centred on the current room. */
const MAP = { w: 150, h: 84, margin: 10, cellW: 16, cellH: 10, gap: 2 };

/** Overlay drawn in screen space on top of the game scene. */
export class HudScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private minimap!: Phaser.GameObjects.Graphics;
  private floorText!: Phaser.GameObjects.Text;
  private keysText!: Phaser.GameObjects.Text;
  private bombsText!: Phaser.GameObjects.Text;

  constructor() {
    super('hud');
  }

  create() {
    this.graphics = this.add.graphics();
    const x = this.scale.width - MAP.w - MAP.margin;
    this.add.rectangle(x, MAP.margin, MAP.w, MAP.h, COLORS.minimapBackground, 0.7).setOrigin(0);
    this.minimap = this.add.graphics();
    const mask = this.make.graphics({}).fillRect(x, MAP.margin, MAP.w, MAP.h);
    this.minimap.setMask(mask.createGeometryMask());
    this.add.rectangle(HEART.x + 4, HEART.y + HEART.size + 18, 8, 16, COLORS.key);
    this.keysText = this.add.text(HEART.x + 14, HEART.y + HEART.size + 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: COLORS.text,
    });
    this.add.circle(HEART.x + 64, HEART.y + HEART.size + 18, 7, COLORS.bomb).setStrokeStyle(2, COLORS.bombFuse);
    this.bombsText = this.add.text(HEART.x + 76, HEART.y + HEART.size + 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: COLORS.text,
    });
    this.floorText = this.add
      .text(x + MAP.w, MAP.margin + MAP.h + 4, '', { fontFamily: 'monospace', fontSize: '14px', color: COLORS.text })
      .setOrigin(1, 0);
  }

  update() {
    const { world } = this.scene.get('game') as GameScene;
    this.drawHearts(world.player.health, world.player.maxHealth);
    this.drawMinimap(world);
    this.floorText.setText(`FLOOR ${currentFloorIndex(world) + 1}`);
    this.keysText.setText(`x ${world.player.keys}`);
    this.bombsText.setText(`x ${world.player.bombs}`);
  }

  private drawHearts(health: number, maxHealth: number) {
    const g = this.graphics.clear();
    for (let i = 0; i < maxHealth / 2; i++) {
      const x = HEART.x + i * (HEART.size + HEART.gap);
      const halves = Phaser.Math.Clamp(health - i * 2, 0, 2);
      g.fillStyle(COLORS.heartEmpty).fillRect(x, HEART.y, HEART.size, HEART.size);
      if (halves > 0) g.fillStyle(COLORS.heart).fillRect(x, HEART.y, (HEART.size * halves) / 2, HEART.size);
    }
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
      const minX = Math.min(...cells.map((c) => c.x));
      const minY = Math.min(...cells.map((c) => c.y));
      const spanX = Math.max(...cells.map((c) => c.x)) - minX + 1;
      const spanY = Math.max(...cells.map((c) => c.y)) - minY + 1;
      const x = centreX + (minX - focus.x - 0.5) * pitchX;
      const y = centreY + (minY - focus.y - 0.5) * pitchY;
      const w = spanX * pitchX - MAP.gap;
      const h = spanY * pitchY - MAP.gap;

      if (visited) g.fillStyle(isCurrent ? COLORS.minimapCurrent : COLORS.minimapVisited).fillRect(x, y, w, h);
      else g.lineStyle(1, COLORS.minimapVisited).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      const icon = kind === 'item' ? COLORS.minimapItem : kind === 'boss' ? COLORS.minimapBoss : undefined;
      if (icon !== undefined) g.fillStyle(icon).fillCircle(x + w / 2, y + h / 2, 3);
    }
  }
}
