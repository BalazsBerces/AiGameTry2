import Phaser from 'phaser';
import { COLORS } from '../config';

/** Win or death screen: shows the run seed and starts a fresh run on Enter or click. */
export class EndScene extends Phaser.Scene {
  constructor() {
    super('end');
  }

  create(data: { seed: number; won: boolean }) {
    const { width, height } = this.scale;
    const style = { fontFamily: 'monospace', color: COLORS.text, align: 'center' };
    this.add.text(width / 2, height / 2 - 60, data.won ? 'YOU WIN' : 'YOU DIED', { ...style, fontSize: '48px' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 5, `seed ${data.seed}`, { ...style, fontSize: '20px' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 60, 'press ENTER or click for a new run', { ...style, fontSize: '16px' }).setOrigin(0.5);

    const restart = () => this.scene.start('game', { seed: Math.floor(Math.random() * 2 ** 31) });
    this.input.keyboard!.once('keydown-ENTER', restart);
    this.input.once('pointerdown', restart);
  }
}
