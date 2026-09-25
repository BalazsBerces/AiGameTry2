import Phaser from 'phaser';
import { layoutBossBar, type BarPiece, type BossBarSnapshot } from '../core/bossBar';
import { COLORS, TUNING } from './config';

const BAR = TUNING.bossBar;
/** How far each torn edge's teeth reach, in px. */
const TOOTH = 3;

/** Overshoots a little before settling: the pieces jerk apart. */
const jerk = (k: number) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;

/** A heartbeat, 0..1: a strong beat, then a weaker one just after. */
function heartbeat(since: number) {
  const k = (since % BAR.heartbeatMs) / BAR.heartbeatMs;
  const bump = (at: number) => Math.max(0, 1 - Math.abs(k - at) / 0.07);
  return Math.max(bump(0.04), 0.6 * bump(0.22));
}

/**
 * The worm boss's health bar in the strip under the playfield (core/bossBar lays it out): it
 * fills in as the fight starts, rips in two at the split, a dead half crumbles away, and the last
 * half flashes white, then throbs red.
 */
export class BossBarView {
  private readonly g: Phaser.GameObjects.Graphics;
  private shown?: BossBarSnapshot;
  private shownAt = 0;
  private tornAt?: number;
  private enragedAt?: number;
  /** Pieces (by index) already crumbled away, and when the last one went. */
  private crumbled = new Set<number>();
  private goneAt?: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cx: number,
    private readonly cy: number,
  ) {
    this.g = scene.add.graphics();
  }

  /** Draws the bar (none: nothing). True while it takes the strip. */
  update(bar: BossBarSnapshot | undefined, time: number): boolean {
    this.g.clear();
    if (bar !== this.shown) this.reset(bar, time);
    if (!bar) return false;
    if (this.goneAt !== undefined) return time - this.goneAt < BAR.crumbleMs;

    const fullGap = BAR.gapPx / BAR.width;
    if (bar.halves && this.tornAt === undefined) {
      this.tornAt = time;
      this.shred(this.edgeX(layoutBossBar(bar, 0)[0].right));
    }
    const tearK = this.tornAt === undefined ? 1 : Math.min(1, (time - this.tornAt) / BAR.tearMs);
    const pieces = layoutBossBar(bar, fullGap * jerk(tearK));
    const entry = Math.min(1, (time - this.shownAt) / BAR.entryMs);

    pieces.forEach((piece, i) => {
      if (piece.state === 'crumbling') {
        if (!this.crumbled.has(i)) {
          this.crumbled.add(i);
          this.crumble(piece);
        }
        return;
      }
      if (piece.state === 'rage') this.enragedAt ??= time;
      this.drawPiece(piece, i, pieces.length, entry, time);
    });
    if (this.crumbled.size === pieces.length) this.goneAt = time;
    return true;
  }

  private reset(bar: BossBarSnapshot | undefined, time: number) {
    this.shown = bar;
    this.shownAt = time;
    this.tornAt = undefined;
    this.enragedAt = undefined;
    this.crumbled.clear();
    this.goneAt = undefined;
  }

  private edgeX = (share: number) => this.cx - BAR.width / 2 + share * BAR.width;

  private drawPiece(piece: BarPiece, index: number, count: number, entry: number, time: number) {
    const x0 = this.edgeX(piece.left);
    const x1 = this.edgeX(piece.right);
    const rage = piece.state === 'rage' && this.enragedAt !== undefined;
    const since = rage ? time - this.enragedAt! : 0;
    const h = BAR.height * (1 + (rage ? 0.45 * heartbeat(since) : 0));
    const top = this.cy - h / 2;
    const bottom = this.cy + h / 2;
    // The torn edges: the first piece's right, the second's left.
    const jagLeft = count > 1 && index === 1;
    const jagRight = count > 1 && index === 0;
    this.g.fillStyle(COLORS.bossBarTrack).fillPoints(shape(x0, x1, top, bottom, jagLeft, jagRight), true);
    const fillW = (x1 - x0) * piece.fill * entry;
    if (fillW <= 0) return;
    const color = !rage ? COLORS.wormBossBody : since < BAR.rageFlashMs ? COLORS.bossBarFlash : COLORS.bossBarRage;
    // It fills from its left edge; the teeth show only where the fill reaches a torn edge.
    const fx1 = x0 + fillW;
    this.g.fillStyle(color).fillPoints(shape(x0, fx1, top, bottom, jagLeft, jagRight && fx1 >= x1 - 0.5), true);
  }

  /** A few scraps fall from the tear. */
  private shred(x: number) {
    for (let i = 0; i < 5; i++) {
      const scrap = this.scene.add.rectangle(x + (Math.random() - 0.5) * 6, this.cy, 3, 2, i % 2 ? COLORS.wormBossBody : COLORS.bossBarTrack);
      this.scene.tweens.add({
        targets: scrap,
        x: scrap.x + (Math.random() - 0.5) * 24,
        y: this.cy + 10 + Math.random() * 12,
        angle: (Math.random() - 0.5) * 360,
        alpha: 0,
        duration: BAR.tearMs * 2,
        ease: 'Quad.easeIn',
        onComplete: () => scrap.destroy(),
      });
    }
  }

  /** A dead piece breaks into chunks that tumble down and fade. */
  private crumble(piece: BarPiece) {
    const x0 = this.edgeX(piece.left);
    const width = this.edgeX(piece.right) - x0;
    const count = Math.max(3, Math.round(width / 24));
    const chunkW = width / count;
    for (let i = 0; i < count; i++) {
      const filled = (i + 0.5) / count < piece.fill;
      const color = !filled ? COLORS.bossBarTrack : piece.state === 'rage' ? COLORS.bossBarRage : COLORS.wormBossBody;
      const chunk = this.scene.add.rectangle(x0 + chunkW * (i + 0.5), this.cy, chunkW - 1, BAR.height, color);
      this.scene.tweens.add({
        targets: chunk,
        x: chunk.x + (Math.random() - 0.5) * 16,
        y: this.cy + 14 + Math.random() * 16,
        angle: (Math.random() - 0.5) * 120,
        alpha: 0,
        delay: Math.random() * 120,
        duration: BAR.crumbleMs,
        ease: 'Quad.easeIn',
        onComplete: () => chunk.destroy(),
      });
    }
  }
}

/** A bar piece's outline, with teeth down whichever edges are torn. */
function shape(x0: number, x1: number, top: number, bottom: number, jagLeft: boolean, jagRight: boolean) {
  const teeth = 4;
  const edge = (x: number, outward: number, down: boolean) =>
    Array.from({ length: teeth + 1 }, (_, i) => {
      const k = down ? i / teeth : 1 - i / teeth;
      return new Phaser.Math.Vector2(x + (i % 2 ? outward * TOOTH : 0), top + (bottom - top) * k);
    });
  const right = jagRight ? edge(x1, -1, true) : [new Phaser.Math.Vector2(x1, top), new Phaser.Math.Vector2(x1, bottom)];
  const left = jagLeft ? edge(x0, 1, false) : [new Phaser.Math.Vector2(x0, bottom), new Phaser.Math.Vector2(x0, top)];
  return [...right, ...left];
}
