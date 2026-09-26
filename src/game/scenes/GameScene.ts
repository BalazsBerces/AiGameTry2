import Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction, type RoomKind } from '../../core/map/floorGenerator';
import { distanceField, lineOfSight } from '../../core/map/grid';
import type { LootDrop, EnemySpawn, EnemyType, Tile } from '../../core/rooms/roomGenerator';
import { themeForFloor, type Palette, type TileLook } from '../../core/map/themes';
import { roomLooks, roomThemeById, type DecorKind } from '../../core/rooms/roomThemes';
import { blocksShots, blocksSight, hurtsOnTouch, isWalkable } from '../../core/map/tiles';
import { crusherWakes, settleCrusher, slideCrusher, type Crusher } from '../../core/obstacles/crusher';
import { launchVelocity, resolveWeapon, type Weapon } from '../../core/player/weaponModel';
import { fan, ring } from '../../core/bosses/bulletPatterns';
import { isDashing, tryDash, type Dash } from '../../core/player/dash';
import { stepMomentum, type Momentum } from '../../core/player/momentum';
import type { BossBarSnapshot } from '../../core/bosses/bossBar';
import {
  boomerangLeg,
  createHitLog,
  homingBlocks,
  meetEnemy,
  meetTerrain,
  type HitLog,
  type Leg,
  type ShotMods,
} from '../../core/player/shotFlight';
import {
  BOMB_RADIUS,
  BOSS_DROPS,
  createWorld,
  damagePlayer,
  detonateBomb,
  dropLoot,
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
} from '../../core/map/world';
import { COLORS, PASSIVE_NAMES, TUNING } from '../config';
import type { Enemy, EnemyContext, EnemySprite } from '../entities/enemy';
import { createIronMaidenBoss } from '../entities/bosses/ironMaiden';
import { createCandleWitch, DARK_DEPTH } from '../entities/bosses/candleWitch';
import { createTurret } from '../entities/turret';
import { BOSS_WORM, championWorm, REGULAR_WORM, spawnWorm } from '../entities/bosses/worm';
import { createZombie } from '../entities/zombie';
import { createGhoul } from '../entities/ghoul';
import { createCrystalTurret } from '../entities/crystalTurret';
import { reflectOff, ricochet } from '../../core/player/ricochet';
import { createGargoyle } from '../entities/gargoyle';
import { createTreant } from '../entities/bosses/treant';
import { CELL_PX_H, CELL_PX_W, doorCorridor, mapCellAt, roomBlock, tileAt, tileCenter } from '../geometry';
import { createGoblin } from '../entities/goblin';
import { createSeedSpitter } from '../entities/seedSpitter';
import { createKnight } from '../entities/knight';
import { createWasp } from '../entities/wasp';
import { createSlime } from '../entities/slime';
import { createBoar } from '../entities/boar';
import { isStunned, stun } from '../../core/enemies/stun';
import { applyPoison, chainTargets, poisonTick, rollsFreeze, type Poison } from '../../core/player/onHit';
import { createRng } from '../../core/rng';
import { clearSprout, smashRock } from '../../core/map/world';
import { hurtboxMeetsBox, hurtboxMeetsCircle } from '../../core/player/hurtbox';
import { createGhost } from '../entities/ghost';
import { stunBurst, GLOWSHROOM_RADIUS, type BurstTarget } from '../../core/obstacles/glowshroom';
import { burstGlowshroom } from '../../core/map/world';
import type { Stunnable } from '../../core/enemies/stun';
import { createBat } from '../entities/bat';
import { softPush } from '../../core/enemies/softPush';
import { updateGoblinPack } from '../../core/enemies/forestCast';
import { createFalloff, createHitGate, type Falloff } from '../../core/player/multiHit';
import { PaperLayer, type PaperActor } from '../art/paperLayer';
import { LightLayer } from '../art/lightLayer';
import { DECOR_CANVAS, JOIN_LOOKS, TILE_CANVAS, type WallSide } from '../../core/art/terrain';
import { TILE_VARIANTS, decorKey, doorKey, floorKey, joinKey, tileKey, wallKey, type FloorKind } from '../../core/art/catalogue';
import { joinsBetween, neighbourMask } from '../../core/art/autotile';

type Keys = Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
type PhysicsArc = Phaser.GameObjects.Arc & { body: Phaser.Physics.Arcade.Body };

const DEPTH = { player: 10 };
/** The player's feet are this far below the centre of its round body. */
const PLAYER_FOOT = 9;

/** How a player projectile flies, stored on it: its passives (core/shotFlight), whom it hit, its age. */
interface Flight {
  mods: ShotMods;
  hits: HitLog;
  /** Each leg of its flight is one attack for the falloff on many-part bodies (core/multiHit). */
  falloff: Record<Leg, Falloff>;
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
  slime: (scene, s, at) => createSlime(scene, at(s.cell).x, at(s.cell).y, { tier: 'big', champion: !!s.champion }),
};

