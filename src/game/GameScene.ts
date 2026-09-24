import Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction, type RoomKind } from '../core/floorGenerator';
import { distanceField, lineOfSight } from '../core/grid';
import type { ChampionDrop, EnemySpawn, EnemyType, Tile } from '../core/roomGenerator';
import { themeForFloor, type Palette, type TileLook } from '../core/themes';
import { roomLooks, roomThemeById, type DecorKind } from '../core/roomThemes';
import { blocksShots, blocksSight, hurtsOnTouch, isWalkable } from '../core/tiles';
import { crusherWakes, settleCrusher, slideCrusher, type Crusher } from '../core/crusher';
import { launchVelocity, resolveWeapon, type Weapon } from '../core/weaponModel';
import { fan, ring } from '../core/bulletPatterns';
import { isDashing, tryDash, type Dash } from '../core/dash';
import {
  boomerangLeg,
  createHitLog,
  homingBlocks,
  meetEnemy,
  meetTerrain,
  type HitLog,
  type Leg,
  type ShotMods,
} from '../core/shotFlight';
import {
  BOMB_RADIUS,
  createWorld,
  damagePlayer,
  detonateBomb,
  dropChampionLoot,
  enterRoom,
  hitTile,
  isFinalFloor,
  placeBomb,
  roomAtCell,
  shownPickups,
  sproutTile,
  touchPickup,
  upgradeAfterBoss,
  type World,
  type WorldPickup,
  type WorldRoom,
} from '../core/world';
import { COLORS, PASSIVE_NAMES, TUNING } from './config';
import type { Enemy, EnemyContext, EnemySprite } from './entities/enemy';
import { createIronMaidenBoss } from './entities/ironMaiden';
import { createCandleWitch, DARK_DEPTH } from './entities/candleWitch';
import { createTurret } from './entities/turret';
import { BOSS_WORM, championWorm, REGULAR_WORM, spawnWorm } from './entities/worm';
import { createZombie } from './entities/zombie';
import { createGhoul } from './entities/ghoul';
import { createCrystalTurret } from './entities/crystalTurret';
import { reflectOff, ricochet } from '../core/ricochet';
import { createGargoyle } from './entities/gargoyle';
import { createTreant } from './entities/treant';
import { CELL_PX_H, CELL_PX_W, doorCorridor, mapCellAt, roomBlock, tileAt, tileCenter } from './geometry';
import { createGoblin } from './entities/goblin';
import { createSeedSpitter } from './entities/seedSpitter';
import { createKnight } from './entities/knight';
import { createWasp } from './entities/wasp';
import { createBoar } from './entities/boar';
import { isStunned, stun } from '../core/stun';
import { applyPoison, chainTargets, poisonTick, rollsFreeze, type Poison } from '../core/onHit';
import { createRng } from '../core/rng';
import { smashRock } from '../core/world';
import { createGhost } from './entities/ghost';
import { stunBurst, GLOWSHROOM_RADIUS, type BurstTarget } from '../core/glowshroom';
import { burstGlowshroom } from '../core/world';
import type { Stunnable } from '../core/stun';
import { createBat } from './entities/bat';
import { softPush } from '../core/softPush';
import { updateGoblinPack } from '../core/forestCast';

type Keys = Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
type PhysicsArc = Phaser.GameObjects.Arc & { body: Phaser.Physics.Arcade.Body };

const DEPTH = { player: 10 };

/** How a player projectile flies, stored on it: its passives (core/shotFlight), whom it hit, its age. */
interface Flight {
  mods: ShotMods;
  hits: HitLog;
  born: number;
  speed: number;
  boomerang?: Weapon['boomerang'];
  /** Blade waves fade out at this time. */
  expiresAt?: number;
}

const PLAIN_SHOT: ShotMods = { piercesEnemies: false, piercesTerrain: false, spectral: false, passesShields: false, bouncesLeft: 0 };

