import { describe, expect, it } from 'vitest';
import { createAnimator } from './animator';

const PLAYER_LIKE = { actions: { idle: 2, move: 4, attack: 3, hurt: 1 }, views: ['side', 'down', 'up'] as const, fps: 10, hurtMs: 300 };
const still = { vx: 0, vy: 0 };

describe('animator', () => {
  it('loops idle while standing still, a frame every 1/fps seconds', () => {
    const a = createAnimator(PLAYER_LIKE);
    expect(a.update(0, still)).toMatchObject({ action: 'idle', frame: 0 });
    expect(a.update(99, still)).toMatchObject({ action: 'idle', frame: 0 });
    expect(a.update(100, still)).toMatchObject({ action: 'idle', frame: 1 });
    expect(a.update(200, still)).toMatchObject({ action: 'idle', frame: 0 });
  });

  it('switches to the move loop when moving, starting from its first frame', () => {
    const a = createAnimator(PLAYER_LIKE);
    a.update(0, still);
    const walk = { vx: 100, vy: 0 };
    expect(a.update(150, walk)).toMatchObject({ action: 'move', frame: 0 });
    expect(a.update(450, walk)).toMatchObject({ action: 'move', frame: 3 });
    expect(a.update(550, walk)).toMatchObject({ action: 'move', frame: 0 });
    expect(a.update(600, still)).toMatchObject({ action: 'idle', frame: 0 });
  });

  it('plays an attack once over its frames, even on the move, then goes back to what the body is doing', () => {
    const a = createAnimator(PLAYER_LIKE);
    const walk = { vx: 100, vy: 0 };
    a.update(0, walk);
    a.attack(1000);
    expect(a.update(1000, walk)).toMatchObject({ action: 'attack', frame: 0 });
    expect(a.update(1150, walk)).toMatchObject({ action: 'attack', frame: 1 });
    expect(a.update(1299, walk)).toMatchObject({ action: 'attack', frame: 2 });
    expect(a.update(1300, walk)).toMatchObject({ action: 'move', frame: 0 });
  });

  it('restarts the attack when attacking again before it finished', () => {
    const a = createAnimator(PLAYER_LIKE);
    a.attack(0);
    a.update(0, still);
    a.attack(250);
    expect(a.update(250, still)).toMatchObject({ action: 'attack', frame: 0 });
  });

  it('holds the hurt pose over everything else for its duration', () => {
    const a = createAnimator(PLAYER_LIKE);
    const walk = { vx: 100, vy: 0 };
    a.hurt(1000);
    a.attack(1100);
    expect(a.update(1100, walk)).toMatchObject({ action: 'hurt', frame: 0 });
    expect(a.update(1299, walk)).toMatchObject({ action: 'hurt', frame: 0 });
    expect(a.update(1300, walk)).toMatchObject({ action: 'move', frame: 0 });
  });

  it('faces the way it moves: sideways mirrored for left, down or up, and keeps facing when it stops', () => {
    const a = createAnimator(PLAYER_LIKE);
    expect(a.update(0, { vx: 120, vy: 40 })).toMatchObject({ view: 'side', flip: false });
    expect(a.update(10, { vx: -120, vy: 0 })).toMatchObject({ view: 'side', flip: true });
    expect(a.update(20, still)).toMatchObject({ view: 'side', flip: true });
    expect(a.update(30, { vx: 20, vy: 120 })).toMatchObject({ view: 'down', flip: false });
    expect(a.update(40, { vx: 0, vy: -120 })).toMatchObject({ view: 'up' });
    expect(a.update(50, still)).toMatchObject({ view: 'up' });
  });

  it('faces where it aims over where it walks', () => {
    const a = createAnimator(PLAYER_LIKE);
    expect(a.update(0, { vx: 120, vy: 0, aim: { x: 0, y: -1 } })).toMatchObject({ view: 'up' });
    expect(a.update(10, { vx: 120, vy: 0, aim: { x: -1, y: 0 } })).toMatchObject({ view: 'side', flip: true });
  });

  it('loops a state the body reports (a goblin healing) in place of idle or move, but under hurt', () => {
    const a = createAnimator({ ...PLAYER_LIKE, actions: { ...PLAYER_LIKE.actions, heal: 2 } });
    expect(a.update(0, { vx: 0, vy: 0, loop: 'heal' })).toMatchObject({ action: 'heal', frame: 0 });
    expect(a.update(100, { vx: 50, vy: 0, loop: 'heal' })).toMatchObject({ action: 'heal', frame: 1 });
    a.hurt(150);
    expect(a.update(150, { vx: 0, vy: 0, loop: 'heal' })).toMatchObject({ action: 'hurt' });
    expect(a.update(500, { vx: 0, vy: 0, loop: 'heal' })).toMatchObject({ action: 'heal', frame: 0 });
  });

  it('ignores a reported state its art has no frames for', () => {
    const a = createAnimator(PLAYER_LIKE);
    expect(a.update(0, { vx: 0, vy: 0, loop: 'healed' })).toMatchObject({ action: 'idle' });
  });

  it('only turns left and right when it has just the one side view', () => {
    const a = createAnimator({ ...PLAYER_LIKE, views: ['side'] });
    a.update(0, { vx: -100, vy: 0 });
    expect(a.update(10, { vx: 0, vy: 120 })).toMatchObject({ view: 'side', flip: true });
    expect(a.update(20, { vx: 60, vy: 120 })).toMatchObject({ view: 'side', flip: false });
  });
});