type Shape = Phaser.GameObjects.Shape;
const PICKUP_SHAPES: Record<WorldPickup['type'], (scene: Phaser.Scene, x: number, y: number, p: WorldPickup) => Shape> = {
  passive: (s, x, y, p) =>
    s.add.star(x, y, 5, 8, 18, COLORS.passive[p.passive ?? 'homing']).setStrokeStyle(2, 0xffffff),
  heart: (s, x, y) => s.add.circle(x, y, 10, COLORS.heart),
  heartContainer: (s, x, y) => {
    // The forest's gift: a heart-red orb with a gold-green rim and two leaves sprouting on top.
    const orb = s.add.circle(x, y, 13, COLORS.heart).setStrokeStyle(3, COLORS.heartContainerRim);
    const leaves = [-1, 1].map((side) =>
      s.add.ellipse(x + side * 6, y - 15, 13, 7, COLORS.heartContainerLeaf).setAngle(side * -30).setStrokeStyle(1, COLORS.heartContainerRim),
    );
    orb.once('destroy', () => leaves.forEach((l) => l.destroy()));
    return orb;
  },
  key: (s, x, y) => s.add.rectangle(x, y, 10, 22, COLORS.key),
  bomb: (s, x, y) => s.add.circle(x, y, 11, COLORS.bomb).setStrokeStyle(3, COLORS.bombFuse),
  chest: (s, x, y) => s.add.rectangle(x, y, 34, 26, COLORS.chest),
  lockedChest: (s, x, y) => s.add.rectangle(x, y, 34, 26, COLORS.lockedChest).setStrokeStyle(3, COLORS.key),
  openChest: (s, x, y) => s.add.rectangle(x, y, 34, 26, COLORS.openChest),
  // Upward arrowheads: a stat going up.
  damageUp: (s, x, y) => s.add.triangle(x, y, 0, 18, 10, 0, 20, 18, COLORS.damageUp).setStrokeStyle(2, 0xffffff),
  rateUp: (s, x, y) => s.add.triangle(x, y, 0, 18, 10, 0, 20, 18, COLORS.rateUp).setStrokeStyle(2, 0xffffff),
};

const FLOOR_COLOR: Record<RoomKind, (p: Palette) => number> = {
  start: (p) => p.floor,
  normal: (p) => p.floor,
  item: (p) => p.itemFloor,
  boss: (p) => p.bossFloor,
};

/** Enemies drawn in paper: how far below the centre of their body their feet are, and their frame rate if not the usual. */
const ENEMY_ART: Partial<Record<EnemyType, { footOffset: number; fps?: number }>> = {
  goblin: { footOffset: 7 },
  treantBoss: { footOffset: 30 },
  seedSpitter: { footOffset: 14 },
  boar: { footOffset: 8 },
  // Beating wings: twice the usual frame rate.
  wasp: { footOffset: 12, fps: 18 },
};

