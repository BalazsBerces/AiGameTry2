import Phaser from 'phaser';
import { barShake, layoutBossBar, snapGap, type BarPiece, type BossBarSnapshot } from '../../core/bosses/bossBar';
import { COLORS, TUNING } from '../config';

const BAR = TUNING.bossBar;
/** How far each torn edge's teeth reach, in px, and how many there are; each tooth's depth varies. */
const TOOTH = 5;
const TEETH = 8;
const TOOTH_DEPTH = [0, 1, 0, 1.4, 0, 0.7, 0, 1.2, 0];

/** A heartbeat, 0..1: a strong beat, then a weaker one just after. */
function heartbeat(since: number) {
  const k = (since % BAR.heartbeatMs) / BAR.heartbeatMs;
  const bump = (at: number) => Math.max(0, 1 - Math.abs(k - at) / 0.07);
  return Math.max(bump(0.04), 0.6 * bump(0.22));
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * The worm boss's health bar in the strip under the playfield (core/bossBar lays it out and says
 * how hard it shakes): it fills in as the fight starts, snaps apart violently at the split, a dead
 * half's piece trembles and flickers, breaking off chunk by chunk from its tail end as the half's
 * segments pop, until its last chunk blows apart at the head blast,
 * and the last half trembles through its roar, flashes white, then throbs red.
 */
export class BossBarView {
  private readonly g: Phaser.GameObjects.Graphics;
  private shown?: BossBarSnapshot;
  private shownAt = 0;
  private tornAt?: number;
  private enragedAt?: number;
  /** Pieces (by index) already blown apart, and when the last one went. */
  private crumbled = new Set<number>();
  /** How much of each dying piece (by index) was left last frame, as it breaks off chunk by chunk. */
  private left = new Map<number, number>();
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
    const sinceSnap = time - (bar.splitAt ?? time);
    if (bar.halves && this.tornAt === undefined) {
      this.tornAt = time;
      this.snap(this.edgeX(layoutBossBar(bar, 0)[0].right));
    }
    const pieces = layoutBossBar(bar, bar.halves ? snapGap(sinceSnap, fullGap) : fullGap);
    const shakes = barShake(bar, time);
    const entry = Math.min(1, (time - this.shownAt) / BAR.entryMs);
    // The rip flashes white.
    const flash = bar.halves && sinceSnap < BAR.snapFlashMs;

