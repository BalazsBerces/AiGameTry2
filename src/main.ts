import Phaser from 'phaser';
import { EndScene } from './game/EndScene';
import { GameScene } from './game/GameScene';
import { HudScene } from './game/HudScene';
import { CELL_PX_H, CELL_PX_W } from './game/geometry';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CELL_PX_W,
  height: CELL_PX_H,
  backgroundColor: '#0d0b10',
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene, HudScene, EndScene],
});

// Handle for the smoke-test driver (scripts/smoke.mjs); dev builds only.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
