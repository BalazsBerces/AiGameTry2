import type Phaser from 'phaser';
import { SHADOW } from '../../core/art/svg';
import { createScraps, type BurstKind, type Scrap, type Scraps } from '../../core/juice/scraps';

/** The most scraps in the air at once: past this the oldest are reused. */
const POOL = 240;
/** How quickly flying scraps slow (share of speed kept per second). */
const DRAG = 0.04;
/** Texture size of each torn shape; scraps are scaled down from it. */
const CUT = 24;

/** Three torn shapes of white paper, each with the usual down-right shadow; tinted per scrap. */
const SHAPES: readonly (readonly [number, number][])[] = [
  [[2, 4], [20, 1], [16, 19], [5, 15]],
  [[3, 3], [21, 8], [4, 20]],
  [[1, 9], [22, 6], [21, 13], [2, 16]],
];

function makeCuts(scene: Phaser.Scene) {
  SHAPES.forEach((pts, i) => {
    const key = `scrap${i}`;
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, CUT, CUT)!;
    const g = tex.getContext();
    const path = (dx: number, dy: number) => {
      g.beginPath();
      pts.forEach(([x, y], j) => (j ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
      g.closePath();
    };
    g.fillStyle = `rgba(6,8,5,${SHADOW.opacity})`;
    path(SHADOW.dx * 0.6, SHADOW.dy * 0.6);
    g.fill();
    g.fillStyle = '#ffffff';
    path(0, 0);
    g.fill();
    tex.refresh();
  });
}

interface Live {
  image: Phaser.GameObjects.Image;
  scrap: Scrap;
  age: number;
}

/** Paper scraps flying off deaths, hits and bombs (core/juice/scraps), from a pool of images. */
export class ScrapLayer {
  private scraps: Scraps = createScraps(Math.floor(Math.random() * 2 ** 31));
  private live: Live[] = [];
  private idle: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene, private depth: number) {
    makeCuts(scene);
  }

  burst(kind: BurstKind, at: { x: number; y: number }, palette: readonly number[]) {
    for (const scrap of this.scraps.burst(kind, at, palette)) {
      const reused = this.live.length >= POOL ? this.live.shift()!.image : this.idle.pop();
      const image = (reused ?? this.scene.add.image(0, 0, 'scrap0').setDepth(this.depth))
        .setTexture(`scrap${scrap.shape}`)
        .setTint(scrap.color)
        .setScale(scrap.size / CUT)
        .setAngle(scrap.angle)
        .setPosition(scrap.x, scrap.y)
        .setAlpha(1)
        .setVisible(true);
      this.live.push({ image, scrap: { ...scrap }, age: 0 });
    }
  }

  /** Moves every scrap on by `deltaMs` of game time: flying out, slowing, then fading as it settles. */
  update(deltaMs: number) {
    const dt = deltaMs / 1000;
    const keep = DRAG ** dt;
    this.live = this.live.filter((l) => {
      l.age += deltaMs;
      if (l.age >= l.scrap.lifeMs) {
        l.image.setVisible(false);
        this.idle.push(l.image);
        return false;
      }
      const s = l.scrap;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= keep;
      s.vy *= keep;
      const left = 1 - l.age / s.lifeMs;
      l.image
        .setPosition(s.x, s.y)
        .setAngle(l.image.angle + s.spin * dt * left)
        .setAlpha(Math.min(1, left * 3));
      return true;
    });
  }
}
