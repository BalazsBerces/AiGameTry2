import Phaser from 'phaser';
import { DIRECTIONS, STEP, type Cell, type Direction, type RoomKind } from '../core/floorGenerator';
import { distanceField, lineOfSight } from '../core/grid';
import type { ChampionDrop, EnemySpawn, EnemyType, Tile } from '../core/roomGenerator';
import { themeForFloor, type Palette, type TileLook } from '../core/themes';
import { blocksShots, blocksSight, isWalkable } from '../core/tiles';
import { launchVelocity, resolveWeapon } from '../core/weaponModel';
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
  touchPickup,
  type World,
  type WorldPickup,
  type WorldRoom,
} from '../core/world';
import { COLORS, TUNING } from './config';
import type { Enemy, EnemyContext, EnemySprite } from './entities/enemy';
import { createHive } from './entities/hive';
import { createShadow } from './entities/shadow';
import { createTurret } from './entities/turret';
import { BOSS_WORM, championWorm, REGULAR_WORM, spawnWorm } from './entities/worm';
import { createZombie } from './entities/zombie';
import { doorCorridor, mapCellAt, roomBlock, tileAt, tileCenter } from './geometry';

type Keys = Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
type PhysicsRect = Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };

const DEPTH = { player: 10 };

type At = (c: Cell) => { x: number; y: number };
const ENEMY_FACTORIES: Record<EnemyType, (scene: Phaser.Scene, spawn: EnemySpawn, at: At) => Enemy> = {
  zombie: (scene, s, at) => createZombie(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  turret: (scene, s, at) => createTurret(scene, at(s.cell).x, at(s.cell).y, !!s.champion),
  worm: (scene, s, at) => spawnWorm(scene, [s.cell, ...(s.tail ?? [])], at, s.champion ? championWorm(REGULAR_WORM) : REGULAR_WORM),
  wormBoss: (scene, s, at) => spawnWorm(scene, [s.cell, ...(s.tail ?? [])], at, BOSS_WORM),
  shadowBoss: (scene, s, at) => createShadow(scene, at(s.cell).x, at(s.cell).y),
  // The core covers 2x2 tiles; `cell` is its top-left.
  hiveBoss: (scene, s, at) => {
    const a = at(s.cell);
    const b = at({ x: s.cell.x + 1, y: s.cell.y + 1 });
    return createHive(scene, (a.x + b.x) / 2, (a.y + b.y) / 2);
  },
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

let firstBoot = true;

export class GameScene extends Phaser.Scene {
  world!: World;
  /** Blocks movement and shots: room walls, obstacles and locked doors. */
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  /** Blocks movement only; shots fly over. */
  private holes!: Phaser.Physics.Arcade.StaticGroup;
  private player!: PhysicsRect;
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
    this.terrain = new Map();
    for (const room of this.world.rooms.values()) this.drawRoom(room);

    const start = this.world.rooms.get(this.world.currentRoomId)!;
    const spawn = tileCenter(start, Math.floor(start.layout.width / 2), Math.floor(start.layout.height / 2));
    this.player = this.add.rectangle(spawn.x, spawn.y, TUNING.playerSize, TUNING.playerSize, COLORS.player) as PhysicsRect;
    this.player.setDepth(DEPTH.player);
    this.physics.add.existing(this.player);
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.player, this.holes);

    const kb = this.input.keyboard!;
    this.move = kb.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' }) as Keys;
    this.aim = kb.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }) as Keys;

    this.shots = this.physics.add.group();
    this.physics.add.collider(this.shots, this.walls, (shot, wall) => {
      if (!(shot as Phaser.GameObjects.GameObject).active) return; // already spent on another wall this frame
      shot.destroy();
      this.hitTerrain(wall as Phaser.GameObjects.Rectangle);
    });

    this.enemyParts = this.physics.add.group();
    this.walkers = this.physics.add.group();
    this.physics.add.collider(this.walkers, this.walls);
    this.physics.add.collider(this.walkers, this.holes);
    this.physics.add.collider(this.walkers, this.walkers);
    this.physics.add.overlap(this.shots, this.enemyParts, (shot, part) => this.hitEnemy(shot, part as EnemySprite));
    this.physics.add.overlap(this.player, this.enemyParts, () => this.hurtPlayer());
    // An event rather than JustDown polling, so a tap shorter than a frame still counts.
    kb.addKey('E').on('down', () => this.dropBomb());

    this.enemyShots = this.physics.add.group();
    this.physics.add.collider(this.enemyShots, this.walls, (shot) => shot.destroy());
    this.physics.add.overlap(this.player, this.enemyShots, (_p, shot) => {
      shot.destroy();
      this.hurtPlayer();
    });

    this.pickupGroup = this.physics.add.group();
    this.physics.add.overlap(this.player, this.pickupGroup, (_p, sprite) =>
      this.touchPickup(sprite as Phaser.GameObjects.GameObject),
    );
    this.itemLockoutUntil = 0;
    this.showPickups();

    this.cameras.main.setBackgroundColor(themeForFloor(start.floorIndex).palette.background);
    this.followInside(start);
    this.scene.launch('hud');
  }

  update(time: number, delta: number) {
    const dir = new Phaser.Math.Vector2(
      (this.move.right.isDown ? 1 : 0) - (this.move.left.isDown ? 1 : 0),
      (this.move.down.isDown ? 1 : 0) - (this.move.up.isDown ? 1 : 0),
    );
    if (dir.lengthSq() > 0) dir.normalize().scale(TUNING.playerSpeed);
    this.player.body.setVelocity(dir.x, dir.y);
    this.player.setAlpha(time < this.invincibleUntil && Math.floor(time / 80) % 2 === 0 ? 0.3 : 1);

    this.tryShoot(time);
    this.steerHomingShots(delta);
    this.dropShotsOutsideRoom();
    this.updateEnemies(time);
    this.followPlayerAcrossRooms(time);
  }

  private get currentRoom(): WorldRoom {
    return this.world.rooms.get(this.world.currentRoomId)!;
  }

  private tryShoot(time: number) {
    const aim = DIRECTIONS.find((d) => this.aim[d].isDown);
    if (!aim || time < this.nextShotAt) return;
    const weapon = resolveWeapon(this.world.player.passives);
    this.nextShotAt = time + weapon.fireDelayMs;
    if (this.enemies.length && time >= this.enemiesWakeAt) {
      const ctx = this.enemyContext(time);
      for (const e of this.enemies) e.onPlayerAttack?.(ctx, aim, weapon);
    }
    if (weapon.mode === 'sword') {
      this.swingSword(aim, weapon.damage);
      return;
    }
    const v = launchVelocity(aim, this.player.body.velocity, TUNING.shotSpeed);
    const color = weapon.homing ? COLORS.passive.homing : COLORS.shot;
    const shot = this.add.circle(this.player.x, this.player.y, TUNING.shotRadius, color);
    shot.setData({ damage: weapon.damage, homing: weapon.homing });
    this.shots.add(shot);
    (shot.body as Phaser.Physics.Arcade.Body).setCircle(TUNING.shotRadius).setVelocity(v.x, v.y);
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
   * given size is inside it. Shared by the player's sword and the Shadow's mirrored one.
   */
  private sweepArc(from: { x: number; y: number }, aim: Direction, color: number) {
    const { range, arcDeg, showMs } = TUNING.sword;
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

  /** A melee arc in the aimed direction; damages every enemy part inside it. */
  private swingSword(aim: Direction, damage: number) {
    const inArc = this.sweepArc(this.player, aim, COLORS.passive.sword);
    for (const part of this.enemies.flatMap((e) => e.parts).filter(inArc)) this.damagePart(part, damage);
  }

  /**
   * Homing shots turn at a limited rate, keeping their speed: the player's toward the nearest
   * enemy part, enemy ones (the Shadow's) toward the player.
   */
  private steerHomingShots(deltaMs: number) {
    const maxTurn = (TUNING.homingTurnRate * deltaMs) / 1000;
    const parts = this.enemies.flatMap((e) => e.parts);
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
    steer(this.shots, (shot) => (parts.length ? parts.reduce((best, p) => (dist(shot, p) < dist(shot, best) ? p : best)) : undefined));
    steer(this.enemyShots, () => this.player);
  }

  private updateEnemies(time: number) {
    if (this.enemies.length === 0) return;
    if (time < this.enemiesWakeAt) {
      for (const e of this.enemies) for (const p of e.parts) p.body.setVelocity(0, 0);
      return;
    }
    const ctx = this.enemyContext(time);
    for (const e of this.enemies) e.update(ctx);
  }

  private enemyContext(time: number): EnemyContext {
    const room = this.currentRoom;
    const tileOf = (x: number, y: number) => tileAt(room, x, y);
    const playerTile = tileOf(this.player.x, this.player.y);
    const first = tileCenter(room, 0, 0);
    const last = tileCenter(room, room.layout.width - 1, room.layout.height - 1);
    return {
      time,
      player: this.player,
      roomCenter: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
      playerTile,
      walkDistance: distanceField(room.layout.tiles, playerTile, isWalkable),
      tileOf,
      tileCenter: (tile: Cell) => tileCenter(room, tile.x, tile.y),
      isWalkable: (cell: Cell) => {
        const tile = room.layout.tiles[cell.y]?.[cell.x];
        return tile !== undefined && isWalkable(tile);
      },
      canSeePlayer: (from) =>
        lineOfSight(room.layout.tiles, this.toTileUnits(room, from), this.toTileUnits(room, this.player), blocksSight),
      fireEnemyShot: (x, y, vx, vy, homing = false) => {
        const shot = this.add.circle(x, y, TUNING.enemyShotRadius, COLORS.enemyShot).setData('homing', homing);
        this.enemyShots.add(shot);
        (shot.body as Phaser.Physics.Arcade.Body).setCircle(TUNING.enemyShotRadius).setVelocity(vx, vy);
      },
      swingAtPlayer: (from, aim) => {
        if (this.sweepArc(from, aim, COLORS.shadowEdge)(this.player)) this.hurtPlayer();
      },
      summonPoints: room.layout.summonPoints,
      summonZombie: (cell: Cell) => {
        const p = tileCenter(room, cell.x, cell.y);
        const zombie = createZombie(this, p.x, p.y);
        this.addEnemy(zombie);
        return zombie;
      },
    };
  }

  /** World position → fractional interior tile coordinates (2.5 = centre of tile 2). */
  private toTileUnits(room: WorldRoom, p: { x: number; y: number }) {
    const origin = tileCenter(room, 0, 0);
    return { x: (p.x - origin.x) / TUNING.tile + 0.5, y: (p.y - origin.y) / TUNING.tile + 0.5 };
  }

  private hitEnemy(shotObject: unknown, part: EnemySprite) {
    const shot = shotObject as Phaser.GameObjects.GameObject;
    if (!shot.active) return; // already spent on another part this frame
    // Read before destroying: destroy() discards the object's data.
    const damage = shot.getData('damage') as number;
    shot.destroy();
    this.damagePart(part, damage);
  }

  /** A player shot hit a wall piece; rocks crack and eventually break open. */
  private hitTerrain(wall: Phaser.GameObjects.Rectangle) {
    const roomId = wall.getData('roomId') as string | undefined;
    if (!roomId || !wall.active) return;
    const cell = wall.getData('tile') as Cell;
    const result = hitTile(this.world, roomId, cell);
    if (result === 'broken') this.removeTerrain(roomId, cell);
    else if (result === 'damaged') wall.setAlpha(wall.alpha - 0.25);
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
      const enemy = ENEMY_FACTORIES[spawn.type](this, spawn, at);
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
    // Earlier bosses just unlock their doors, exit included; the last one ends the run.
    if (this.currentRoom.floorRoom.kind === 'boss' && isFinalFloor(this.currentRoom.floorIndex)) this.endRun(true);
  }

  /** Camera tracks the player, clamped to the room: fixed in 1x1 rooms, scrolling in the boss room. */
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
    const { palette, looks } = themeForFloor(room.floorIndex);

    this.add.rectangle(b.x, b.y, b.w, b.h, palette.wall).setOrigin(0);
    const floor = tileCenter(room, 0, 0);
    this.add
      .rectangle(floor.x - t / 2, floor.y - t / 2, width * t, height * t, FLOOR_COLOR[room.floorRoom.kind](palette))
      .setOrigin(0);

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
        const shape = drawTile(this, c.x, c.y, looks[tile as Exclude<Tile, 'floor'>]);
        // Shot-blocking tiles are walls to physics; the rest (holes) only stop walking.
        if (!blocksShots(tile)) {
          this.holes.add(shape);
          return;
        }
        shape.setData({ roomId: room.floorRoom.id, tile: { x: tx, y: ty } });
        this.walls.add(shape);
        this.terrain.set(`${room.floorRoom.id}|${tx},${ty}`, shape);
      }),
    );
  }
}
