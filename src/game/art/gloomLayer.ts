import Phaser from 'phaser';
import { GLOOM, WALL_SHADE, type LightPool } from '../../core/art/gloom';
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

/** What the gloom is drawn over this frame. */
export interface GloomFrame {
  pools: readonly PlacedPool[];
  /** The room's floor in the world, px: the rock outside it is shaded deeper. `top` is where the top wall's cliff face ends, so the face stays as lit as the room. */
  room: { left: number; top: number; right: number; bottom: number };
  /** The middle of each doorway in the room's walls, kept clear of the walls' shade so doors always read. */
  doors: readonly { x: number; y: number }[];
}

/**
 * The gloom over the view (core/gloom): a render texture filled with it each frame and erased back
 * to light round each light pool, a soft glow in its colour laid over a coloured one. Nothing but drawing: which rooms, which pools and how strong all
 * come from the core.
 */
export class GloomLayer {
  private gloom: Phaser.GameObjects.RenderTexture;
  private stamp: Phaser.GameObjects.Image;
  /** The deeper shade over the walls, and the brush its bands are drawn with. */
  private shade: Phaser.GameObjects.RenderTexture;
  private bands: Phaser.GameObjects.Graphics;
  /** Coloured glows, pooled: one per tinted light pool, the rest hidden. */
  private glows: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {
    makeBrush(scene, 'gloom-brush');
    const cam = scene.cameras.main;
    this.gloom = scene.add.renderTexture(0, 0, cam.width + MARGIN * 2, cam.height + MARGIN * 2).setOrigin(0).setDepth(GLOOM_DEPTH).setVisible(false);
    this.stamp = scene.make.image({ key: 'gloom-brush', add: false });
    this.shade = scene.add.renderTexture(0, 0, cam.width + MARGIN * 2, cam.height + MARGIN * 2).setOrigin(0).setDepth(GLOOM_DEPTH + 0.1).setVisible(false);
    this.bands = scene.make.graphics({}, false);
  }

  /** Draws this frame's gloom with its pools cut out of it and the walls shaded deeper; none at all (`undefined`) where the room isn't gloomy. */
  update(frame: GloomFrame | undefined) {
    const pools = frame?.pools;
    this.gloom.setVisible(!!frame);
    this.shade.setVisible(!!frame);
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
    this.shadeWalls(frame!, left, top);
  }

  /** Stacks the walls' shade in bands going out from the room's edge, then clears it from the doorways. */
  private shadeWalls({ room, doors }: GloomFrame, left: number, top: number) {
    const [w, h] = [this.shade.width, this.shade.height];
    const g = this.bands.clear();
    WALL_SHADE.bands.forEach((alpha, i) => {
      const out = i * WALL_SHADE.step;
      const [l, t, r, b] = [room.left - out - left, room.top - out - top, room.right + out - left, room.bottom + out - top];
      g.fillStyle(GLOOM.color, alpha);
      g.fillRect(0, 0, w, Math.max(0, t));
      g.fillRect(0, b, w, Math.max(0, h - b));
      g.fillRect(0, t, Math.max(0, l), b - t);
      g.fillRect(r, t, Math.max(0, w - r), b - t);
    });
    this.shade.setPosition(left, top).clear().draw(g);
    for (const d of doors) {
      this.stamp.setScale(70 / BRUSH).setAlpha(1).setPosition(d.x - left, d.y - top);
      this.shade.erase(this.stamp);
    }
  }
}
