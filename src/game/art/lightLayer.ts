import Phaser from 'phaser';
import { DARK, createLights, type Lights } from '../../core/art/lighting';
import { PAPER } from '../../core/art/palette';
import { DARK_DEPTH } from '../entities/bosses/candleWitch';

/** Just under the Candle Witch's own, deeper dark, so her fight still works as it did. */
export const ROOM_DARK_DEPTH = DARK_DEPTH - 1;
/** Radius of the soft brushes the dark is erased with and the warm glows drawn with. */
const BRUSH = 128;
/** The dark reaches this far past the view, so the camera never outruns it for a frame. */
const MARGIN = 64;
/** How strongly a warm light warms what it falls on. */
const WARMTH = 0.16;

/** A soft round brush: solid white in the middle, fading to nothing at the rim. */
function makeBrush(scene: Phaser.Scene, key: string, color: string) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, BRUSH * 2, BRUSH * 2)!;
  const g = tex.getContext();
  const grad = g.createRadialGradient(BRUSH, BRUSH, 0, BRUSH, BRUSH, BRUSH);
  grad.addColorStop(0, color.replace('A', '1'));
  grad.addColorStop(0.45, color.replace('A', '0.9'));
  grad.addColorStop(1, color.replace('A', '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, BRUSH * 2, BRUSH * 2);
  tex.refresh();
}

/** Dark corners over the whole view. */
function makeVignette(scene: Phaser.Scene, key: string, w: number, h: number) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const g = tex.getContext();
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${DARK.vignette})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  tex.refresh();
}

const rgba = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},A)`;
};

/**
 * Every room dark but for its lights (core/lighting): a render texture over the view filled with
 * the dark each frame and erased back to light round each light, a warm glow laid over the art
 * round warm lights, and a vignette. Works the same on every floor, paper art or plain shapes.
 */
export class LightLayer {
  readonly lights: Lights = createLights();
  private dark: Phaser.GameObjects.RenderTexture;
  private stamp: Phaser.GameObjects.Image;
  private glows: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {
    makeBrush(scene, 'light-brush', 'rgba(255,255,255,A)');
    makeBrush(scene, 'light-warm', rgba(PAPER.warmLight));
    const cam = scene.cameras.main;
    this.dark = scene.add.renderTexture(0, 0, cam.width + MARGIN * 2, cam.height + MARGIN * 2).setOrigin(0).setDepth(ROOM_DARK_DEPTH);
    this.stamp = scene.make.image({ key: 'light-brush', add: false });
    makeVignette(scene, 'vignette', cam.width, cam.height);
    scene.add.image(0, 0, 'vignette').setOrigin(0).setScrollFactor(0).setDepth(ROOM_DARK_DEPTH + 0.5);
  }

  /**
   * A soft glow in `color` laid over the dark, for something that is itself a light (a shot);
   * `radius` is how far it reaches. The caller keeps it on its owner and destroys it with it.
   */
  halo(x: number, y: number, color: number, radius: number): Phaser.GameObjects.Image {
    return this.scene.add
      .image(x, y, 'light-brush')
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.55)
      .setScale(radius / BRUSH)
      .setDepth(ROOM_DARK_DEPTH + 1.5);
  }

  update(player: { x: number; y: number }) {
    const cam = this.scene.cameras.main;
    const left = cam.scrollX - MARGIN;
    const top = cam.scrollY - MARGIN;
    this.dark.setPosition(left, top).clear().fill(DARK.color, DARK.alpha);
    const frame = this.lights.frame(player);
    for (const l of frame) {
      this.stamp.setScale(l.radius / BRUSH).setAlpha(l.intensity).setPosition(l.x - left, l.y - top);
      this.dark.erase(this.stamp);
    }
    // Warm glows, pooled: one per warm light, the rest hidden.
    const warm = frame.filter((l) => l.warm);
    while (this.glows.length < warm.length) {
      this.glows.push(this.scene.add.image(0, 0, 'light-warm').setBlendMode(Phaser.BlendModes.ADD).setDepth(ROOM_DARK_DEPTH - 0.5));
    }
    this.glows.forEach((g, i) => {
      const l = warm[i];
      g.setVisible(!!l);
      if (l) g.setPosition(l.x, l.y).setScale((l.radius * 0.9) / BRUSH).setAlpha(WARMTH * l.intensity);
    });
  }
}
