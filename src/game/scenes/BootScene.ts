import Phaser from 'phaser';
import { COLORS } from '../config';
import { bakeArt } from '../art/bake';

/** Bakes the paper art into textures before the first run starts. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    const { width, height } = this.scale;
    const label = this.add
      .text(width / 2, height / 2, 'Cutting paper…', { fontFamily: 'monospace', fontSize: '16px', color: COLORS.text })
      .setOrigin(0.5);
    bakeArt(this, (share) => label.setText(`Cutting paper… ${Math.round(share * 100)}%`)).then(
      () => this.scene.start('game'),
      (err: Error) => {
        // Without the art the game still plays with plain shapes.
        console.error(err);
        this.scene.start('game');
      },
    );
  }
}