/** Which paper floor each kind of room gets. */
const FLOOR_KIND: Record<RoomKind, FloorKind> = { start: 'normal', normal: 'normal', item: 'item', boss: 'boss' };
/** A standing terrain piece's foot line (a tree's trunk base) lies this far below its tile's centre. */
const TERRAIN_FOOT = 14;

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
  /** Living enemies carrying loot (champions, bosses with a drop; a split worm's pieces all count) and the pickup each drops once fully dead. */
  private lootCarriers = new Map<Enemy, LootDrop>();
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
  /** Enemies the Poison passive is working on; a many-part body (the worm boss, split or whole) by its hit group. */
  private poisoned = new Map<object, Poison>();
  /** Rolls for the Freeze passive. */
  private hitRng = createRng(Math.floor(Math.random() * 2 ** 31));
  /** The Orbital passive's orbs, and how often they may hurt each part or body. */
  private orbs!: Phaser.Physics.Arcade.Group;
  private orbGate = createHitGate();
  /** The player's current or last dash, and the enemies (or many-part bodies, by hit group) an upgraded one has already hurt. */
  private dash?: Dash;
  private momentum?: Momentum;
  private dashHits = new Set<object>();
  /** The health bar of the boss fought in this room (the worm boss's), for the HUD; kept after it dies so the bar can crumble. */
  bossBar?: BossBarSnapshot;
  /** The player's share of the stun (a glowshroom cloud): no moving or shooting until it wears off. */
  private playerStun: Stunnable = {};
  private playerStunMark?: Shape;
  /** Paper sprites standing in for shapes that have art; the rest draw themselves. */
  private paper!: PaperLayer;
  private playerArt?: PaperActor;
  /** Every room is dark but for its lights. */
  private light!: LightLayer;
  /** The canopy and vine joins touching each terrain cell (`roomId|x,y`), gone once the cell's tile is. */
  private joinArt = new Map<string, Phaser.GameObjects.Image[]>();

  constructor() {
    super('game');
  }

  create(data: { seed?: number }) {
    const params = new URLSearchParams(firstBoot ? location.search : '');
    const urlSeed = Number(params.get('seed') ?? NaN);
    // Playtesting: `?boss` (or `?boss=2`, `?boss=3`) starts at that floor's boss room door.
    const urlBoss = params.has('boss') ? Number(params.get('boss') || 1) : undefined;
    // Playtesting: `?room=slimePit` (an archetype, layout or encounter id) starts at the door of
    // the first such room, on the given seed or the first seed that has one.
    const urlRoom = params.get('room') ?? undefined;
    firstBoot = false;
    const isUrlRoom = (r: WorldRoom) => [r.layout.archetype, r.layout.layout, r.layout.encounter].includes(urlRoom);
    const roomSeed = urlRoom && !Number.isFinite(urlSeed)
      ? Array.from({ length: 300 }, (_, s) => s).find((s) => [...createWorld(s).rooms.values()].some(isUrlRoom))
      : undefined;
    const seed = data.seed ?? roomSeed ?? (Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 2 ** 31));
    this.world = createWorld(seed);
    this.enemies = [];
    this.lootCarriers = new Map();
    this.doorLocks = [];
    this.nextShotAt = 0;
    this.invincibleUntil = 0;
    this.runOver = false;
    // The scene object outlives a run: a boss bar left from the last one would show on.
    this.bossBar = undefined;

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
    this.paper = new PaperLayer(this);
    this.joinArt = new Map();
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
    this.playerArt = this.paper.actor(this.player, 'player', { footOffset: PLAYER_FOOT });
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
    this.physics.add.overlap(
      this.player,
      this.enemyParts,
      (_, part) => this.touchEnemy(part as EnemySprite),
      (_, part) => this.inHurtbox(part as EnemySprite),
    );
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
    this.physics.add.overlap(
      this.player,
      this.enemyShots,
      (_p, shot) => {
        shot.destroy();
        this.hurtPlayer();
      },
      (_p, shot) => this.inHurtbox(shot as Phaser.GameObjects.Arc),
    );

    // The Orbital passive's orbs: they soak up enemy shots and nick what they touch.
    this.orbs = this.physics.add.group();
    this.orbGate = createHitGate();
    this.physics.add.overlap(this.orbs, this.enemyShots, (_o, shot) => shot.destroy());
    this.physics.add.overlap(this.orbs, this.enemyParts, (_o, part) => this.orbHits(part as EnemySprite));
    this.dash = undefined;
    this.momentum = undefined;
    for (const key of ['SPACE', 'SHIFT']) kb.addKey(key).on('down', () => this.requestDash());

    this.pickupGroup = this.physics.add.group();
    this.physics.add.overlap(this.player, this.pickupGroup, (_p, sprite) =>
      this.touchPickup(sprite as Phaser.GameObjects.GameObject),
    );
    this.itemLockoutUntil = 0;
    this.showPickups();

    // The playfield is one map cell; the label strip under it belongs to the HUD.
    this.cameras.main.setViewport(0, 0, CELL_PX_W, CELL_PX_H);
    this.light = new LightLayer(this);
    this.cameras.main.setBackgroundColor(themeForFloor(start.floorIndex).palette.background);
    this.showRoomsAround(start);
    this.followInside(start);
    this.scene.launch('hud');

    const boss = [...this.world.rooms.values()].find((r) => r.floorRoom.kind === 'boss' && r.floorIndex === (urlBoss ?? 0) - 1);
    const jumpTo = boss ?? (urlRoom ? [...this.world.rooms.values()].find(isUrlRoom) : undefined);
    if (jumpTo) {
      const door = jumpTo.layout.doors[0];
      const at = tileCenter(jumpTo, door.cell.x, door.cell.y);
      this.player.body.reset(at.x, at.y);
      this.enterRoom(jumpTo, this.time.now);
    }
  }

  update(time: number, delta: number) {
    const dir = new Phaser.Math.Vector2(
      (this.move.right.isDown ? 1 : 0) - (this.move.left.isDown ? 1 : 0),
      (this.move.down.isDown ? 1 : 0) - (this.move.up.isDown ? 1 : 0),
    );
    if (dir.lengthSq() > 0) dir.normalize();
    // The shared stun (core/stun) holds the player too: no moving, no shooting, and the built-up speed is lost.
    const stunned = isStunned(this.playerStun, time);
    const dashing = isDashing(this.dash, time);
    this.momentum = stepMomentum(this.momentum, { dir, time, stunned, dashing }, TUNING.momentum);
    dir.scale(this.momentum.speed);
    if (dashing) {
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
    this.paper.update(time);
    this.light.update(this.player);
  }

  /** Keeps one orb per Orbital level circling the player, evenly spaced. */
  private circleOrbs(time: number) {
    const count = resolveWeapon(this.world.player.passives, this.world.player.statUps).orbitals;
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

  /** An orb touches an enemy part: a small hit, at most so often per part, or per body for a many-part one (its hit group). */
  private orbHits(part: EnemySprite) {
    if (!part.active) return;
    const group = this.enemies.find((e) => e.parts.includes(part))?.hitGroup ?? part;
    if (!this.orbGate.pass(group, this.time.now, TUNING.orbital.hitEveryMs)) return;
    this.damagePart(part, TUNING.orbital.damage);
  }

  /** Space or Shift: dash the way the player is moving, if they have the passive and it has cooled down. */
  private requestDash() {
    const rules = resolveWeapon(this.world.player.passives, this.world.player.statUps).dash;
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
    const dash = resolveWeapon(this.world.player.passives, this.world.player.statUps).dash;
    if (enemy && dash?.damage && isDashing(this.dash, this.time.now)) {
      const body = enemy.hitGroup ?? enemy;
      if (!this.dashHits.has(body)) {
        this.dashHits.add(body);
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
    // The newest held arrow wins, so a fresh press overrides one still held down.
    const aim = DIRECTIONS.filter((d) => this.aim[d].isDown).reduce<Direction | undefined>(
      (best, d) => (!best || this.aim[d].timeDown > this.aim[best].timeDown ? d : best),
      undefined,
    );
    if (!aim || time < this.nextShotAt) return;
    const weapon = resolveWeapon(this.world.player.passives, this.world.player.statUps);
    this.nextShotAt = time + weapon.fireDelayMs;
    this.playerArt?.attack(time);
    this.playerArt?.faceFor(STEP[aim], time + Math.max(weapon.fireDelayMs, 300));
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
        falloff: { out: createFalloff(), back: createFalloff() },
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
    // One swing is one attack: across a many-part body it falls off from the part nearest the player.
    const falloff = createFalloff();
    for (const part of this.nearestFirst(this.enemies.flatMap((e) => e.parts).filter(inArc), this.player)) {
      const heading = { x: part.x - this.player.x, y: part.y - this.player.y };
      if (this.shieldBlocks(part, heading)) this.clink(part.x - heading.x * 0.3, part.y - heading.y * 0.3);
      else this.strike(part, this.fallOff(falloff, part, damage));
    }
  }

  /**
   * The player's own hit, a shot's or a swing's: hurts the part, then the on-hit passives
   * (core/onHit) poison and may freeze its enemy and send lightning on to others.
   */
  private strike(part: EnemySprite, damage: number) {
    const enemy = this.enemies.find((e) => e.parts.includes(part));
    if (enemy?.invulnerable?.(part)) return;
    const at = { x: part.x, y: part.y };
    this.damagePart(part, damage);
    if (!enemy) return;
    const weapon = resolveWeapon(this.world.player.passives, this.world.player.statUps);
    const time = this.time.now;
    const alive = this.enemies.includes(enemy);
    // A many-part body carries one poison, whichever piece of it was struck and still standing.
    const body = enemy.hitGroup ?? enemy;
    if (weapon.poison && this.piecesOf(body).length) {
      this.poisoned.set(body, applyPoison(this.poisoned.get(body), time, weapon.poison));
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

  /** The living enemies that make up `body`: a many-part body's pieces (by hit group), or the enemy itself. */
  private piecesOf(body: object): Enemy[] {
    return this.enemies.filter((e) => (e.hitGroup ?? e) === body);
  }

  /**
   * Poison ticks away on every poisoned enemy, a green puff with each tick. A many-part body's
   * one poison lands each tick on a piece that can be hurt right now; if none can, that tick is lost.
   */
  private tickPoison(time: number) {
    const rules = resolveWeapon(this.world.player.passives, this.world.player.statUps).poison;
    for (const [body, poison] of this.poisoned) {
      const pieces = this.piecesOf(body);
      if (!pieces.length || !rules) {
        this.poisoned.delete(body);
        continue;
      }
      const tick = poisonTick(poison, time, rules);
      if (tick.poison) this.poisoned.set(body, tick.poison);
      else this.poisoned.delete(body);
      const part = pieces
        .flatMap((e) => e.parts.filter((p) => p.active && (!e.hitGroup || (p.body.enable && !e.invulnerable?.(p)))))[0];
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

  /**
   * A shot strikes something that can't be hurt: it squashes against it, bounces back up to a
   * tile and plops to the ground. It does nothing else.
   */
  private bounceOff(shot: Phaser.GameObjects.Arc) {
    const { velocity } = shot.body as Phaser.Physics.Arcade.Body;
    // Back the way it came, a little off true.
    const angle = Math.atan2(-velocity.y, -velocity.x) + (Math.random() - 0.5) * 0.9;
    const rules = TUNING.wormRoar;
    const reach = rules.bounceTiles * TUNING.tile * (0.6 + 0.4 * Math.random());
    const dud = this.add.circle(shot.x, shot.y, shot.radius, shot.fillColor).setDepth(shot.depth);
    // Squashed flat against what it hit.
    dud.setRotation(Math.atan2(velocity.y, velocity.x)).setScale(0.55, 1.35);
    shot.destroy();
    this.tweens.add({ targets: dud, scaleX: 1, scaleY: 1, duration: 70 });
    this.tweens.add({
      targets: dud,
      x: dud.x + Math.cos(angle) * reach,
      y: dud.y + Math.sin(angle) * reach,
      duration: rules.bounceMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        // Plop: it flattens into a little splat on the ground that fades.
        dud.setRotation(0);
        this.tweens.add({
          targets: dud,
          scaleX: 1.5,
          scaleY: 0.45,
          alpha: 0,
          duration: rules.plopMs,
          ease: 'Quad.easeIn',
          onComplete: () => dud.destroy(),
        });
      },
    });
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
    const maxTurn = (resolveWeapon(this.world.player.passives, this.world.player.statUps).homingTurnRate * deltaMs) / 1000;
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
      const visible = parts.filter((p) => p.visible && clearShot(shot, p));
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
      healRate: TUNING.goblin.healRate,
      repairCooldownMs: TUNING.goblin.repairCooldownMs,
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
      fireEnemyShot: (x, y, vx, vy, homing = false, bounces = 0, radius = TUNING.enemyShotRadius) => {
        const color = bounces > 0 ? COLORS.crystalShot : COLORS.enemyShot;
        // Drawn over the Candle Witch's dark, so shots can always be dodged.
        const shot = this.add.circle(x, y, radius, color).setData({ homing, bounces }).setDepth(DARK_DEPTH + 2);
        this.enemyShots.add(shot);
        (shot.body as Phaser.Physics.Arcade.Body).setCircle(radius).setVelocity(vx, vy);
      },
      tiles: room.layout.tiles,
      hurtPlayer: () => this.hurtPlayer(),
      smashRock: (cell: Cell) => {
        if (smashRock(this.world, room.floorRoom.id, cell)) this.removeTerrain(room.floorRoom.id, cell);
      },
      doors: room.layout.doors,
      landSeedPod: (cell, tile) => this.landSeedPod(room, cell, tile),
      crushSprout: (cell: Cell) => {
        if (clearSprout(this.world, room.floorRoom.id, cell)) this.removeTerrain(room.floorRoom.id, cell);
      },
      pushPlayerOut: (from, distance) => {
        const dx = this.player.x - from.x;
        const dy = this.player.y - from.y;
        const d = Math.hypot(dx, dy);
        if (d >= distance) return;
        // Dead centre: straight down.
        const [ux, uy] = d > 0 ? [dx / d, dy / d] : [0, 1];
        this.player.body.reset(from.x + ux * distance, from.y + uy * distance);
      },
      chipRock: (cell, hits) => {
        const roomId = room.floorRoom.id;
        const result = hitTile(this.world, roomId, cell, hits);
        if (result === 'broken') this.removeTerrain(roomId, cell);
        const shape = this.terrain.get(`${roomId}|${cell.x},${cell.y}`) as Phaser.GameObjects.Rectangle | undefined;
        if (result === 'damaged' && shape) this.fadeTerrain(shape, 0.25 * hits);
      },
      spawnEnemy: (enemy) => this.addEnemy(enemy),
      removeEnemy: (enemy) => {
        if (!this.enemies.includes(enemy)) return;
        for (const part of enemy.parts) part.destroy();
        this.enemies = this.enemies.filter((e) => e !== enemy);
        if (this.enemies.length === 0) this.clearRoom();
      },
      showBossBar: (bar) => {
        this.bossBar = bar;
      },
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
    if (this.enemies.find((e) => e.parts.includes(part))?.invulnerable?.(part)) {
      this.bounceOff(shot);
      return;
    }
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
    if (damages) this.strike(part, flight ? this.fallOff(flight.falloff[leg], part, damage) : damage);
    else this.clink(at.x, at.y);
  }

  /**
   * `full` damage to `part` after the attack's falloff on its enemy's hit group (core/multiHit).
   * A part that can't be hurt right now (inside a wall, a half blowing apart) doesn't count toward it.
   */
  private fallOff(falloff: Falloff, part: EnemySprite, full: number): number {
    const enemy = this.enemies.find((e) => e.parts.includes(part));
    if (!enemy?.hitGroup || !part.active || !part.body.enable || enemy.invulnerable?.(part)) return full;
    return falloff.damage(enemy.hitGroup, full);
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
    else if (result === 'damaged') this.fadeTerrain(wall, 0.25);
  }

  /** A cracked rock fades a step toward breaking, its paper art with it. */
  private fadeTerrain(shape: Phaser.GameObjects.Shape, by: number) {
    shape.setAlpha(shape.alpha - by);
    PaperLayer.artOf(shape)?.setAlpha(shape.alpha);
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
    for (const art of this.joinArt.get(key) ?? []) art.destroy();
    this.joinArt.delete(key);
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
    if (Phaser.Math.Distance.Between(at.x, at.y, this.player.x, this.player.y) <= reach + TUNING.playerHurtRadius) {
      this.hurtPlayer(TUNING.bomb.playerDamage);
    }
    // One blast is one attack: across a many-part body it falls off from the part nearest the bomb.
    const falloff = createFalloff();
    for (const part of this.nearestFirst(this.enemies.flatMap((e) => e.parts).filter(caught), at)) {
      this.damagePart(part, this.fallOff(falloff, part, TUNING.bomb.enemyDamage));
    }
  }

  /** `parts` ordered nearest `to` first. */
  private nearestFirst(parts: EnemySprite[], to: { x: number; y: number }): EnemySprite[] {
    const dist = (p: EnemySprite) => Phaser.Math.Distance.Between(to.x, to.y, p.x, p.y);
    return [...parts].sort((a, b) => dist(a) - dist(b));
  }

  private damagePart(part: EnemySprite, damage: number) {
    const enemy = this.enemies.find((e) => e.parts.includes(part));
    if (!enemy) return;
    const where = { x: part.x, y: part.y };
    const replacements = enemy.hit(part, damage);
    this.enemies = this.enemies.flatMap((e) => (e === enemy ? replacements : [e]));
    // Newborn enemies (a slime's children) join physics; split pieces keep the parts they had.
    for (const r of replacements) if (r.parts.some((p) => !this.enemyParts.contains(p))) this.addPhysics(r);
    const drop = this.lootCarriers.get(enemy);
    if (drop) {
      this.lootCarriers.delete(enemy);
      for (const r of replacements) this.lootCarriers.set(r, drop);
      if (![...this.lootCarriers.values()].includes(drop)) {
        dropLoot(this.world, this.world.currentRoomId, drop, tileAt(this.currentRoom, where.x, where.y));
        this.showPickups();
      }
    }
    if (this.enemies.length === 0) this.clearRoom();
  }

  private addEnemy(enemy: Enemy) {
    this.addPhysics(enemy);
    this.enemies.push(enemy);
  }

  private addPhysics(enemy: Enemy) {
    for (const part of enemy.parts) {
      // Joining a physics group re-applies its body defaults, resetting immovable to false.
      const immovable = part.body.immovable;
      this.enemyParts.add(part);
      if (enemy.collidesWithTerrain) this.walkers.add(part);
      else if (enemy.flies) this.flyers.add(part);
      part.body.setImmovable(immovable);
    }
  }

  /** Whether something that hurts (an enemy part, an enemy shot) reaches the player's hurtbox, smaller than their ball. */
  private inHurtbox(thing: Phaser.GameObjects.GameObject): boolean {
    const body = thing.body as Phaser.Physics.Arcade.Body;
    const r = TUNING.playerHurtRadius;
    if (body.isCircle) return hurtboxMeetsCircle(this.player, r, body.center, body.halfWidth);
    return hurtboxMeetsBox(this.player, r, { x: body.x, y: body.y, width: body.width, height: body.height });
  }

  /** Takes `halves` half-hearts, unless the player is still flashing from the last hit. */
  private hurtPlayer(halves = 1) {
    if (this.time.now < this.invincibleUntil) return;
    this.invincibleUntil = this.time.now + TUNING.invincibleMs;
    this.playerArt?.hurt(this.time.now);
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
    this.bossBar = undefined;
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
      // The wait counts from when the room is on screen, once the camera has slid in.
      this.enemiesWakeAt = time + TUNING.roomSlideMs + TUNING.enemyWakeMs;
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
    const isItem = pickup.type !== 'chest' && pickup.type !== 'lockedChest' && pickup.type !== 'openChest';
    if (isItem && this.time.now < this.itemLockoutUntil) return;
    const result = touchPickup(this.world, this.world.currentRoomId, id);
    if (result === 'none') return;
    if (result === 'opened') this.itemLockoutUntil = this.time.now + TUNING.chestLockoutMs;
    if (result === 'damageUp') this.announce('Damage up', COLORS.damageUp);
    if (result === 'rateUp') this.announce('Fire rate up', COLORS.rateUp);
    if (result === 'heartContainer') this.announce('+1 heart!', COLORS.heartUp);
    this.showPickups();
  }

  private spawnEnemies(room: WorldRoom) {
    const at = (c: Cell) => tileCenter(room, c.x, c.y);
    for (const spawn of room.layout.enemies) {
      const enemy = ENEMY_FACTORIES[spawn.type](this, spawn, at, room.layout);
      this.dressEnemy(enemy, spawn.type, !!spawn.champion);
      const drop = spawn.champion?.drop ?? BOSS_DROPS[spawn.type];
      if (drop) this.lootCarriers.set(enemy, drop);
      this.addEnemy(enemy);
    }
  }

  /** Gives an enemy with paper art its paper character, standing on its body and animated from what it does. */
  private dressEnemy(enemy: Enemy, type: EnemyType, champion: boolean) {
    const look = ENEMY_ART[type];
    if (!look) return;
    const actor = this.paper.actor(enemy.parts[0], type, { ...look, champion, scale: champion ? TUNING.champion.scale : 1 });
    if (!actor) return;
    if (enemy.visual) actor.visual = (time) => enemy.visual!(time);
    for (const shape of enemy.trim ?? []) this.cameras.main.ignore(shape);
  }

  private lockDoors(room: WorldRoom) {
    const t = TUNING.tile;
    for (const door of room.layout.doors) {
      const w = doorCorridor(room, door)[0];
      const c = tileCenter(room, w.x, w.y);
      const lock = this.add.rectangle(c.x, c.y, t, t, COLORS.lockedDoor);
      this.walls.add(lock);
      const gate = themeForFloor(room.floorIndex).paper
        ? this.paper.piece(doorKey(door.side, true), c.x, c.y, TILE_CANVAS, door.side === 'down' ? c.y + t : c.y + t / 2)
        : undefined;
      if (gate) this.paper.standIn(lock, gate);
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
    const theme = themeForFloor(room.floorIndex);
    const { palette } = theme;
    const looks = roomLooks(room.floorIndex, room.layout.theme ?? '');
    const variants = room.layout.variants;
    const variantAt = (tx: number, ty: number) => variants?.[ty]?.[tx] ?? Math.abs(tx * 7 + ty * 13) % TILE_VARIANTS;

    this.add.rectangle(b.x, b.y, b.w, b.h, palette.wall).setOrigin(0);
    const floor = tileCenter(room, 0, 0);
    this.add
      .rectangle(floor.x - t / 2, floor.y - t / 2, width * t, height * t, FLOOR_COLOR[room.floorRoom.kind](palette))
      .setOrigin(0);
    if (theme.paper) this.drawPaperFloor(room);
    else this.drawPlainFloor(room);

    for (let ty = -b.pad.y; ty < b.tilesH - b.pad.y; ty++) {
      for (let tx = -b.pad.x; tx < b.tilesW - b.pad.x; tx++) {
        if (tx >= 0 && ty >= 0 && tx < width && ty < height) continue;
        const c = tileCenter(room, tx, ty);
        if (corridors.has(`${tx},${ty}`)) {
          const door = room.layout.doors.find((d) => doorCorridor(room, d)[0].x === tx && doorCorridor(room, d)[0].y === ty);
          const art = theme.paper
            ? door
              ? this.paper.piece(doorKey(door.side, false), c.x, c.y, TILE_CANVAS, door.side === 'down' ? c.y + t : c.y + t / 2)
              : this.paper.piece(floorKey('normal', variantAt(tx, ty)), c.x, c.y, TILE_CANVAS)
            : undefined;
          if (!art) this.add.rectangle(c.x, c.y, t, t, palette.door);
          continue;
        }
        const wall = this.add.rectangle(c.x, c.y, t, t, palette.wall);
        this.walls.add(wall);
        if (theme.paper) this.paperWall(room, wall, tx, ty, variantAt(tx, ty));
      }
    }

    room.layout.tiles.forEach((row, ty) =>
      row.forEach((tile: Tile, tx) => {
        if (isWalkable(tile)) return;
        const c = tileCenter(room, tx, ty);
        // An L room's missing cell: plain room wall, not terrain that can crack.
        if (tile === 'wall') {
          const wall = this.add.rectangle(c.x, c.y, t, t, palette.wall);
          this.walls.add(wall);
          if (theme.paper) this.paperWall(room, wall, tx, ty, variantAt(tx, ty));
          return;
        }
        const shape = this.terrainPiece(room, tx, ty, tile, looks[tile as Exclude<Tile, 'floor' | 'wall'>], variants?.[ty]?.[tx]);
        // Shot-blocking tiles are walls to physics; the rest (holes) only stop walking.
        if (!blocksShots(tile)) {
          (hurtsOnTouch(tile) ? this.thorns : this.holes).add(shape);
          // Thorn can be a Treant sprout it may crush later (crushSprout).
          if (hurtsOnTouch(tile)) this.terrain.set(`${room.floorRoom.id}|${tx},${ty}`, shape);
          return;
        }
        shape.setData({ roomId: room.floorRoom.id, tile: { x: tx, y: ty } });
        this.walls.add(shape);
        this.terrain.set(`${room.floorRoom.id}|${tx},${ty}`, shape);
      }),
    );
    this.drawJoins(room);
    // Over the tiles, so each pit or pond reads as one shape (paper ponds have banks of their own).
    if (!looks.hole.art || !theme.paper) drawRegionRims(this.add.graphics(), room, looks.hole.stroke ?? palette.accent);
  }

  /** The floor as flat colour: each tile tinted by its variant, decor as faint placeholder marks. */
  private drawPlainFloor(room: WorldRoom) {
    const t = TUNING.tile;
    const dressing = this.add.graphics();
    const variants = room.layout.variants;
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
  }

  /** The floor in paper: a moss sheet per tile (the item and boss rooms' own), decor as paper cutouts. */
  private drawPaperFloor(room: WorldRoom) {
    const kind = FLOOR_KIND[room.floorRoom.kind];
    const variants = room.layout.variants;
    room.layout.tiles.forEach((row, ty) =>
      row.forEach((tile, tx) => {
        if (tile === 'wall') return;
        const c = tileCenter(room, tx, ty);
        this.paper.piece(floorKey(kind, variants?.[ty]?.[tx] ?? 0), c.x, c.y, TILE_CANVAS);
      }),
    );
    for (const d of room.layout.decor ?? []) {
      const c = tileCenter(room, d.cell.x, d.cell.y);
      // Nudged off the tile's centre by its cell, so a scatter of them doesn't sit on the grid.
      const x = c.x + (((d.cell.x * 7 + d.cell.y * 3) % 5) - 2) * 5;
      const y = c.y + (((d.cell.x * 3 + d.cell.y * 5) % 5) - 2) * 5;
      this.paper.piece(decorKey(d.kind, d.cell.x + d.cell.y), x, y, DECOR_CANVAS);
    }
  }

  /** A hedge in paper standing in for a wall block: the top wall shows its front face to the room. */
  private paperWall(room: WorldRoom, wall: Phaser.GameObjects.Rectangle, tx: number, ty: number, variant: number) {
    const { width, height } = room.layout;
    const inside = (x: number, y: number) => room.layout.tiles[y]?.[x] !== undefined && room.layout.tiles[y][x] !== 'wall';
    // The side it faces the room from; a wall block with no room below it gets plain foliage.
    const side: WallSide =
      inside(tx, ty + 1) ? 'top'
      : ty >= height && inside(tx, ty - 1) ? 'bottom'
      : tx < 0 || (inside(tx + 1, ty) && tx < width) ? 'left'
      : tx >= width || inside(tx - 1, ty) ? 'right'
      : 'corner';
    const footY = side === 'bottom' ? wall.y + TUNING.tile : side === 'top' ? wall.y + TUNING.tile / 2 : wall.y + 14;
    const art = this.paper.piece(wallKey(side, variant), wall.x, wall.y, TILE_CANVAS, footY);
    if (art) this.paper.standIn(wall, art);
  }

  /** A terrain tile's physics shape, standing in paper where its look has art. */
  private terrainPiece(room: WorldRoom, tx: number, ty: number, tile: Tile, look: TileLook, variant: number | undefined): Shape {
    const c = tileCenter(room, tx, ty);
    const shape = drawTile(this, c.x, c.y, variant === undefined ? look : { ...look, color: shade(look.color, variant) });
    if (!look.art) return shape;
    const flat = tile === 'hole';
    const key = tileKey(look.art, variant ?? 0, flat ? neighbourMask(room.layout.tiles, tx, ty) : 0);
    const art = this.paper.piece(key, c.x, c.y, TILE_CANVAS, flat ? undefined : c.y + TERRAIN_FOOT);
    if (art) this.paper.standIn(shape, art);
    return shape;
  }

  /** Neighbouring trees' canopies and thorns' vines grow into each other across the seam between them. */
  private drawJoins(room: WorldRoom) {
    if (!themeForFloor(room.floorIndex).paper) return;
    const looks = roomLooks(room.floorIndex, room.layout.theme ?? '');
    const joinable = (['obstacle', 'thorn'] as const).filter((tile) => looks[tile].art && JOIN_LOOKS.includes(looks[tile].art!));
    for (const j of joinsBetween(room.layout.tiles, joinable)) {
      const a = tileCenter(room, j.x, j.y);
      const [dx, dy] = j.dir === 'across' ? [TUNING.tile / 2, 0] : [0, TUNING.tile / 2];
      const art = this.paper.piece(joinKey(looks[j.tile as 'obstacle' | 'thorn'].art!, j.dir), a.x + dx, a.y + dy, TILE_CANVAS, a.y + dy + TERRAIN_FOOT);
      if (!art) continue;
      // Gone as soon as either tile it joins is.
      const b = j.dir === 'across' ? { x: j.x + 1, y: j.y } : { x: j.x, y: j.y + 1 };
      for (const cell of [{ x: j.x, y: j.y }, b]) {
        const key = `${room.floorRoom.id}|${cell.x},${cell.y}`;
        this.joinArt.set(key, [...(this.joinArt.get(key) ?? []), art]);
      }
    }
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
      const art = PaperLayer.artOf(shape);
      if (art) this.paper.follow(shape, art, TERRAIN_FOOT);
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
    // One crush is one attack: across a many-part body it falls off, part after part as it slides over them.
    const falloff = createFalloff();
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
          this.damagePart(part, this.fallOff(falloff, part, enemyDamage));
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
    const spot = { x: c.x - TUNING.tile / 2, y: c.y - TUNING.tile / 2, width: TUNING.tile, height: TUNING.tile };
    if (hurtboxMeetsBox(this.player, TUNING.playerHurtRadius, spot)) {
      this.hurtPlayer();
      return false;
    }
    if (!sproutTile(this.world, roomId, cell, tile)) return false;
    const shape = this.terrainPiece(room, cell.x, cell.y, tile, roomLooks(room.floorIndex, room.layout.theme ?? '')[tile], undefined);
    const art = PaperLayer.artOf(shape);
    if (art) {
      this.paper.follow(shape, art, TERRAIN_FOOT);
      this.roomObjects.get(roomId)?.push(art);
    }
    if (!blocksShots(tile)) {
      this.thorns.add(shape);
    } else {
      shape.setData({ roomId, tile: cell });
      this.walls.add(shape);
    }
    // Kept by cell either way, so the Treant can crush it again (crushSprout).
    this.terrain.set(`${roomId}|${cell.x},${cell.y}`, shape);
    this.roomObjects.get(roomId)?.push(shape);
    shape.setScale(0.2);
    this.tweens.add({ targets: shape, scale: 1, duration: 180, ease: 'Back.easeOut' });
    return true;
  }
}
