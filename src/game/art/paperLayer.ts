import type Phaser from 'phaser';
import { createAnimator, type Animator } from '../../core/art/animator';
import { charKey } from '../../core/art/catalogue';
import { CHARACTERS, type Action } from '../../core/art/characters';
import { footDepth } from '../../core/art/depth';
import { ART_SCALE, bakedArt } from './bake';

/** Stop-motion frame rate, and how long the hurt pose holds. */
const ANIM = { fps: 9, hurtMs: 220 };
/** How long a hit enemy stays flashed white. */
export const FLASH_MS = 70;

type Shape = Phaser.GameObjects.Shape;

export interface ActorOptions {
  /** How far below the shape's centre its feet are, in px: the art rises above the body from there. */
  footOffset: number;
  champion?: boolean;
  /** Draw size relative to the art (a champion's bigger body). */
  scale?: number;
}

/**
 * A paper character standing in for a physics shape. The shape keeps doing everything it did
 * (moving, colliding, being hit, its alpha and visibility) but the camera no longer draws it;
 * the sprite follows it, stands on its feet, sorts by them, and animates from what it does.
 */
export class PaperActor {
  readonly sprite: Phaser.GameObjects.Sprite;
  private animator: Animator;
  private aim?: { x: number; y: number; until: number };
  private flashUntil = 0;
  /** A state the owner reports that loops in place of idle and move (a goblin healing). */
  loop?: Action;
  /** Velocity to animate from when the shape has no moving body (grid movers). */
  motion?: { vx: number; vy: number };

  constructor(
    scene: Phaser.Scene,
    readonly shape: Shape,
    private kind: string,
    private opts: ActorOptions,
    private serial: number,
  ) {
    const art = CHARACTERS[kind];
    this.animator = createAnimator({ actions: art.actions, views: art.views, ...ANIM });
    this.sprite = scene.add.sprite(shape.x, shape.y, '__MISSING').setOrigin(art.anchor.x / art.w, art.anchor.y / art.h);
    scene.cameras.main.ignore(shape);
  }

  attack(time: number) {
    this.animator.attack(time);
  }

  hurt(time: number) {
    this.animator.hurt(time);
    this.flashUntil = time + FLASH_MS;
  }

  /** Faces `dir` for a while regardless of how it walks (the player turning to shoot). */
  faceFor(dir: { x: number; y: number }, until: number) {
    this.aim = { ...dir, until };
  }

  /** Brings the sprite in line with the shape and picks this frame's art. False once the shape is gone. */
  sync(time: number): boolean {
    const { shape, sprite } = this;
    if (!shape.active) {
      sprite.destroy();
      return false;
    }
    const body = shape.body as Phaser.Physics.Arcade.Body | null;
    const v = this.motion ?? { vx: body?.velocity.x ?? 0, vy: body?.velocity.y ?? 0 };
    const aim = this.aim && time < this.aim.until ? this.aim : undefined;
    const f = this.animator.update(time, { ...v, aim, loop: this.loop });
    // A champion's gold-trimmed frame where there is one, else the plain frame.
    const trimmed = charKey(this.kind, f.action, f.frame, f.view, this.opts.champion);
    const key = bakedArt(trimmed) ? trimmed : charKey(this.kind, f.action, f.frame, f.view);
    const art = bakedArt(key);
    if (art) sprite.setTexture(art.texture, key);
    const scale = (this.opts.scale ?? 1) / ART_SCALE;
    const footY = shape.y + this.opts.footOffset * shape.scaleY * (this.opts.scale ?? 1);
    sprite
      .setPosition(shape.x, footY)
      .setScale(scale * shape.scaleX, scale * shape.scaleY)
      .setFlipX(f.flip)
      .setAlpha(shape.alpha)
      .setVisible(shape.visible)
      .setDepth(footDepth(footY, this.serial));
    if (time < this.flashUntil) sprite.setTintFill(0xffffff);
    else sprite.clearTint();
    return true;
  }
}

/** Where a piece's canvas is pinned: its anchor point goes on the spot it is placed at. */
export interface PieceFrame {
  w: number;
  h: number;
  anchor: { x: number; y: number };
}

type Art = Phaser.GameObjects.Image;

/** Every paper sprite the scene keeps in step with its shape. */
export class PaperLayer {
  private actors: PaperActor[] = [];
  /** Pieces that move with a shape (sliding logs, sprouting bushes): kept on it every frame. */
  private followers: { shape: Shape; art: Art; footOffset: number }[] = [];
  private serial = 0;

  constructor(private scene: Phaser.Scene) {}

  /**
   * A still piece of paper art with its anchor at x,y: standing (sorted with everything else by its
   * foot line `footY`) or, with no foot line, lying flat under it all. Undefined if the art isn't baked.
   */
  piece(key: string, x: number, y: number, frame: PieceFrame, footY?: number): Art | undefined {
    const art = bakedArt(key);
    if (!art) return undefined;
    const image = this.scene.add.image(x, y, art.texture, key).setOrigin(frame.anchor.x / frame.w, frame.anchor.y / frame.h).setScale(1 / ART_SCALE);
    if (footY !== undefined) image.setDepth(footDepth(footY, this.serial++));
    return image;
  }

  /** `art` stands in for `shape` from now on: the camera stops drawing the shape, and the art goes when it goes. */
  standIn(shape: Shape, art: Art) {
    this.scene.cameras.main.ignore(shape);
    shape.setData('art', art);
    shape.once('destroy', () => art.destroy());
  }

  /** `shape`'s stand-in art, if it has one. */
  static artOf(shape: Phaser.GameObjects.GameObject): Art | undefined {
    return shape.getData('art') as Art | undefined;
  }

  /** Keeps a stand-in on its moving shape: position, scale, alpha and depth follow it every frame. */
  follow(shape: Shape, art: Art, footOffset: number) {
    this.followers.push({ shape, art, footOffset });
  }

  /** A paper character for `shape`, or undefined if `kind` has no baked art (the shape keeps drawing itself). */
  actor(shape: Shape, kind: string, opts: ActorOptions): PaperActor | undefined {
    if (!CHARACTERS[kind] || !bakedArt(charKey(kind, 'idle', 0, CHARACTERS[kind].views[0]))) return undefined;
    const actor = new PaperActor(this.scene, shape, kind, opts, this.serial++);
    this.actors.push(actor);
    return actor;
  }

  /** The actor standing in for `shape`, if any. */
  of(shape: Phaser.GameObjects.GameObject): PaperActor | undefined {
    return this.actors.find((a) => a.shape === shape);
  }

  update(time: number) {
    this.actors = this.actors.filter((a) => a.sync(time));
    this.followers = this.followers.filter(({ shape, art, footOffset }) => {
      if (!shape.active) return false;
      art
        .setPosition(shape.x, shape.y)
        .setScale(shape.scaleX / ART_SCALE, shape.scaleY / ART_SCALE)
        .setAlpha(shape.alpha)
        .setVisible(shape.visible);
      if (art.depth >= 1) art.setDepth(footDepth(shape.y + footOffset, 0));
      return true;
    });
  }
}