    pieces.forEach((piece, i) => {
      if (piece.state === 'crumbling') {
        if (!this.crumbled.has(i)) {
          this.crumbled.add(i);
          // What is left of it (a dying piece's head end, the last chunk) blows up with the head.
          this.blowApart(piece, this.left.get(i) ?? 1);
        }
        return;
      }
      if (piece.state === 'dying') {
        // A chunk breaks off its tail end for each segment that pops, down to its head's.
        const had = this.left.get(i) ?? 1;
        if (piece.remaining < had) this.breakOff(piece, piece.remaining, had);
        this.left.set(i, piece.remaining);
      }
      // It flushes red as it roars, and flashes white as the roar ends, then throbs.
      if (piece.state === 'rage') this.enragedAt ??= bar.roar?.until ?? time;
      const jolt = { x: rand(-1, 1) * shakes[i], y: rand(-1, 1) * shakes[i] * 0.6 };
      this.drawPiece(piece, i, pieces.length, entry, time, jolt, !!flash);
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
    this.left.clear();
    this.goneAt = undefined;
  }

  private edgeX = (share: number) => this.cx - BAR.width / 2 + share * BAR.width;

  private drawPiece(piece: BarPiece, index: number, count: number, entry: number, time: number, jolt: { x: number; y: number }, flash: boolean) {
    const x0 = this.edgeX(piece.left) + jolt.x;
    // A dying piece is only what has not broken off yet.
    const x1 = x0 + (this.edgeX(piece.right) - this.edgeX(piece.left)) * piece.remaining;
    const since = piece.state === 'rage' && this.enragedAt !== undefined ? time - this.enragedAt : -1;
    const h = BAR.height * (1 + (since >= 0 ? 0.45 * heartbeat(since) : 0));
    const top = this.cy + jolt.y - h / 2;
    const bottom = this.cy + jolt.y + h / 2;
    // The torn edges: the first piece's right, the second's left.
    const jagLeft = count > 1 && index === 1;
    const jagRight = (count > 1 && index === 0) || piece.remaining < 1;
    if (piece.state === 'dying') {
      // Failing: it flickers in its old colour, now and then going dark or almost out.
      const beat = Math.floor(time / 55) % 4;
      const color = flash ? COLORS.bossBarFlash : beat === 2 ? COLORS.bossBarTrack : COLORS.wormBossBody;
      this.g.fillStyle(color, beat === 3 ? 0.4 : 1).fillPoints(shape(x0, x1, top, bottom, jagLeft, jagRight), true);
      return;
    }
    this.g.fillStyle(flash ? COLORS.bossBarFlash : COLORS.bossBarTrack).fillPoints(shape(x0, x1, top, bottom, jagLeft, jagRight), true);
    const fillW = (x1 - x0) * piece.fill * entry;
    if (fillW <= 0) return;
    const color =
      flash || (since >= 0 && since < BAR.rageFlashMs) ? COLORS.bossBarFlash : piece.state === 'rage' ? COLORS.bossBarRage : COLORS.wormBossBody;
    // It fills from its left edge; the teeth show only where the fill reaches a torn edge.
    const fx1 = x0 + fillW;
    this.g.fillStyle(color).fillPoints(shape(x0, fx1, top, bottom, jagLeft, jagRight && fx1 >= x1 - 0.5), true);
  }

  /** The snap: a shower of scraps falls from the tear, and sparks fly off it. */
  private snap(x: number) {
    for (let i = 0; i < 14; i++) {
      const scrap = this.scene.add.rectangle(x + rand(-4, 4), this.cy + rand(-4, 4), rand(2, 5), rand(2, 3), i % 2 ? COLORS.wormBossBody : COLORS.bossBarTrack);
      this.scene.tweens.add({
        targets: scrap,
        x: scrap.x + rand(-40, 40),
        y: this.cy + rand(8, 26),
        angle: rand(-360, 360),
        alpha: 0,
        duration: BAR.crumbleMs,
        ease: 'Quad.easeIn',
        onComplete: () => scrap.destroy(),
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2);
      const far = rand(18, 46);
      const spark = this.scene.add.rectangle(x, this.cy, rand(3, 6), 1.5, COLORS.bossBarSpark).setRotation(a);
      this.scene.tweens.add({
        targets: spark,
        x: x + Math.cos(a) * far,
        y: this.cy + Math.sin(a) * far * 0.7,
        alpha: 0,
        duration: rand(180, 320),
        ease: 'Quad.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }

  /** The chunk of a dying piece between `from` and `to` (shares of it) breaks off and tumbles away. */
  private breakOff(piece: BarPiece, from: number, to: number) {
    const x0 = this.edgeX(piece.left);
    const width = this.edgeX(piece.right) - x0;
    this.fling(x0 + width * from, width * (to - from), 2, 0.5);
  }

  /** A dead piece blows apart, up to `share` of it (what is left): chunks fly up and sideways, spinning, then fall and fade. */
  private blowApart(piece: BarPiece, share: number) {
    const x0 = this.edgeX(piece.left);
    const width = (this.edgeX(piece.right) - x0) * share;
    this.fling(x0, width, Math.max(5, Math.round(width / 6)), 1);
  }

  /** Breaks the stretch of bar from `x0`, `width` wide, into `count` chunks flung out with `power`. */
  private fling(x0: number, width: number, count: number, power: number) {
    const chunkW = width / count;
    const gravity = 900;
    for (let i = 0; i < count; i++) {
      const color = i % 3 === 0 ? COLORS.bossBarTrack : COLORS.wormBossBody;
      const x = x0 + chunkW * (i + 0.5);
      const chunk = this.scene.add.rectangle(x, this.cy, chunkW * rand(0.5, 0.9), BAR.height * rand(0.5, 1), color);
      const vx = ((x - (x0 + width / 2)) * rand(1.5, 3) + rand(-40, 40) + (power < 1 ? rand(20, 70) : 0)) * power;
      const vy = -rand(140, 280) * power;
      const spin = rand(-900, 900);
      this.scene.tweens.addCounter({
        from: 0,
        to: BAR.crumbleMs / 1000,
        duration: BAR.crumbleMs,
        onUpdate: (tween) => {
          const t = tween.getValue() ?? 0;
          chunk.setPosition(x + vx * t, this.cy + vy * t + (gravity * t * t) / 2).setAngle(spin * t);
          chunk.setAlpha(Math.min(1, 2 * (1 - (t * 1000) / BAR.crumbleMs)));
        },
        onComplete: () => chunk.destroy(),
      });
    }
  }
}

/** A bar piece's outline, with sharp, uneven teeth down whichever edges are torn. */
function shape(x0: number, x1: number, top: number, bottom: number, jagLeft: boolean, jagRight: boolean) {
  const edge = (x: number, outward: number, down: boolean) =>
    Array.from({ length: TEETH + 1 }, (_, i) => {
      const k = down ? i / TEETH : 1 - i / TEETH;
      return new Phaser.Math.Vector2(x + (i % 2 ? outward * TOOTH * TOOTH_DEPTH[i] : 0), top + (bottom - top) * k);
    });
  const right = jagRight ? edge(x1, -1, true) : [new Phaser.Math.Vector2(x1, top), new Phaser.Math.Vector2(x1, bottom)];
  const left = jagLeft ? edge(x0, 1, false) : [new Phaser.Math.Vector2(x0, bottom), new Phaser.Math.Vector2(x0, top)];
  return [...right, ...left];
}
