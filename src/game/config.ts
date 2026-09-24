import type { Passive } from '../core/weaponModel';

/** All tunable numbers for the Phaser layer live here. */
export const TUNING = {
  tile: 48,
  playerSpeed: 220,
  playerSize: 30,
  roomSlideMs: 280,
  shotSpeed: 420,
  shotRadius: 7,
  /** The sword's arc width and homing's turn rate come from the weapon model (core/weaponModel). */
  sword: { range: 78, showMs: 110 },
  /** The sword's blade wave (with a shot passive): its size, how long it lives, and its share of a swing's damage. */
  bladeWave: { radius: 11, lifeMs: 280, damageShare: 1 / 3 },
  /** Orbital orbs: how far out and how fast they circle, and what they do to an enemy part they touch (at most every `hitEveryMs`). */
  orbital: { radius: 46, size: 9, degPerSec: 210, damage: 0.8, hitEveryMs: 350 },
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
  /** Twenty segments long; its attacks and their timing live in core/wormBossAttack. */
  wormBoss: { segmentSize: 38, segmentHp: 2.5, stepMs: 230, shotSpeed: 185 },
  /** Its walk/open cycle, stomps, volleys, spikes and chains live in core/ironMaiden. */
  ironMaiden: { hp: 60, width: 40, height: 46, speed: 70, shotSpeed: 175 },
  /** Candles, patterns, relighting and the dark live in core/candleWitch. */
  candleWitch: { hp: 70, radius: 18, speed: 60, relightSpeed: 160, candleShotSpeed: 150, curseSpeed: 200 },
  /** Multipliers for a room's champion: size, hit points, and movement (or firing) speed. */
  champion: { scale: 1.35, hp: 2, speed: 1.15 },
  /** Faster than a zombie; runs off to regroup when hurt (core/forestCast). */
  /**
   * `healRate`: share of its max HP a goblin gets back per second while its partner heals it.
   * `repairCooldownMs`: how long a pair whose heal the player broke fights on before pairing again (placeholders).
   */
  goblin: { hp: 3, speed: 130, retreatSpeed: 110, size: 24, healRate: 0.45, repairCooldownMs: 1000 },
  /** Fires a 3-shot fan (core/forestCast). */
  seedSpitter: { hp: 4, radius: 17, fireDelayMs: 2000, shotSpeed: 200 },
  /** Slow stalker; `lungeSpeed` while lunging (range and timing live in core/ghoul). */
  ghoul: { hp: 4, speed: 55, lungeSpeed: 330, size: 28 },
  crystalTurret: { hp: 4, size: 34, fireDelayMs: 1700, shotSpeed: 220 },
  /** Wake range and burst timing live in core/gargoyle. */
  gargoyle: { hp: 5, size: 34, shotSpeed: 250 },
  /** Touching a thorn bush: half a heart to the player; walker damage and i-frames are placeholders. */
  thorn: { playerDamage: 1, walkerDamage: 1, walkerInvincibleMs: 600 },
  /** `walkSpeed` in px/s. Its rhythm lives in core/treant, root, seed-pod and sweep timing in core/treantAttack. */
  treant: { radius: 46, hp: 70, walkSpeed: 35 },
  hive: { radius: 40, hp: 60, spiralDelayMs: 150, spiralStep: 0.32, shotSpeed: 170, summonEveryMs: 5000, maxSummoned: 3 },
  /** A woken crusher shudders for `windupMs`, then slides `msPerTile` per tile; it can wake again `cooldownMs` after settling. */
  crusher: { windupMs: 220, msPerTile: 60, cooldownMs: 800, enemyDamage: 8, playerDamage: 2 },
  /** Slow and sturdy; its shield's arc and turn rate live in core/shield. `clinkMs`: the blocked-hit spark. */
  knight: { hp: 6, speed: 70, size: 28, clinkMs: 160 },
  /** Small and quicker than a goblin; its zigzag lives in core/wasp. */
  wasp: { hp: 2, speed: 175, size: 14 },
  /** Trots between charges at `speed`, dashes at `dashSpeed`; charge timing and stun live in core/boar. */
  boar: { hp: 4, speed: 60, dashSpeed: 420, width: 34, height: 24 },
  /** The mark over a stunned enemy's head, spinning `spinDegPerSec`. */
  stunMark: { radius: 7, spinDegPerSec: 360 },
  /** Drifts straight at the player through any terrain; its visible/faded cycle lives in core/ghost. */
  ghost: { hp: 4, radius: 15, speed: 60 },
  /** How long a burst glowshroom's cloud lingers on screen; its reach and stun live in core/glowshroom. */
  glowCloud: { showMs: 450 },
  /** Small and frail; its flutter, telegraph and swoop (in tiles) live in core/bat. */
  bat: { hp: 2, width: 26, height: 12 },
  /** How hard overlapping walkers are nudged apart: px/s per px of overlap, and the most any one gets (placeholder). */
  softPush: { stiffness: 8, cap: 120 },
};

