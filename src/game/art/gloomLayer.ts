import Phaser from 'phaser';
import { GLOOM, type LightPool } from '../../core/art/gloom';
import { DARK_DEPTH } from '../entities/bosses/candleWitch';

/** Under the Candle Witch's own, deeper dark (and the HUD, a scene of its own), so her fight works as it always has. */
export const GLOOM_DEPTH = DARK_DEPTH - 1;
/** Radius of the soft brush light pools are erased with. */
const BRUSH = 128;
/** The gloom reaches this far past the view, so the camera never outruns it for a frame. */
const MARGIN = 64;
/** How strongly a coloured glower tints its light pool, at full strength. */
const TINT = 0.17;

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

/** A light pool placed in the world, cast in `tint` (a crystal's cyan) where it has one. */
export type PlacedPool = LightPool & { x: number; y: number; tint?: number };

/**
 * The gloom over the view (core/gloom): a render texture filled with it each frame and erased back
 * to light round each light pool, a soft glow in its colour laid over a coloured one. Nothing but drawing: which rooms, which pools and how strong all
 * come from the core.
 */
export class GloomLayer {
  private gloom: Phaser.GameObjects.RenderTexture;
  private stamp: Phaser.GameObjects.Image;
  /** Coloured glows, pooled: one per tinted light pool, the rest hidden. */
  private glows: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {
    makeBrush(scene, 'gloom-brush');
    const cam = scene.cameras.main;
    this.gloom = scene.add.renderTexture(0, 0, cam.width + MARGIN * 2, cam.height + MARGIN * 2).setOrigin(0).setDepth(GLOOM_DEPTH).setVisible(false);
    this.stamp = scene.make.image({ key: 'gloom-brush', add: false });
  }

  /** Draws this frame's gloom with `pools` cut out of it; none at all (`undefined`) where the room isn't gloomy. */
  update(pools: readonly PlacedPool[] | undefined) {
    this.gloom.setVisible(!!pools);
    const tinted = pools?.filter((p) => p.tint !== undefined) ?? [];
    while (this.glows.length < tinted.length) {
      this.glows.push(this.scene.add.image(0, 0, 'gloom-brush').setBlendMode(Phaser.BlendModes.ADD).setDepth(GLOOM_DEPTH - 0.5));
    }
    this.glows.forEach((g, i) => {
      const p = tinted[i];
      g.setVisible(!!p);
      if (p) g.setPosition(p.x, p.y).setScale((p.radius * 0.8) / BRUSH).setTint(p.tint!).setAlpha(TINT * p.intensity);
    });
    if (!pools) return;
    const cam = this.scene.cameras.main;
    const left = cam.scrollX - MARGIN;
    const top = cam.scrollY - MARGIN;
    this.gloom.setPosition(left, top).clear().fill(GLOOM.color, GLOOM.alpha);
    for (const p of pools) {
      this.stamp.setScale(p.radius / BRUSH).setAlpha(p.intensity).setPosition(p.x - left, p.y - top);
      this.gloom.erase(this.stamp);
    }
  }
}
