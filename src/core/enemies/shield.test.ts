import { describe, expect, it } from 'vitest';
import { shieldBlocks, turnKnight, type ShieldRules } from './shield';

const deg = (d: number) => (d * Math.PI) / 180;
/** A hit travelling along `headingDeg` (0 = right, 90 = down, as on screen). */
const hit = (headingDeg: number) => ({ x: Math.cos(deg(headingDeg)), y: Math.sin(deg(headingDeg)) });

// A 120 degree shield: it covers 60 degrees either side of where the knight faces.
const RULES: ShieldRules = { arcDeg: 120, turnDegPerSec: 90 };

describe('shield facing', () => {
  it('blocks a hit coming at the knight head-on', () => {
    // Knight faces right; a shot flying left meets the shield.
    expect(shieldBlocks(0, hit(180), RULES)).toBe(true);
    // Knight faces up; a shot flying down meets the shield.
    expect(shieldBlocks(deg(-90), hit(90), RULES)).toBe(true);
  });

  it('blocks hits from anywhere inside the front arc', () => {
    // Facing right: shots arriving from 45 degrees above or below the facing line.
    expect(shieldBlocks(0, hit(180 - 45), RULES)).toBe(true);
    expect(shieldBlocks(0, hit(180 + 45), RULES)).toBe(true);
  });

  it('lets hits from the flanks through', () => {
    // Facing right; shots flying straight down or straight up strike its sides.
    expect(shieldBlocks(0, hit(90), RULES)).toBe(false);
    expect(shieldBlocks(0, hit(-90), RULES)).toBe(false);
    // Just outside the arc: 75 degrees off the facing line.
    expect(shieldBlocks(0, hit(180 - 75), RULES)).toBe(false);
  });

  it('lets hits from behind through', () => {
    // Facing right; a shot flying right comes up from behind.
    expect(shieldBlocks(0, hit(0), RULES)).toBe(false);
    expect(shieldBlocks(deg(-90), hit(-90), RULES)).toBe(false);
  });

  it('wraps angles: facing just below +180 still blocks a shot from just past -180', () => {
    // Facing left (179 degrees); a shot flying right (-1 degrees) comes at it head-on.
    expect(shieldBlocks(deg(179), hit(-1), RULES)).toBe(true);
  });

  it('a wider arc covers the flank a narrower one leaves open', () => {
    expect(shieldBlocks(0, hit(180 - 75), { ...RULES, arcDeg: 180 })).toBe(true);
  });
});

describe('knight turning', () => {
  it('turns toward the player no faster than its turn rate', () => {
    // Facing right, the player straight below: 90 degrees a second, half a second.
    expect(turnKnight(0, { x: 0, y: 5 }, 500, RULES)).toBeCloseTo(deg(45));
    // A second later it has made the full quarter turn.
    expect(turnKnight(0, { x: 0, y: 5 }, 1000, RULES)).toBeCloseTo(deg(90));
  });

  it('stops on the player rather than overshooting', () => {
    expect(turnKnight(0, { x: 3, y: 1 }, 5000, RULES)).toBeCloseTo(Math.atan2(1, 3));
  });

  it('turns the short way round', () => {
    // Facing 170 degrees, the player at -170: the short way is 20 degrees through 180.
    const after = turnKnight(deg(170), hit(-170), 100, RULES);
    // 9 degrees further round, past 170 (wrapped or not).
    expect(Math.cos(after)).toBeCloseTo(Math.cos(deg(179)));
    expect(Math.sin(after)).toBeCloseTo(Math.sin(deg(179)));
  });

  it('keeps its facing when the player stands on it', () => {
    expect(turnKnight(deg(30), { x: 0, y: 0 }, 1000, RULES)).toBeCloseTo(deg(30));
  });

  it('so a player circling faster than it turns gets round its shield', () => {
    // The player orbits the knight at 180 degrees a second, starting straight ahead of it.
    let facing = 0;
    let flanked = false;
    for (let t = 0; t <= 1000; t += 50) {
      const around = deg(180 * (t / 1000));
      facing = turnKnight(facing, { x: Math.cos(around), y: Math.sin(around) }, 50, RULES);
      // A shot fired from the player at the knight flies opposite to where the player stands.
      if (!shieldBlocks(facing, { x: -Math.cos(around), y: -Math.sin(around) }, RULES)) flanked = true;
    }
    expect(flanked).toBe(true);
  });
});