/** How passives are named on screen (the HUD and the boss-kill upgrade message). */
export const PASSIVE_NAMES: Record<Passive, string> = {
  homing: 'Homing',
  fireRate: 'Fire rate',
  sword: 'Sword',
  triple: 'Triple shot',
  pierce: 'Piercing',
  ricochet: 'Ricochet',
  spectral: 'Spectral',
  boomerang: 'Boomerang',
  poison: 'Poison',
  chain: 'Chain lightning',
  freeze: 'Freeze',
  orbital: 'Orbital',
  dash: 'Dash',
};

/** Floor, wall, door and terrain colours come from each floor's theme (core/themes). */
export const COLORS = {
  player: 0xe8d7b0,
  shot: 0x9ad0ff,
  zombie: 0x6fa35a,
  turret: 0x8f5fc4,
  wormHead: 0xd98b3a,
  wormBody: 0xb0703a,
  wormBossHead: 0xe0453a,
  wormBossBody: 0x9c2f2a,
  champion: 0xf2b632,
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
  damageUp: 0xff4d6d,
  rateUp: 0xffc233,
  passive: {
    homing: 0x5fd4e8,
    fireRate: 0xff9a3c,
    sword: 0xc8ccd4,
    triple: 0xf2e05a,
    pierce: 0xe05a5a,
    ricochet: 0x7fd4a0,
    spectral: 0xb89aff,
    boomerang: 0xd8a24a,
    poison: 0x7ad84a,
    chain: 0xfff27a,
    freeze: 0x9ae4ff,
    orbital: 0xe8e8f8,
    dash: 0x5ae0c8,
  } as Record<Passive, number>,
  heartEmpty: 0x3a1c20,
  text: '#e8d7b0',
  minimapBackground: 0x000000,
  minimapVisited: 0x8a8394,
  minimapCurrent: 0xf0ecf5,
  minimapItem: 0xf2c94c,
  minimapBoss: 0xd8323c,
  goblin: 0xa8c236,
  goblinEdge: 0x4a3a1c,
  /** A hurt goblin keeping away from the player (placeholder). */
  goblinHurt: 0xdde6a8,
  /** The link between a healing goblin pair, and the healer's pulse (placeholder). */
  goblinHeal: 0x7cf07c,
  seedSpitter: 0xc0584a,
  seedSpitterEdge: 0xf0d27a,
  ghoul: 0x9aa89c,
  ghoulEye: 0xe8f06a,
  crystalTurret: 0x5fc8d8,
  crystalTurretEdge: 0xd8f6ff,
  crystalShot: 0x9ff0ff,
  gargoyle: 0x5e5a66,
  gargoyleEyes: 0xff3b2a,
  treantBark: 0x5a3a1e,
  treantCanopy: 0x3f8a2e,
  treantEyes: 0xf2d04a,
  rootTelegraph: 0xc89a5a,
  root: 0x7a4a22,
  knight: 0xd8d2c0,
  knightEdge: 0x5a5460,
  knightShield: 0x8a93a6,
  shieldClink: 0xf4f6ff,
  wasp: 0xf2c230,
  waspStripe: 0x2a2216,
  boar: 0x7a5236,
  boarTusk: 0xeee2c4,
  boarWindUp: 0xff7a3a,
  stunMark: 0xffe066,
  ghost: 0xd8e8f0,
  ghostEdge: 0x7fa8c8,
  seedPod: 0x8a6a2a,
  podShadow: 0x1a1208,
  sweepTelegraph: 0xd8b25a,
  sweep: 0x6a8a3a,
  glowCloud: 0x8af0b8,
  bat: 0x4a3a5c,
  batWing: 0x1c1424,
  batTelegraph: 0xe05a7a,
  burrowWarning: 0xd8a860,
  fallingRock: 0x8a7458,
  wormHole: 0x14100c,
  maidenIron: 0x5c6068,
  maidenRivets: 0xb8bcc4,
  maidenInside: 0x7a1c20,
  maidenGlow: 0xe8643a,
  witchRobe: 0x3a2450,
  witchTrim: 0x1a1024,
  witchFlame: 0xffb04a,
  candleWax: 0xe8dcc0,
  candleSnuffed: 0x7a7468,
};