type At = (c: Cell) => { x: number; y: number };
type RoomSize = { width: number; height: number };
const ENEMY_FACTORIES: Record<EnemyType, (scene: Phaser.Scene, spawn: EnemySpawn, at: At, size: RoomSize) => Enemy> = {
  zombie: (scene, s, at) => createZombie(scene, at(s.cell).x, at(s.cell).y, !!s.champion, s.hp),
  turret: (scene, s, at) => createTurret(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  worm: (scene, s, at) => spawnWorm(scene, [s.cell, ...(s.tail ?? [])], at, s.champion ? championWorm(REGULAR_WORM) : REGULAR_WORM),
  wormBoss: (scene, s, at) => spawnWorm(scene, [s.cell, ...(s.tail ?? [])], at, BOSS_WORM, true),
  ironMaiden: (scene, s, at) => createIronMaidenBoss(scene, at(s.cell).x, at(s.cell).y),
  candleWitch: (scene, s, at, size) => createCandleWitch(scene, s.cell, s.anchors ?? [], at, size),
  goblin: (scene, s, at) => createGoblin(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  seedSpitter: (scene, s, at) => createSeedSpitter(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  ghoul: (scene, s, at) => createGhoul(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  crystalTurret: (scene, s, at) => createCrystalTurret(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  gargoyle: (scene, s, at) => createGargoyle(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  treantBoss: (scene, s, at) => createTreant(scene, at(s.cell).x, at(s.cell).y, s.cell),
  knight: (scene, s, at) => createKnight(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  wasp: (scene, s, at) => createWasp(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  boar: (scene, s, at) => createBoar(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  ghost: (scene, s, at) => createGhost(scene, at(s.cell).x, at(s.cell).y, s.cell, !!s.champion),
  bat: (scene, s, at) => createBat(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
};

type Shape = Phaser.GameObjects.Shape;
const PICKUP_SHAPES: Record<WorldPickup['type'], (scene: Phaser.Scene, x: number, y: number, p: WorldPickup) => Shape> = {
  passive: (s, x, y, p) =>
    s.add.star(x, y, 5, 8, 18, COLORS.passive[p.passive ?? 'homing']).setStrokeStyle(2, 0xffffff),
  heart: (s, x, y) => s.add.circle(x, y, 10, COLORS.heart),
  key: (s, x, y) => s.add.rectangle(x, y, 10, 22, COLORS.key),
  bomb: (s, x, y) => s.add.circle(x, y, 11, COLORS.bomb).setStrokeStyle(3, COLORS.bombFuse),
  chest: (s, x, y) => s.add.rectangle(x, y, 34, 26, COLORS.chest),
  lockedChest: (s, x, y) => s.add.rectangle(x, y, 34, 26, COLORS.lockedChest).setStrokeStyle(3, COLORS.key),
  openChest: (s, x, y) => s.add.rectangle(x, y, 34, 26, COLORS.openChest),
};

const FLOOR_COLOR: Record<RoomKind, (p: Palette) => number> = {
  start: (p) => p.floor,
  normal: (p) => p.floor,
  item: (p) => p.itemFloor,
  boss: (p) => p.bossFloor,
};

/** A non-floor tile drawn in its floor's look. */
function drawTile(scene: Phaser.Scene, x: number, y: number, look: TileLook): Shape {
  const size = TUNING.tile - look.inset;
  const shape = look.shape === 'round' ? scene.add.circle(x, y, size / 2, look.color) : scene.add.rectangle(x, y, size, size, look.color);
  if (look.stroke !== undefined) shape.setStrokeStyle(3, look.stroke);
  return shape;
}

/** How strongly decor placeholder marks show through: faint, so they read as mood, not as things. */
const DECOR_ALPHA = 0.55;

/**
 * A decor placeholder: a small mark in the kind's colour, nudged off the tile's centre by its
 * cell so a scatter of them doesn't sit on the grid. The art pass swaps these for sprites.
 */
function drawDecorMark(g: Phaser.GameObjects.Graphics, at: { x: number; y: number }, cell: Cell, kind: DecorKind) {
  const x = at.x + (((cell.x * 7 + cell.y * 3) % 5) - 2) * 4;
  const y = at.y + (((cell.x * 3 + cell.y * 5) % 5) - 2) * 4;
  g.fillStyle(kind.color, DECOR_ALPHA).lineStyle(2, kind.color, DECOR_ALPHA);
  switch (kind.mark) {
    case 'dot':
      g.fillCircle(x, y, 3).fillCircle(x + 7, y + 4, 2);
      break;
    case 'dash':
      g.lineBetween(x - 6, y + 2, x + 6, y - 2);
      break;
    case 'cross':
      g.lineBetween(x - 5, y - 5, x + 5, y + 5).lineBetween(x - 5, y + 5, x + 5, y - 5);
      break;
    case 'ring':
      g.strokeCircle(x, y, 7);
      break;
  }
}

/** How far each tile variant shifts its tile's shade, until the art pass gives variants sprites of their own. */
const VARIANT_SHADE = [-0.08, -0.03, 0.03, 0.08];

/** `color` lightened or darkened by the variant's shift. */
function shade(color: number, variant: number): number {
  const f = VARIANT_SHADE[variant] ?? 0;
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * (1 + f))));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** A faint line round each pit or pond region, along the edges it shares with anything else. */
function drawRegionRims(g: Phaser.GameObjects.Graphics, room: WorldRoom, color: number) {
  const t = TUNING.tile;
  g.lineStyle(2, color, 0.6);
  for (const region of room.layout.regions ?? []) {
    const inRegion = new Set(region.cells.map((c) => `${c.x},${c.y}`));
    for (const c of region.cells) {
      const { x, y } = tileCenter(room, c.x, c.y);
      const [l, r, u, d] = [x - t / 2, x + t / 2, y - t / 2, y + t / 2];
      if (!inRegion.has(`${c.x},${c.y - 1}`)) g.lineBetween(l, u, r, u);
      if (!inRegion.has(`${c.x},${c.y + 1}`)) g.lineBetween(l, d, r, d);
      if (!inRegion.has(`${c.x - 1},${c.y}`)) g.lineBetween(l, u, l, d);
      if (!inRegion.has(`${c.x + 1},${c.y}`)) g.lineBetween(r, u, r, d);
    }
  }
}

interface TrackedCrusher {
  roomId: string;
  /** The room layout's own crusher: sliding moves it for the rest of the run. */
  crusher: Crusher;
  shape: Shape;
  /** When it may wake again (Infinity while sliding). */
  readyAt: number;
}

let firstBoot = true;

export class GameScene extends Phaser.Scene {
  world!: World;
  /** Blocks movement and shots: room walls, obstacles and locked doors. */
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  /** Every room's drawn terrain, so rooms out of sight can be hidden from the renderer. */
  private roomObjects!: Map<string, Phaser.GameObjects.GameObject[]>;
  /** Blocks movement only; shots fly over. */
  private holes!: Phaser.Physics.Arcade.StaticGroup;
  /** Blocks movement like holes, and hurts whoever pushes into it. */
  private thorns!: Phaser.Physics.Arcade.StaticGroup;
  private player!: PhysicsArc;
  private move!: Keys;
  private aim!: Keys;
  /** Drawn rock and stone blocks, keyed `roomId|x,y`, so broken ones can be removed. */
  private terrain = new Map<string, Phaser.GameObjects.GameObject>();
  private shots!: Phaser.Physics.Arcade.Group;
  /** Every hittable enemy part (shots and the player overlap these). */
  private enemyParts!: Phaser.Physics.Arcade.Group;
  /** Physics-driven enemies that collide with terrain and each other. */
  private walkers!: Phaser.Physics.Arcade.Group;
  private enemyShots!: Phaser.Physics.Arcade.Group;
  private enemies: Enemy[] = [];
  /** Living champions (a split worm's pieces all count) and the pickup each drops once fully dead. */
  private champions = new Map<Enemy, ChampionDrop>();
  private doorLocks: Phaser.GameObjects.GameObject[] = [];
  private pickupGroup!: Phaser.Physics.Arcade.Group;
  private itemLockoutUntil = 0;
  private runOver = false;
  private nextShotAt = 0;
  private invincibleUntil = 0;
  private enemiesWakeAt = 0;
  /** Every room's crushers with their drawn blocks; `readyAt` is when one may wake again. */
  private crushers: TrackedCrusher[] = [];
  /** Flying enemies: stopped by walls and stone, but over holes and thorns, and through each other. */
  private flyers!: Phaser.Physics.Arcade.Group;
  /** The star drawn over each currently stunned enemy. */
  private stunMarks = new Map<Enemy, Shape>();
  /** Enemies the Poison passive is working on. */
  private poisoned = new Map<Enemy, Poison>();
  /** Rolls for the Freeze passive. */
  private hitRng = createRng(Math.floor(Math.random() * 2 ** 31));
  /** The Orbital passive's orbs. */
  private orbs!: Phaser.Physics.Arcade.Group;
  /** The player's current or last dash, and the enemies an upgraded one has already hurt. */
  private dash?: Dash;
  private dashHits = new Set<Enemy>();
  /** The player's share of the stun (a glowshroom cloud): no moving or shooting until it wears off. */
  private playerStun: Stunnable = {};
  private playerStunMark?: Shape;

  constructor() {
    super('game');
  }

  create(data: { seed?: number }) {
    const urlSeed = firstBoot ? Number(new URLSearchParams(location.search).get('seed') ?? NaN) : NaN;
    firstBoot = false;
    const seed = data.seed ?? (Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 2 ** 31));
    this.world = createWorld(seed);
    this.enemies = [];
    this.champions = new Map();
    this.doorLocks = [];
    this.nextShotAt = 0;
    this.invincibleUntil = 0;
    this.runOver = false;

    this.walls = this.physics.add.staticGroup();
    this.holes = this.physics.add.staticGroup();
    this.thorns = this.physics.add.staticGroup();
    this.terrain = new Map();
    this.crushers = [];
    this.stunMarks = new Map();
    this.poisoned = new Map();
    this.playerStun = {};
    this.playerStunMark = undefined;
    this.roomObjects = new Map();
    for (const room of this.world.rooms.values()) {
      const before = this.children.list.length;
      this.drawRoom(room);
      this.roomObjects.set(room.floorRoom.id, this.children.list.slice(before));
    }
    for (const room of this.world.rooms.values()) this.trackCrushers(room);

    const start = this.world.rooms.get(this.world.currentRoomId)!;
    const spawn = tileCenter(start, Math.floor(start.layout.width / 2), Math.floor(start.layout.height / 2));
    this.player = this.add.circle(spawn.x, spawn.y, TUNING.playerSize / 2, COLORS.player) as PhysicsArc;
    this.player.setDepth(DEPTH.player);
    this.physics.add.existing(this.player);
    // A round body too, so the ball slides round corners instead of snagging on them.
    this.player.body.setCircle(TUNING.playerSize / 2);
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.player, this.holes);
    this.physics.add.collider(this.player, this.thorns, () => this.hurtPlayer(TUNING.thorn.playerDamage));

    const kb = this.input.keyboard!;
    this.move = kb.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' }) as Keys;
    this.aim = kb.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }) as Keys;

    this.shots = this.physics.add.group();
    // Player shots pass through, bounce off or stop at terrain as their passives say (core/shotFlight).
    this.physics.add.collider(
      this.shots,
      this.walls,
      (shot, wall) => {
        if (!(shot as Phaser.GameObjects.GameObject).active) return; // already spent on another wall this frame
        shot.destroy();
        this.hitTerrain(wall as Phaser.GameObjects.Rectangle);
      },
      (shot, wall) => this.playerShotMeetsWall(shot as Phaser.GameObjects.Arc, wall as Phaser.GameObjects.Shape),
    );

    this.enemyParts = this.physics.add.group();
    this.walkers = this.physics.add.group();
    this.physics.add.collider(this.walkers, this.walls);
    this.physics.add.collider(this.walkers, this.holes);
    this.physics.add.collider(this.walkers, this.thorns, (part) => this.thornWalker(part as EnemySprite));
    // Rooted enemies (turrets and the like) stay solid; walkers only push each other softly (see updateEnemies).
    this.physics.add.collider(this.walkers, this.walkers, undefined, (a, b) =>
      (a as EnemySprite).body.immovable || (b as EnemySprite).body.immovable);
    this.flyers = this.physics.add.group();
    this.physics.add.collider(this.flyers, this.walls);
    this.physics.add.overlap(this.shots, this.enemyParts, (shot, part) => this.hitEnemy(shot, part as EnemySprite));
    this.physics.add.overlap(this.player, this.enemyParts, (_, part) => this.touchEnemy(part as EnemySprite));
    // An event rather than JustDown polling, so a tap shorter than a frame still counts.
    kb.addKey('E').on('down', () => this.dropBomb());

    this.enemyShots = this.physics.add.group();
    // Shots that ricochet are turned around before physics would stop them; the rest are spent.
    this.physics.add.collider(
      this.enemyShots,
      this.walls,
      (shot) => shot.destroy(),
      (shot, wall) => !this.ricochetEnemyShot(shot as Phaser.GameObjects.Arc, wall as Phaser.GameObjects.Shape),
    );
    this.physics.add.overlap(this.player, this.enemyShots, (_p, shot) => {
      shot.destroy();
      this.hurtPlayer();
    });

    // The Orbital passive's orbs: they soak up enemy shots and nick what they touch.
    this.orbs = this.physics.add.group();
    this.physics.add.overlap(this.orbs, this.enemyShots, (_o, shot) => shot.destroy());
    this.physics.add.overlap(this.orbs, this.enemyParts, (_o, part) => this.orbHits(part as EnemySprite));
    this.dash = undefined;
    for (const key of ['SPACE', 'SHIFT']) kb.addKey(key).on('down', () => this.requestDash());

    this.pickupGroup = this.physics.add.group();
    this.physics.add.overlap(this.player, this.pickupGroup, (_p, sprite) =>
      this.touchPickup(sprite as Phaser.GameObjects.GameObject),
    );
    this.itemLockoutUntil = 0;
    this.showPickups();

    // The playfield is one map cell; the label strip under it belongs to the HUD.
    this.cameras.main.setViewport(0, 0, CELL_PX_W, CELL_PX_H);
    this.cameras.main.setBackgroundColor(themeForFloor(start.floorIndex).palette.background);
    this.showRoomsAround(start);
    this.followInside(start);
    this.scene.launch('hud');
  }

  update(time: number, delta: number) {
    const dir = new Phaser.Math.Vector2(
      (this.move.right.isDown ? 1 : 0) - (this.move.left.isDown ? 1 : 0),
      (this.move.down.isDown ? 1 : 0) - (this.move.up.isDown ? 1 : 0),
    );
    if (dir.lengthSq() > 0) dir.normalize().scale(TUNING.playerSpeed);
    // The shared stun (core/stun) holds the player too: no moving, no shooting.
    const stunned = isStunned(this.playerStun, time);
    if (stunned) dir.set(0, 0);
    if (isDashing(this.dash, time)) {
      const speed = this.dash!.speedTilesPerSec * TUNING.tile;
      dir.set(this.dash!.dir.x * speed, this.dash!.dir.y * speed);
    }
    this.player.body.setVelocity(dir.x, dir.y);
    this.player.setAlpha(time < this.invincibleUntil && Math.floor(time / 80) % 2 === 0 ? 0.3 : 1);
    this.updatePlayerStunMark(time, stunned);
    this.circleOrbs(time);

    if (!stunned) this.tryShoot(time);
    this.steerHomingShots(time, delta);
    this.flyShots(time);
    this.dropShotsOutsideRoom();
    this.updateEnemies(time);
    this.updateCrushers(time);
    this.followPlayerAcrossRooms(time);
  }

  /** Keeps one orb per Orbital level circling the player, evenly spaced. */
  private circleOrbs(time: number) {
    const count = resolveWeapon(this.world.player.passives).orbitals;
    const { radius, size, degPerSec } = TUNING.orbital;
    // A copy: destroying an orb takes it out of the group's own list.
    const orbs = [...this.orbs.getChildren()] as Phaser.GameObjects.Arc[];
    while (orbs.length > count) orbs.pop()!.destroy();
    while (orbs.length < count) {
      const orb = this.add.circle(this.player.x, this.player.y, size, COLORS.passive.orbital).setStrokeStyle(2, 0xffffff).setDepth(DEPTH.player);
      this.orbs.add(orb);
      (orb.body as Phaser.Physics.Arcade.Body).setCircle(size);
      orbs.push(orb);
    }
    ring(count, (((time / 1000) * degPerSec) * Math.PI) / 180).forEach((a, i) => {
      (orbs[i].body as Phaser.Physics.Arcade.Body).reset(this.player.x + Math.cos(a) * radius, this.player.y + Math.sin(a) * radius);
    });
  }

  /** An orb touches an enemy part: a small hit, at most so often per part. */
  private orbHits(part: EnemySprite) {
    const now = this.time.now;
    if (!part.active || now < ((part.getData('orbSafeUntil') as number | undefined) ?? 0)) return;
    part.setData('orbSafeUntil', now + TUNING.orbital.hitEveryMs);
    this.damagePart(part, TUNING.orbital.damage);
  }

  /** Space or Shift: dash the way the player is moving, if they have the passive and it has cooled down. */
  private requestDash() {
    const rules = resolveWeapon(this.world.player.passives).dash;
    const now = this.time.now;
    if (!rules || this.runOver || isStunned(this.playerStun, now)) return;
    const moving = {
      x: (this.move.right.isDown ? 1 : 0) - (this.move.left.isDown ? 1 : 0),
      y: (this.move.down.isDown ? 1 : 0) - (this.move.up.isDown ? 1 : 0),
    };
    const before = this.dash;
    this.dash = tryDash(this.dash, now, moving, rules);
    if (!this.dash || this.dash === before) return;
    this.invincibleUntil = Math.max(this.invincibleUntil, this.dash.until);
    this.dashHits.clear();
    const trail = this.add.circle(this.player.x, this.player.y, TUNING.playerSize / 2, COLORS.passive.dash, 0.5);
    this.tweens.add({ targets: trail, alpha: 0, duration: 260, onComplete: () => trail.destroy() });
  }

  /** The player touches an enemy part: hurts them, unless they are dashing through it (an upgraded dash hurts it instead). */
  private touchEnemy(part: EnemySprite) {
    const enemy = this.enemies.find((e) => e.parts.includes(part));
    if (enemy?.harmless?.(part)) return;
    const dash = resolveWeapon(this.world.player.passives).dash;
    if (enemy && dash?.damage && isDashing(this.dash, this.time.now)) {
      if (!this.dashHits.has(enemy)) {
        this.dashHits.add(enemy);
        this.damagePart(part, dash.damage);
      }
      return;
    }
    this.hurtPlayer();
  }

  private get currentRoom(): WorldRoom {
    return this.world.rooms.get(this.world.currentRoomId)!;
  }

  private tryShoot(time: number) {
    const aim = DIRECTIONS.find((d) => this.aim[d].isDown);
    if (!aim || time < this.nextShotAt) return;
    const weapon = resolveWeapon(this.world.player.passives);
    this.nextShotAt = time + weapon.fireDelayMs;
    if (weapon.mode === 'sword') {
      this.swingSword(aim, weapon.damage, weapon.swordArcDeg);
      // With any shot passive, the swing also throws a short-lived blade wave that carries them.
      if (weapon.bladeWave) this.launch(aim, weapon, time, true);
      return;
    }
    this.launch(aim, weapon, time, false);
  }

  /** Fires the weapon's projectiles (shots, or the sword's blade waves), fanned out if there are several. */
  private launch(aim: Direction, weapon: Weapon, time: number, wave: boolean) {
    const v = launchVelocity(aim, this.player.body.velocity, TUNING.shotSpeed);
    const heading = Math.atan2(v.y, v.x);
    const speed = Math.hypot(v.x, v.y);
    const radius = wave ? TUNING.bladeWave.radius : TUNING.shotRadius;
    const color = wave ? COLORS.passive.sword : weapon.homing ? COLORS.passive.homing : COLORS.shot;
    const spread = ((weapon.shots - 1) * weapon.spreadDeg * Math.PI) / 180;
    for (const angle of fan(heading, weapon.shots, spread)) {
      const shot = this.add.circle(this.player.x, this.player.y, radius, color).setAlpha(weapon.spectral ? 0.6 : 1);
      if (weapon.piercesEnemies) shot.setStrokeStyle(2, COLORS.passive.pierce);
      const flight: Flight = {
        mods: {
          piercesEnemies: weapon.piercesEnemies,
          piercesTerrain: weapon.piercesTerrain,
          spectral: weapon.spectral,
          passesShields: weapon.passesShields,
          bouncesLeft: weapon.bounces,
        },
        hits: createHitLog(),
        born: time,
        speed,
        boomerang: weapon.boomerang,
        expiresAt: wave ? time + TUNING.bladeWave.lifeMs : undefined,
      };
      shot.setData({ damage: wave ? weapon.damage * TUNING.bladeWave.damageShare : weapon.damage, homing: weapon.homing, flight });
      this.shots.add(shot);
      (shot.body as Phaser.Physics.Arcade.Body).setCircle(radius).setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
  }

  /** Blade waves fade out, and boomerang shots turn back to the player once they have flown out, caught on arrival. */
  private flyShots(time: number) {
    for (const obj of this.shots.getChildren()) {
      const shot = obj as Phaser.GameObjects.Arc;
      const flight = shot.getData('flight') as Flight | undefined;
      if (!flight) continue;
      if (flight.expiresAt !== undefined && time >= flight.expiresAt) {
        shot.destroy();
        continue;
      }
      if (!flight.boomerang || boomerangLeg(time - flight.born, flight.boomerang.outMs) === 'out') continue;
      const dx = this.player.x - shot.x;
      const dy = this.player.y - shot.y;
      const dist = Math.hypot(dx, dy);
      if (dist < TUNING.playerSize) {
        shot.destroy();
        continue;
      }
      const speed = flight.speed * flight.boomerang.returnSpeedFactor;
      (shot.body as Phaser.Physics.Arcade.Body).setVelocity((dx / dist) * speed, (dy / dist) * speed);
    }
  }

  /** The leg of its flight a shot is on: boomerang shots come back after flying out. */
  private legOf(flight: Flight | undefined, time: number): Leg {
    return flight?.boomerang ? boomerangLeg(time - flight.born, flight.boomerang.outMs) : 'out';
  }

  /** Shots that fly out through a doorway vanish at the room's edge, like in Isaac. */
  private dropShotsOutsideRoom() {
    const b = roomBlock(this.currentRoom);
    for (const obj of [...this.shots.getChildren(), ...this.enemyShots.getChildren()]) {
      const s = obj as Phaser.GameObjects.Arc;
      if (s.x < b.x || s.y < b.y || s.x > b.x + b.w || s.y > b.y + b.h) s.destroy();
    }
  }

  /**
   * Draws a sword arc from `from` toward `aim` and returns a test for whether a target of the
   * given size is inside it.
   */
  private sweepArc(from: { x: number; y: number }, aim: Direction, color: number, arcDeg: number) {
    const { range, showMs } = TUNING.sword;
    const facing = Math.atan2(STEP[aim].y, STEP[aim].x);
    const half = Phaser.Math.DegToRad(arcDeg / 2);
    const arc = this.add.graphics().setDepth(DEPTH.player - 1);
    arc.fillStyle(color, 0.55).slice(from.x, from.y, range, facing - half, facing + half).fillPath();
    this.time.delayedCall(showMs, () => arc.destroy());
    return (target: { x: number; y: number; width: number }) => {
      const dist = Phaser.Math.Distance.Between(from.x, from.y, target.x, target.y);
      const angle = Math.atan2(target.y - from.y, target.x - from.x);
      return dist <= range + target.width / 2 && Math.abs(Phaser.Math.Angle.Wrap(angle - facing)) <= half;
    };
  }

  /**
   * A melee arc in the aimed direction; damages every enemy part inside it. A blow counts as
   * travelling from the player to the part, so a shield facing the player turns it aside.
   */
  private swingSword(aim: Direction, damage: number, arcDeg: number) {
    const inArc = this.sweepArc(this.player, aim, COLORS.passive.sword, arcDeg);
    for (const part of this.enemies.flatMap((e) => e.parts).filter(inArc)) {
      const heading = { x: part.x - this.player.x, y: part.y - this.player.y };
      if (this.shieldBlocks(part, heading)) this.clink(part.x - heading.x * 0.3, part.y - heading.y * 0.3);
      else this.strike(part, damage);
    }
  }

  /**
   * The player's own hit, a shot's or a swing's: hurts the part, then the on-hit passives
   * (core/onHit) poison and may freeze its enemy and send lightning on to others.
   */
  private strike(part: EnemySprite, damage: number) {
    const enemy = this.enemies.find((e) => e.parts.includes(part));
    const at = { x: part.x, y: part.y };
    this.damagePart(part, damage);
    if (!enemy) return;
    const weapon = resolveWeapon(this.world.player.passives);
    const time = this.time.now;
    const alive = this.enemies.includes(enemy);
    if (weapon.poison && alive) {
      this.poisoned.set(enemy, applyPoison(this.poisoned.get(enemy), time, weapon.poison));
    }
    if (weapon.freeze && alive && rollsFreeze(weapon.freeze.chance, this.hitRng)) stun(enemy, time, weapon.freeze.stunMs);
    if (weapon.chain) this.chainLightning(enemy, at, damage * weapon.chain.damageFactor, weapon.chain);
  }

  /** Lightning from the struck enemy on to the nearest others in turn, drawn as it goes. */
  private chainLightning(from: Enemy, at: { x: number; y: number }, damage: number, rules: NonNullable<Weapon['chain']>) {
    const room = this.currentRoom;
    const bodyOf = (e: Enemy) => e.parts.find((p) => p.active && p.visible);
    const placed = this.enemies.flatMap((e) => {
      const p = e === from ? at : bodyOf(e);
      return p ? [{ id: e, at: this.toTileUnits(room, p) }] : [];
    });
    if (!placed.some((p) => p.id === from)) placed.push({ id: from, at: this.toTileUnits(room, at) });
    const g = this.add.graphics().setDepth(DARK_DEPTH + 3).lineStyle(3, COLORS.passive.chain, 1);
    let prev = at;
    for (const target of chainTargets(from, placed, rules.jumps, rules.range)) {
      const part = bodyOf(target);
      if (!part) continue;
      // A jagged bolt: the straight line nudged sideways at its middle.
      const mid = { x: (prev.x + part.x) / 2 + (Math.random() - 0.5) * 20, y: (prev.y + part.y) / 2 + (Math.random() - 0.5) * 20 };
      g.lineBetween(prev.x, prev.y, mid.x, mid.y).lineBetween(mid.x, mid.y, part.x, part.y);
      prev = { x: part.x, y: part.y };
      this.damagePart(part, damage);
    }
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
  }

  /** Poison ticks away on every poisoned enemy, a green puff with each tick. */
  private tickPoison(time: number) {
    const rules = resolveWeapon(this.world.player.passives).poison;
    for (const [enemy, poison] of this.poisoned) {
      if (!this.enemies.includes(enemy) || !rules) {
        this.poisoned.delete(enemy);
        continue;
      }
      const tick = poisonTick(poison, time, rules);
      if (tick.poison) this.poisoned.set(enemy, tick.poison);
      else this.poisoned.delete(enemy);
      const part = enemy.parts.find((p) => p.active);
      if (tick.damage <= 0 || !part) continue;
      const puff = this.add.circle(part.x, part.y - 8, 7, COLORS.passive.poison, 0.8).setDepth(DEPTH.player + 1);
      this.tweens.add({ targets: puff, y: puff.y - 18, alpha: 0, duration: 380, onComplete: () => puff.destroy() });
      this.damagePart(part, tick.damage);
    }
  }

  /** Whether the part's enemy has a shield that turns aside a hit travelling along `heading`. */
  private shieldBlocks(part: EnemySprite, heading: { x: number; y: number }) {
    return !!this.enemies.find((e) => e.parts.includes(part))?.blocks?.(part, heading);
  }

  /** A blocked hit: a brief spark where it struck the shield. */
  private clink(x: number, y: number) {
    const spark = this.add.star(x, y, 4, 3, 11, COLORS.shieldClink).setDepth(DEPTH.player + 1);
    this.tweens.add({ targets: spark, alpha: 0, scale: 1.6, angle: 45, duration: TUNING.knight.clinkMs, onComplete: () => spark.destroy() });
  }

  /**
   * Homing shots turn at a limited rate, keeping their speed: the player's toward the nearest
   * enemy part with a clear line past anything that would stop the shot (so they don't curve
   * into rocks after hidden enemies), homing enemy shots toward the player.
   */
  private steerHomingShots(time: number, deltaMs: number) {
    const maxTurn = (resolveWeapon(this.world.player.passives).homingTurnRate * deltaMs) / 1000;
    const room = this.currentRoom;
    const parts = this.enemies.flatMap((e) => e.parts);
    // What blocks the view is what the shot couldn't fly through: a spectral shot homes through rock.
    const clearShot = (shot: Phaser.GameObjects.Arc, to: { x: number; y: number }) => {
      const flight = shot.getData('flight') as Flight | undefined;
      const blocks = flight ? homingBlocks(flight.mods) : blocksShots;
      return lineOfSight(room.layout.tiles, this.toTileUnits(room, shot), this.toTileUnits(room, to), blocks);
    };
    const steer = (group: Phaser.Physics.Arcade.Group, targetFor: (shot: Phaser.GameObjects.Arc) => { x: number; y: number } | undefined) => {
      for (const obj of group.getChildren()) {
        const shot = obj as Phaser.GameObjects.Arc;
        const target = shot.getData('homing') ? targetFor(shot) : undefined;
        if (!target) continue;
        const body = shot.body as Phaser.Physics.Arcade.Body;
        const heading = Math.atan2(body.velocity.y, body.velocity.x);
        const wanted = Math.atan2(target.y - shot.y, target.x - shot.x);
        body.velocity.setToPolar(Phaser.Math.Angle.RotateTo(heading, wanted, maxTurn), body.velocity.length());
      }
    };
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    steer(this.shots, (shot) => {
      // A boomerang on its way back is headed for the player, not for enemies.
      if (this.legOf(shot.getData('flight') as Flight | undefined, time) === 'back') return undefined;
      const visible = parts.filter((p) => clearShot(shot, p));
      return visible.length ? visible.reduce((best, p) => (dist(shot, p) < dist(shot, best) ? p : best)) : undefined;
    });
    steer(this.enemyShots, () => this.player);
  }

  private updateEnemies(time: number) {
    this.updateStunMarks(time);
    this.tickPoison(time);
    if (this.enemies.length === 0) return;
    if (time < this.enemiesWakeAt) {
      for (const e of this.enemies) for (const p of e.parts) p.body.setVelocity(0, 0);
      return;
    }
    const ctx = this.enemyContext(time);
    // Goblins decide together first (core/forestCast), then each moves as it was told.
    const goblins = this.enemies.filter((e) => e.pack);
    const decided = updateGoblinPack(goblins.map((e) => e.pack!.member(ctx)), {
      time,
      walkBetween: (a, b) => ctx.walkDistanceTo(b)[a.y]?.[a.x] ?? Infinity,
    });
    goblins.forEach((e, i) => e.pack!.follow(decided[i]));
    for (const e of this.enemies) {
      // The shared stun (core/stun): a stunned enemy of any kind stands still and does nothing.
      if (isStunned(e, time)) for (const p of e.parts) p.body.setVelocity(0, 0);
      else e.update(ctx);
    }
    this.pushWalkersApart();
  }

  /** Overlapping walkers are nudged apart on top of their own steering, so a crowd flows instead of jamming (core/softPush). */
  private pushWalkersApart() {
    const movers = (this.walkers.getChildren() as EnemySprite[]).filter((p) => p.active && !p.body.immovable);
    const pushes = softPush(movers.map((p) => ({ x: p.body.center.x, y: p.body.center.y, r: p.body.halfWidth })), TUNING.softPush);
    movers.forEach((p, i) => p.body.velocity.add(pushes[i]));
  }

  /** A spinning star over each stunned enemy's head; gone once the stun wears off or the enemy dies. */
  private updateStunMarks(time: number) {
    for (const [enemy, mark] of this.stunMarks) {
      if (this.enemies.includes(enemy) && isStunned(enemy, time) && enemy.parts[0]?.active) continue;
      mark.destroy();
      this.stunMarks.delete(enemy);
    }
    const { radius, spinDegPerSec } = TUNING.stunMark;
    for (const enemy of this.enemies) {
      const head = enemy.parts[0];
      if (!head?.active || !isStunned(enemy, time)) continue;
      let mark = this.stunMarks.get(enemy);
      if (!mark) {
        mark = this.add.star(head.x, head.y, 4, radius / 2, radius, COLORS.stunMark).setDepth(DEPTH.player + 1);
        this.stunMarks.set(enemy, mark);
      }
      mark.setPosition(head.x, head.y - head.displayHeight / 2 - radius).setAngle((time / 1000) * spinDegPerSec);
    }
  }

  /** The same spinning star over the player's head while they are stunned. */
  private updatePlayerStunMark(time: number, stunned: boolean) {
    if (!stunned) {
      this.playerStunMark?.destroy();
      this.playerStunMark = undefined;
      return;
    }
    const { radius, spinDegPerSec } = TUNING.stunMark;
    this.playerStunMark ??= this.add.star(0, 0, 4, radius / 2, radius, COLORS.stunMark).setDepth(DEPTH.player + 1);
    this.playerStunMark
      .setPosition(this.player.x, this.player.y - this.player.displayHeight / 2 - radius)
      .setAngle((time / 1000) * spinDegPerSec);
  }

  private enemyContext(time: number): EnemyContext {
    const room = this.currentRoom;
    const tileOf = (x: number, y: number) => tileAt(room, x, y);
    const playerTile = tileOf(this.player.x, this.player.y);
    const first = tileCenter(room, 0, 0);
    const last = tileCenter(room, room.layout.width - 1, room.layout.height - 1);
    // Walkers route around rooted enemies (turrets and the like) rather than pushing into them for good.
    const rooted = new Set(
      this.enemies
        .filter((e) => e.collidesWithTerrain)
        .flatMap((e) => e.parts)
        .filter((p) => p.active && p.body.immovable)
        .map((p) => {
          const c = tileOf(p.x, p.y);
          return `${c.x},${c.y}`;
        }),
    );
    const fields = new Map<string, number[][]>();
    const walkDistanceTo = (tile: Cell) => {
      const key = `${tile.x},${tile.y}`;
      let field = fields.get(key);
      if (!field) {
        field = distanceField(room.layout.tiles, tile, isWalkable, (c) => rooted.has(`${c.x},${c.y}`));
        fields.set(key, field);
      }
      return field;
    };
    return {
      time,
      player: this.player,
      roomCenter: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
      playerTile,
      walkDistance: walkDistanceTo(playerTile),
      walkDistanceTo,
      tileOf,
      tileCenter: (tile: Cell) => tileCenter(room, tile.x, tile.y),
      isWalkable: (cell: Cell) => {
        const tile = room.layout.tiles[cell.y]?.[cell.x];
        return tile !== undefined && isWalkable(tile);
      },
      canSeePlayer: (from) =>
        lineOfSight(room.layout.tiles, this.toTileUnits(room, from), this.toTileUnits(room, this.player), blocksSight),
      fireEnemyShot: (x, y, vx, vy, homing = false, bounces = 0) => {
        const color = bounces > 0 ? COLORS.crystalShot : COLORS.enemyShot;
        // Drawn over the Candle Witch's dark, so shots can always be dodged.
        const shot = this.add.circle(x, y, TUNING.enemyShotRadius, color).setData({ homing, bounces }).setDepth(DARK_DEPTH + 2);
        this.enemyShots.add(shot);
        (shot.body as Phaser.Physics.Arcade.Body).setCircle(TUNING.enemyShotRadius).setVelocity(vx, vy);
      },
      tiles: room.layout.tiles,
      hurtPlayer: () => this.hurtPlayer(),
      smashRock: (cell: Cell) => {
        if (smashRock(this.world, room.floorRoom.id, cell)) this.removeTerrain(room.floorRoom.id, cell);
      },
      doors: room.layout.doors,
      landSeedPod: (cell, tile) => this.landSeedPod(room, cell, tile),
    };
  }

  /** World position → fractional interior tile coordinates (2.5 = centre of tile 2). */
  private toTileUnits(room: WorldRoom, p: { x: number; y: number }) {
    const origin = tileCenter(room, 0, 0);
    return { x: (p.x - origin.x) / TUNING.tile + 0.5, y: (p.y - origin.y) / TUNING.tile + 0.5 };
  }

  /**
   * A player shot touches an enemy part. What happens is core/shotFlight's call: a shield facing
   * it turns it aside unless it passes shields, a piercing shot flies on (hurting each part once
   * per leg of its flight), and a boomerang hits harder on its way back if upgraded.
   */
  private hitEnemy(shotObject: unknown, part: EnemySprite) {
    const shot = shotObject as Phaser.GameObjects.Arc;
    if (!shot.active) return; // already spent on another part this frame
    const flight = shot.getData('flight') as Flight | undefined;
    const leg = this.legOf(flight, this.time.now);
    if (flight && !flight.hits.first(leg, part)) return;
    // Read before destroying: destroy() discards the object's data.
    const damage = (shot.getData('damage') as number) * (leg === 'back' ? flight!.boomerang!.returnDamageFactor : 1);
    const { velocity } = shot.body as Phaser.Physics.Arcade.Body;
    const shielded = this.shieldBlocks(part, { x: velocity.x, y: velocity.y });
    const { damages, continues } = meetEnemy(flight?.mods ?? PLAIN_SHOT, shielded);
    const at = { x: shot.x, y: shot.y };
    if (!continues) shot.destroy();
    if (damages) this.strike(part, damage);
    else this.clink(at.x, at.y);
  }

  /**
   * A player shot touches a wall piece: flies on through, bounces or is turned by crystal (both
   * handled here), or stops against it, which is what returning true tells physics to do.
   */
  private playerShotMeetsWall(shot: Phaser.GameObjects.Arc, wall: Phaser.GameObjects.Shape): boolean {
    if (!shot.active) return false;
    const flight = shot.getData('flight') as Flight | undefined;
    const { cell, tile } = this.wallPiece(wall);
    const outcome = meetTerrain(flight?.mods ?? PLAIN_SHOT, tile ?? 'wall');
    if (outcome === 'pass') return false;
    if (outcome === 'stop') return true;
    const pos = this.toTileUnits(this.currentRoom, shot);
    const body = shot.body as Phaser.Physics.Arcade.Body;
    const { x: vx, y: vy } = body.velocity;
    // Already heading away: it just bounced off a neighbouring piece.
    if ((cell.x + 0.5 - pos.x) * vx + (cell.y + 0.5 - pos.y) * vy <= 0) return false;
    const out = reflectOff({ ...pos, vx, vy }, cell);
    body.setVelocity(out.vx, out.vy);
    if (outcome === 'bounce' && flight) flight.mods.bouncesLeft--;
    return false;
  }

  /** The room cell a wall piece stands on, and its tile; no tile for the room's own walls and door locks. */
  private wallPiece(wall: Phaser.GameObjects.Shape): { cell: Cell; tile?: Tile } {
    const room = this.currentRoom;
    const roomId = wall.getData('roomId') as string | undefined;
    const tileCell = wall.getData('tile') as Cell | undefined;
    const centre = this.toTileUnits(room, wall);
    const cell = tileCell && roomId === room.floorRoom.id ? tileCell : { x: Math.floor(centre.x), y: Math.floor(centre.y) };
    const tile = tileCell && roomId ? this.world.rooms.get(roomId)?.layout.tiles[tileCell.y]?.[tileCell.x] : undefined;
    return { cell, tile };
  }

  /** A player shot hit a wall piece; rocks crack and eventually break open. */
  private hitTerrain(wall: Phaser.GameObjects.Rectangle) {
    const roomId = wall.getData('roomId') as string | undefined;
    if (!roomId || !wall.active) return;
    const cell = wall.getData('tile') as Cell;
    if (burstGlowshroom(this.world, roomId, cell)) {
      this.removeTerrain(roomId, cell);
      this.releaseStunCloud(roomId, cell);
      return;
    }
    const result = hitTile(this.world, roomId, cell);
    if (result === 'broken') this.removeTerrain(roomId, cell);
    else if (result === 'damaged') wall.setAlpha(wall.alpha - 0.25);
  }

  /**
   * A burst glowshroom's cloud: stuns every enemy (by its nearest part) and the player within
   * reach of `cell` (core/glowshroom), if it burst in the room they're in.
   */
  private releaseStunCloud(roomId: string, cell: Cell) {
    const room = this.world.rooms.get(roomId)!;
    const c = tileCenter(room, cell.x, cell.y);
    const cloud = this.add.circle(c.x, c.y, GLOWSHROOM_RADIUS * TUNING.tile, COLORS.glowCloud, 0.45).setDepth(DEPTH.player + 1);
    cloud.setScale(0.3);
    this.tweens.add({ targets: cloud, scale: 1, alpha: 0, duration: TUNING.glowCloud.showMs, ease: 'Quad.easeOut', onComplete: () => cloud.destroy() });
    if (roomId !== this.world.currentRoomId) return;
    const centre = { x: cell.x + 0.5, y: cell.y + 0.5 };
    const nearest = (e: Enemy) =>
      e.parts
        .filter((p) => p.active)
        .map((p) => this.toTileUnits(room, p))
        .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];
    const targets: BurstTarget<Stunnable>[] = [{ target: this.playerStun, at: this.toTileUnits(room, this.player) }];
    for (const e of this.enemies) {
      const at = nearest(e);
      if (at) targets.push({ target: e, at });
    }
    stunBurst(cell, targets, this.time.now);
  }

  /**
   * An enemy shot touches a wall piece: bounces it (core/ricochet) and returns true, or returns
   * false to let it be spent. Room walls and door locks count as stone. A shot already heading
   * away from the piece (it just bounced off a neighbouring piece) is left alone.
   */
  private ricochetEnemyShot(shot: Phaser.GameObjects.Arc, wall: Phaser.GameObjects.Shape): boolean {
    if (!shot.active) return true;
    const pos = this.toTileUnits(this.currentRoom, shot);
    const piece = this.wallPiece(wall);
    const { cell } = piece;
    const tile: Tile = piece.tile ?? 'obstacle';
    const body = shot.body as Phaser.Physics.Arcade.Body;
    const { x: vx, y: vy } = body.velocity;
    const heading = (cell.x + 0.5 - pos.x) * vx + (cell.y + 0.5 - pos.y) * vy;
    if (heading <= 0) return true;
    const out = ricochet({ ...pos, vx, vy, bouncesLeft: (shot.getData('bounces') as number | undefined) ?? 0 }, tile, cell);
    if (!out) return false;
    body.setVelocity(out.vx, out.vy);
    shot.setData('bounces', out.bouncesLeft);
    return true;
  }

  private removeTerrain(roomId: string, cell: Cell) {
    const key = `${roomId}|${cell.x},${cell.y}`;
    this.terrain.get(key)?.destroy();
    this.terrain.delete(key);
  }

  /** Drops a lit bomb at the player's feet, if they have one. */
  private dropBomb() {
    if (this.runOver || !placeBomb(this.world)) return;
    const roomId = this.world.currentRoomId;
    const at = { x: this.player.x, y: this.player.y };
    const bomb = this.add.circle(at.x, at.y, TUNING.bomb.radius, COLORS.bomb).setStrokeStyle(3, COLORS.bombFuse);
    this.tweens.add({ targets: bomb, scale: 1.2, duration: 150, yoyo: true, repeat: -1 });
    this.time.delayedCall(TUNING.bomb.fuseMs, () => {
      bomb.destroy();
      if (!this.runOver) this.explode(roomId, at);
    });
  }

  /**
   * Blows away rock and stone around the bomb (for good, via the world) and hurts every enemy
   * part and the player caught in the blast, if the bomb went off in the room they're in.
   */
  private explode(roomId: string, at: { x: number; y: number }) {
    const room = this.world.rooms.get(roomId)!;
    for (const cell of detonateBomb(this.world, roomId, tileAt(room, at.x, at.y))) this.removeTerrain(roomId, cell);
    const reach = BOMB_RADIUS * TUNING.tile;
    const flash = this.add.circle(at.x, at.y, reach, COLORS.blast, 0.6).setDepth(DEPTH.player + 1);
    this.tweens.add({ targets: flash, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
    if (roomId !== this.world.currentRoomId) return;
    const caught = (o: { x: number; y: number; width: number }) =>
      Phaser.Math.Distance.Between(at.x, at.y, o.x, o.y) <= reach + o.width / 2;
    if (caught(this.player)) this.hurtPlayer(TUNING.bomb.playerDamage);
    for (const part of this.enemies.flatMap((e) => e.parts).filter(caught)) this.damagePart(part, TUNING.bomb.enemyDamage);
  }

  private damagePart(part: EnemySprite, damage: number) {
    const enemy = this.enemies.find((e) => e.parts.includes(part));
    if (!enemy) return;
    const where = { x: part.x, y: part.y };
    const replacements = enemy.hit(part, damage);
    this.enemies = this.enemies.flatMap((e) => (e === enemy ? replacements : [e]));
    const drop = this.champions.get(enemy);
    if (drop) {
      this.champions.delete(enemy);
      for (const r of replacements) this.champions.set(r, drop);
      if (![...this.champions.values()].includes(drop)) {
        dropChampionLoot(this.world, this.world.currentRoomId, drop, tileAt(this.currentRoom, where.x, where.y));
        this.showPickups();
      }
    }
    if (this.enemies.length === 0) this.clearRoom();
  }

  private addEnemy(enemy: Enemy) {
    for (const part of enemy.parts) {
      // Joining a physics group re-applies its body defaults, resetting immovable to false.
      const immovable = part.body.immovable;
      this.enemyParts.add(part);
      if (enemy.collidesWithTerrain) this.walkers.add(part);
      else if (enemy.flies) this.flyers.add(part);
      part.body.setImmovable(immovable);
    }
    this.enemies.push(enemy);
  }

  /** Takes `halves` half-hearts, unless the player is still flashing from the last hit. */
  private hurtPlayer(halves = 1) {
    if (this.time.now < this.invincibleUntil) return;
    this.invincibleUntil = this.time.now + TUNING.invincibleMs;
    for (let i = 0; i < halves; i++) {
      if (damagePlayer(this.world)) {
        this.endRun(false);
        return;
      }
    }
  }

  /** A walker pushed into thorns; each part has its own brief invincibility so it isn't shredded in a frame. */
  private thornWalker(part: EnemySprite) {
    if (!part.active || this.time.now < ((part.getData('thornSafeUntil') as number | undefined) ?? 0)) return;
    part.setData('thornSafeUntil', this.time.now + TUNING.thorn.walkerInvincibleMs);
    this.damagePart(part, TUNING.thorn.walkerDamage);
  }

  /** Ends the run once; if death and the final boss's death land in the same frame, the first sticks. */
  private endRun(won: boolean) {
    if (this.runOver) return;
    this.runOver = true;
    this.scene.stop('hud');
    this.scene.start('end', { seed: this.world.seed, won });
  }

  private followPlayerAcrossRooms(time: number) {
    const cell = mapCellAt(this.player.x, this.player.y);
    const room = roomAtCell(this.world, cell.x, cell.y);
    if (!room || room.floorRoom.id === this.world.currentRoomId) return;
    this.enterRoom(room, time);
  }

  private enterRoom(room: WorldRoom, time: number) {
    enterRoom(this.world, room.floorRoom.id);
    for (const shot of [...this.shots.getChildren(), ...this.enemyShots.getChildren()]) shot.destroy();

    // Step the player just inside the door they came through, clear of the doorway.
    const entry = room.layout.doors
      .map((d) => ({ d, c: tileCenter(room, d.cell.x, d.cell.y) }))
      .sort((a, b) => Phaser.Math.Distance.Between(a.c.x, a.c.y, this.player.x, this.player.y) -
        Phaser.Math.Distance.Between(b.c.x, b.c.y, this.player.x, this.player.y))[0];
    if (entry) this.player.body.reset(entry.c.x, entry.c.y);

    this.showRoomsAround(room);
    this.slideCameraTo(room);
    this.cameras.main.setBackgroundColor(themeForFloor(room.floorIndex).palette.background);

    if (!this.world.cleared.has(room.floorRoom.id)) {
      this.spawnEnemies(room);
      this.enemiesWakeAt = time + TUNING.enemyWakeMs;
      this.lockDoors(room);
    }
    this.showPickups();
  }

  /** Redraws the current room's pickups: loot placed in plain sight, and the rest once the room is cleared. */
  private showPickups() {
    this.pickupGroup.clear(true, true);
    const room = this.currentRoom;
    for (const p of shownPickups(this.world, room.floorRoom.id)) {
      const c = tileCenter(room, p.cell.x, p.cell.y);
      const sprite = PICKUP_SHAPES[p.type](this, c.x, c.y, p).setData('pickupId', p.id);
      this.pickupGroup.add(sprite);
      (sprite.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    }
  }

  private touchPickup(sprite: Phaser.GameObjects.GameObject) {
    const id = sprite.getData('pickupId') as number;
    const pickup = this.world.pickups.get(this.world.currentRoomId)?.find((p) => p.id === id);
    if (!pickup) return;
    // Chests stay touchable; everything that can drop out of one is locked out briefly after opening.
    const isItem = pickup.type === 'heart' || pickup.type === 'key' || pickup.type === 'bomb' || pickup.type === 'passive';
    if (isItem && this.time.now < this.itemLockoutUntil) return;
    const result = touchPickup(this.world, this.world.currentRoomId, id);
    if (result === 'none') return;
    if (result === 'opened') this.itemLockoutUntil = this.time.now + TUNING.chestLockoutMs;
    this.showPickups();
  }

  private spawnEnemies(room: WorldRoom) {
    const at = (c: Cell) => tileCenter(room, c.x, c.y);
    for (const spawn of room.layout.enemies) {
      const enemy = ENEMY_FACTORIES[spawn.type](this, spawn, at, room.layout);
      if (spawn.champion) this.champions.set(enemy, spawn.champion.drop);
      this.addEnemy(enemy);
    }
  }

  private lockDoors(room: WorldRoom) {
    const t = TUNING.tile;
    for (const door of room.layout.doors) {
      const w = doorCorridor(room, door)[0];
      const c = tileCenter(room, w.x, w.y);
      const lock = this.add.rectangle(c.x, c.y, t, t, COLORS.lockedDoor);
      this.walls.add(lock);
      this.doorLocks.push(lock);
    }
  }

  private clearRoom() {
    this.world.cleared.add(this.world.currentRoomId);
    for (const lock of this.doorLocks) lock.destroy();
    this.doorLocks = [];
    this.showPickups();
    if (this.currentRoom.floorRoom.kind !== 'boss') return;
    // Every boss kill raises one of the player's passives to level 2.
    const upgraded = upgradeAfterBoss(this.world, this.world.currentRoomId);
    if (upgraded) this.announce(`${PASSIVE_NAMES[upgraded]} upgraded!`, COLORS.passive[upgraded]);
    // Earlier bosses just unlock their doors, exit included; the last one ends the run.
    if (isFinalFloor(this.currentRoom.floorIndex)) this.endRun(true);
  }

  /** A line of text that rises over the player and fades. */
  private announce(message: string, color: number) {
    const text = this.add
      .text(this.player.x, this.player.y - 36, message, { fontFamily: 'monospace', fontSize: '16px', color: `#${color.toString(16).padStart(6, '0')}` })
      .setOrigin(0.5)
      .setStroke('#000000', 4)
      .setDepth(DARK_DEPTH + 3);
    this.tweens.add({ targets: text, y: text.y - 40, alpha: 0, delay: 900, duration: 900, onComplete: () => text.destroy() });
  }

  /**
   * Renders only the room and its neighbours (the ones the camera slides through or peeks into)
   * and hides every other room's terrain. The whole run is drawn up front, and Phaser draws
   * everything visible every frame, on screen or not.
   */
  private showRoomsAround(room: WorldRoom) {
    const shown = new Set([room.floorRoom.id, ...room.neighbors]);
    for (const [id, objects] of this.roomObjects) {
      const visible = shown.has(id);
      for (const o of objects) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(visible);
    }
  }

  /** Camera tracks the player, clamped to the room: fixed in 1x1 rooms, scrolling in wide, tall and boss rooms. */
  private followInside(room: WorldRoom) {
    const b = roomBlock(room);
    this.cameras.main.setBounds(b.x, b.y, b.w, b.h).startFollow(this.player, true);
  }

  private slideCameraTo(room: WorldRoom) {
    const cam = this.cameras.main;
    const b = roomBlock(room);
    const target = {
      x: Phaser.Math.Clamp(this.player.x, b.x + cam.width / 2, b.x + b.w - cam.width / 2),
      y: Phaser.Math.Clamp(this.player.y, b.y + cam.height / 2, b.y + b.h - cam.height / 2),
    };
    cam.stopFollow().removeBounds();
    cam.pan(target.x, target.y, TUNING.roomSlideMs, 'Sine.easeInOut', true, (_c: unknown, progress: number) => {
      if (progress === 1 && this.world.currentRoomId === room.floorRoom.id) this.followInside(room);
    });
  }

  private drawRoom(room: WorldRoom) {
    const t = TUNING.tile;
    const b = roomBlock(room);
    const { width, height } = room.layout;
    const corridors = new Set(room.layout.doors.flatMap((d) => doorCorridor(room, d)).map((c) => `${c.x},${c.y}`));
    const { palette } = themeForFloor(room.floorIndex);
    const looks = roomLooks(room.floorIndex, room.layout.theme ?? '');

    this.add.rectangle(b.x, b.y, b.w, b.h, palette.wall).setOrigin(0);
    const floor = tileCenter(room, 0, 0);
    this.add
      .rectangle(floor.x - t / 2, floor.y - t / 2, width * t, height * t, FLOOR_COLOR[room.floorRoom.kind](palette))
      .setOrigin(0);
    const dressing = this.add.graphics();
    const variants = room.layout.variants;
    // Each floor tile tinted a touch lighter or darker by its variant.
    room.layout.tiles.forEach((row, ty) =>
      row.forEach((tile, tx) => {
        const v = variants?.[ty]?.[tx];
        if (tile !== 'floor' || v === undefined) return;
        const c = tileCenter(room, tx, ty);
        dressing.fillStyle(VARIANT_SHADE[v] < 0 ? 0x000000 : 0xffffff, Math.abs(VARIANT_SHADE[v]) * 0.35);
        dressing.fillRect(c.x - t / 2, c.y - t / 2, t, t);
      }),
    );
    const theme = roomThemeById(room.layout.theme ?? '');
    for (const d of room.layout.decor ?? []) {
      const kind = theme?.decor.find((k) => k.id === d.kind);
      if (kind) drawDecorMark(dressing, tileCenter(room, d.cell.x, d.cell.y), d.cell, kind);
    }

    for (let ty = -b.pad.y; ty < b.tilesH - b.pad.y; ty++) {
      for (let tx = -b.pad.x; tx < b.tilesW - b.pad.x; tx++) {
        if (tx >= 0 && ty >= 0 && tx < width && ty < height) continue;
        const c = tileCenter(room, tx, ty);
        if (corridors.has(`${tx},${ty}`)) this.add.rectangle(c.x, c.y, t, t, palette.door);
        else this.walls.add(this.add.rectangle(c.x, c.y, t, t, palette.wall));
      }
    }

    room.layout.tiles.forEach((row, ty) =>
      row.forEach((tile: Tile, tx) => {
        if (isWalkable(tile)) return;
        const c = tileCenter(room, tx, ty);
        // An L room's missing cell: plain room wall, not terrain that can crack.
        if (tile === 'wall') {
          this.walls.add(this.add.rectangle(c.x, c.y, t, t, palette.wall));
          return;
        }
        const look = looks[tile as Exclude<Tile, 'floor' | 'wall'>];
        const variant = variants?.[ty]?.[tx];
        const shape = drawTile(this, c.x, c.y, variant === undefined ? look : { ...look, color: shade(look.color, variant) });
        // Shot-blocking tiles are walls to physics; the rest (holes) only stop walking.
        if (!blocksShots(tile)) {
          (hurtsOnTouch(tile) ? this.thorns : this.holes).add(shape);
          return;
        }
        shape.setData({ roomId: room.floorRoom.id, tile: { x: tx, y: ty } });
        this.walls.add(shape);
        this.terrain.set(`${room.floorRoom.id}|${tx},${ty}`, shape);
      }),
    );
    // Over the tiles, so each pit or pond reads as one shape.
    drawRegionRims(this.add.graphics(), room, looks.hole.stroke ?? palette.accent);
  }

  /** Takes a room's drawn crusher blocks out of the breakable terrain and tracks them for sliding. */
  private trackCrushers(room: WorldRoom) {
    const roomId = room.floorRoom.id;
    for (const crusher of room.layout.crushers ?? []) {
      const key = `${roomId}|${crusher.cell.x},${crusher.cell.y}`;
      const shape = this.terrain.get(key) as Shape | undefined;
      if (!shape) continue;
      this.terrain.delete(key);
      // Shots still stop on it, but it has no tile of its own to crack.
      shape.setData('roomId', undefined);
      this.crushers.push({ roomId, crusher, shape, readyAt: 0 });
    }
  }

  /** Wakes the current room's crushers that see the player along their axis. */
  private updateCrushers(time: number) {
    if (this.runOver) return;
    const room = this.currentRoom;
    const player = tileAt(room, this.player.x, this.player.y);
    for (const c of this.crushers) {
      if (c.roomId !== room.floorRoom.id || time < c.readyAt) continue;
      const dir = crusherWakes(room.layout.tiles, c.crusher, player);
      if (!dir) continue;
      const { swept, stop } = slideCrusher(room.layout.tiles, c.crusher.cell, dir);
      if (!swept.length) continue;
      // The world's tiles change at once, so walkers path around where it will settle.
      settleCrusher(room.layout.tiles, c.crusher, stop);
      c.readyAt = Infinity;
      this.animateCrusher(c, tileCenter(room, stop.x, stop.y), swept.length);
    }
  }

  /** Shudders, then slams the block to `to`, crushing the player and every enemy part it passes over. */
  private animateCrusher(c: TrackedCrusher,to: { x: number; y: number }, tiles: number) {
    const { windupMs, msPerTile, cooldownMs, enemyDamage, playerDamage } = TUNING.crusher;
    const body = c.shape.body as Phaser.Physics.Arcade.StaticBody;
    const crushed = new Set<object>();
    const under = (o: { x: number; y: number; width: number; height: number }) =>
      Math.abs(o.x - c.shape.x) < (TUNING.tile + o.width) / 2 - 4 && Math.abs(o.y - c.shape.y) < (TUNING.tile + o.height) / 2 - 4;
    this.tweens.add({ targets: c.shape, scale: 1.1, duration: windupMs / 2, yoyo: true });
    this.tweens.add({
      targets: c.shape,
      x: to.x,
      y: to.y,
      delay: windupMs,
      duration: tiles * msPerTile,
      ease: 'Quad.easeIn',
      onStart: () => {
        body.enable = false;
      },
      onUpdate: () => {
        if (this.runOver || this.world.currentRoomId !== c.roomId) return;
        if (!crushed.has(this.player) && under(this.player)) {
          crushed.add(this.player);
          this.hurtPlayer(playerDamage);
        }
        for (const part of this.enemies.flatMap((e) => e.parts)) {
          if (crushed.has(part) || !part.active || !under(part)) continue;
          crushed.add(part);
          this.damagePart(part, enemyDamage);
        }
      },
      onComplete: () => {
        body.updateFromGameObject();
        body.enable = true;
        c.readyAt = this.time.now + cooldownMs;
      },
    });
  }

  /** A Treant seed pod lands: it bursts on a player standing there, otherwise sprouts rock or thorn for good. */
  private landSeedPod(room: WorldRoom, cell: Cell, tile: 'rock' | 'thorn'): boolean {
    const roomId = room.floorRoom.id;
    const c = tileCenter(room, cell.x, cell.y);
    const reach = (TUNING.tile + TUNING.playerSize) / 2;
    if (Math.abs(this.player.x - c.x) < reach && Math.abs(this.player.y - c.y) < reach) {
      this.hurtPlayer();
      return false;
    }
    if (!sproutTile(this.world, roomId, cell, tile)) return false;
    const shape = drawTile(this, c.x, c.y, roomLooks(room.floorIndex, room.layout.theme ?? '')[tile]);
    if (!blocksShots(tile)) {
      this.thorns.add(shape);
    } else {
      shape.setData({ roomId, tile: cell });
      this.walls.add(shape);
      this.terrain.set(`${roomId}|${cell.x},${cell.y}`, shape);
    }
    this.roomObjects.get(roomId)?.push(shape);
    shape.setScale(0.2);
    this.tweens.add({ targets: shape, scale: 1, duration: 180, ease: 'Back.easeOut' });
    return true;
  }
}
