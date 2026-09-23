import type { Passive } from '../core/weaponModel';

/** All tunable numbers for the Phaser layer live here. */
export const TUNING = {
  tile: 48,
  playerSpeed: 220,
  playerSize: 30,
  roomSlideMs: 280,
  shotSpeed: 420,
  shotRadius: 7,
  /** How fast homing shots can turn, in radians per second. */
  homingTurnRate: 5,
  sword: { range: 78, arcDeg: 90, showMs: 110 },
  invincibleMs: 1000,
  enemyWakeMs: 500,
  /** After a chest opens, items can't be picked up for this long. */
  chestLockoutMs: 450,
  zombie: { hp: 3, speed: 85, size: 28 },
  turret: { hp: 4, size: 34, fireDelayMs: 1600, shotSpeed: 230 },
  enemyShotRadius: 6,
  /** Damage to enemy parts is a placeholder; the player always loses a full heart. */
  bomb: { fuseMs: 1500, enemyDamage: 6, playerDamage: 2, radius: 12 },
  worm: { segmentSize: 30, segmentHp: 2, stepMs: 300 },
  wormBoss: { segmentSize: 42, segmentHp: 5, stepMs: 240 },
  /** `follow`: how hard it closes on its mirrored target (1/s); speed capped relative to the player's. */
  shadow: { hp: 45, follow: 10, maxSpeedFactor: 1.2 },
  /** `restMs`: pause between root eruptions. Root timing itself lives in core/treantAttack. */
  treant: { radius: 46, hp: 70, restMs: 700 },
};

/** Floor, wall, door and terrain colours come from each floor's theme (core/themes). */
export const COLORS = {
  player: 0xe8d7b0,
  shot: 0x9ad0ff,
  zombie: 0x6fa35a,
  turret: 0x8f5fc4,
  wormHead: 0xd98b3a,
  wormBody: 0xb0703a,
  shadow: 0x15121a,
  shadowEdge: 0x8a7fa0,
  wormBossHead: 0xe0453a,
  wormBossBody: 0x9c2f2a,
  enemyShot: 0xff6b5a,
  lockedDoor: 0x3a2515,
  heart: 0xd8323c,
  key: 0xf2c94c,
  bomb: 0x2a2a33,
  bombFuse: 0xff9a3c,
  blast: 0xffd27a,
  chest: 0x9a6a36,
  lockedChest: 0xc9a227,
  openChest: 0x4a3420,
  passive: { homing: 0x5fd4e8, fireRate: 0xff9a3c, sword: 0xc8ccd4 } as Record<Passive, number>,
  heartEmpty: 0x3a1c20,
  text: '#e8d7b0',
  minimapBackground: 0x000000,
  minimapVisited: 0x8a8394,
  minimapCurrent: 0xf0ecf5,
  minimapItem: 0xf2c94c,
  minimapBoss: 0xd8323c,
  treantBark: 0x5a3a1e,
  treantCanopy: 0x3f8a2e,
  treantEyes: 0xf2d04a,
  rootTelegraph: 0xc89a5a,
  root: 0x7a4a22,
};
