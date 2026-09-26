import Phaser from 'phaser';
import { DARK_DEPTH } from '../entities/bosses/candleWitch';

/** Radius of the soft brush the dust is drawn with. */
const BRUSH = 128;
/** Under the Candle Witch's dark, so her fight hides it as it hides everything else. */
const DUST_DEPTH = DARK_DEPTH - 1;

/** A soft round brush: solid white in the middle, fading to nothing at the rim. */
function makeBrush(scene: Phaser.Scene, key: string) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, BRUSH * 2, BRUSH * 2)!;
  const g = tex.getContext();
  const grad = g.createRadialGradient(BRUSH, BRUSH, 0, BRUSH, BRUSH, BRUSH);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, BRUSH * 2, BRUSH * 2);
  tex.refresh();
}

/**
 * Faint dust drifting through the rooms without paper art (the paper forest has none), cleared
 * ones too. Its randomness is Phaser's own, never the run's.
 */
export class AmbientLayer {
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private scene: Phaser.Scene) {
    makeBrush(scene, 'mote');
    const cam = scene.cameras.main;
    this.dust = scene.add
      .particles(0, 0, 'mote', {
        emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(0, 0, cam.width, cam.height), quantity: 1 },
        lifespan: { min: 5000, max: 8000 },
        speedX: { min: -6, max: 6 },
        speedY: { min: -4, max: 8 },
        scale: { min: 0.012, max: 0.022 },
        alpha: { start: 0.45, end: 0 },
        tint: 0xc8c0b0,
        frequency: 300,
      })
      .setDepth(DUST_DEPTH);
  }

  /** `paper`: the room has paper art, so no dust. */
  update(paper: boolean) {
    const cam = this.scene.cameras.main;
    this.dust.setPosition(cam.scrollX, cam.scrollY).emitting = !paper;
  }
}
