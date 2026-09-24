// Drives the running dev server in a real browser and screenshots it.
// Usage: node scripts/smoke.mjs <scenario> [outDir]
// Env: SMOKE_URL (default http://localhost:5173, dev server must be running), SMOKE_SEED (default 42)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [scenario = 'walk', outDir = 'smoke-out'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 432 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`screenshot ${outDir}/${name}.png`);
};
const scene = () => 'window.game.scene.getScene("game")';
const state = () =>
  page.evaluate(`(() => { const s = ${scene()}; return {
    room: s.world.currentRoomId,
    player: { x: Math.round(s.player.x), y: Math.round(s.player.y) },
    camera: { x: Math.round(s.cameras.main.midPoint.x), y: Math.round(s.cameras.main.midPoint.y) },
  }; })()`);
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};
const KEY = { up: 'w', down: 's', left: 'a', right: 'd' };
const BACK = { up: 's', down: 'w', left: 'd', right: 'a' };

await page.goto(`${process.env.SMOKE_URL ?? 'http://localhost:5173'}/?seed=${process.env.SMOKE_SEED ?? 42}`);
await page.waitForFunction(`!!window.game && !!${scene()}?.player`);
await page.waitForTimeout(300);
await shot('01-start');
console.log('start', await state());

if (scenario === 'walk') {
  const side = await page.evaluate(`${scene()}.world.rooms.get(${scene()}.world.currentRoomId).layout.doors[0].side`);
  console.log('door side', side);
  await hold(KEY[side], 2500);
  await page.waitForTimeout(500);
  await shot('02-neighbor');
  console.log('after walking through door', await state());
  await hold(BACK[side], 2500);
  await page.waitForTimeout(500);
  await shot('03-back');
  console.log('after walking back', await state());
}

if (scenario === 'walls') {
  for (const key of ['w', 'a']) {
    await hold(key, 2500);
    console.log(`after holding ${key}`, await state());
  }
  await shot('02-corner');
}

if (scenario === 'shoot') {
  const shots = () =>
    page.evaluate(`${scene()}.shots.getChildren().map((s) => ({ x: Math.round(s.x), y: Math.round(s.y),
      vx: Math.round(s.body.velocity.x), vy: Math.round(s.body.velocity.y) }))`);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(700);
  console.log('standing still, shooting up', await shots());
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await shot('02-shooting-while-moving');
  console.log('moving right, shooting up', await shots());
  await page.keyboard.up('d');
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(1500);
  console.log('after release (should be empty)', await shots());
}

if (scenario === 'terrain-seed7') {
  // Room 0,-1 on seed 7: row 3 left of centre is holes only; row 2 has a hole at x=4 then an obstacle at x=3.
  const tileToWorld = (tx, ty) => ({ x: (tx + 1.5) * 48, y: -432 + (ty + 1.5) * 48 });
  const shootFrom = async (ty) => {
    const p = tileToWorld(6, ty);
    await page.evaluate(`(() => { const s = ${scene()}; s.player.body.reset(${p.x}, ${p.y}); s.world.currentRoomId = '0,-1';
      s.cameras.main.centerOn(360, -216); })()`);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(120);
    await page.keyboard.up('ArrowLeft');
    let minX = Infinity;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(40);
      const xs = await page.evaluate(`${scene()}.shots.getChildren().map((s) => s.x)`);
      if (xs.length) minX = Math.min(minX, ...xs);
    }
    return Math.round(minX);
  };
  console.log('row 3 (holes only) furthest shot x:', await shootFrom(3), '(left wall edge is 48)');
  await page.waitForTimeout(600);
  console.log('row 2 (obstacle at tile 3 spans x 190-234) furthest shot x:', await shootFrom(2));
  await shot('02-terrain');
}

if (scenario === 'combat') {
  const combat = () =>
    page.evaluate(`(() => { const s = ${scene()}; return {
      room: s.world.currentRoomId, health: s.world.player.health,
      enemies: s.enemies.map((e) => ({ x: Math.round(e.parts[0].x), y: Math.round(e.parts[0].y), parts: e.parts.length })),
      locks: s.doorLocks.length, cleared: [...s.world.cleared],
    }; })()`);
  const side = await page.evaluate(`${scene()}.world.rooms.get(${scene()}.world.currentRoomId).layout.doors[0].side`);
  await hold(KEY[side], 2000);
  await page.waitForTimeout(100);
  await shot('02-entered');
  console.log('entered', await combat());
  await page.waitForTimeout(2500);
  console.log('player', await page.evaluate(`(() => { const p = ${scene()}.player; return { x: p.x, y: p.y, alpha: p.alpha, visible: p.visible, depth: p.depth, active: p.active }; })()`));
  await shot('03-zombies-close-in');
  console.log('after standing 2.5s', await combat());
  // Kill everything by shooting at each zombie in turn.
  for (let i = 0; i < 40; i++) {
    const s = await combat();
    if (s.enemies.length === 0 || !(await page.evaluate(`${scene()}.scene.isActive()`))) break;
    const e = s.enemies[0];
    const p = await state();
    const dx = e.x - p.player.x;
    const dy = e.y - p.player.y;
    const key = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : dy > 0 ? 'ArrowDown' : 'ArrowUp';
    await page.evaluate(`${scene()}.world.player.health = 6`); // keep the player alive for this part
    await hold(key, 350);
  }
  await page.waitForTimeout(300);
  await shot('04-cleared');
  console.log('after shooting', await combat());
  await page.evaluate(`${scene()}.world.player.health = 1`);
  await page.evaluate(`(() => { const s = ${scene()}; s.world.cleared.delete(s.world.currentRoomId); s.spawnEnemies(s.world.rooms.get(s.world.currentRoomId)); })()`);
  await page.waitForTimeout(3000);
  await shot('05-death');
  console.log('end scene active:', await page.evaluate(`window.game.scene.isActive('end')`));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log('after Enter:', await page.evaluate(`(() => { const s = ${scene()}; return {
    gameActive: window.game.scene.isActive('game'), hudActive: window.game.scene.isActive('hud'),
    seed: s.world.seed, health: s.world.player.health, room: s.world.currentRoomId }; })()`));
  await shot('06-new-run');
}

if (scenario === 'boss-walk') {
  // Walk the real door path from start to the boss room, with every room pre-cleared.
  const floor = await page.evaluate(`(() => { const s = ${scene()};
    for (const [id, r] of s.world.rooms) if (r.floorRoom.kind !== 'boss') s.world.cleared.add(id);
    const f = s.world.floors[0];
    return { rooms: f.rooms, connections: f.connections, start: f.startRoomId,
      layouts: Object.fromEntries([...s.world.rooms].map(([id, r]) => [id, { w: r.layout.width, h: r.layout.height, doors: r.layout.doors }])) };
  })()`);
  const byId = Object.fromEntries(floor.rooms.map((r) => [r.id, r]));
  const boss = floor.rooms.find((r) => r.kind === 'boss');
  const item = floor.rooms.find((r) => r.kind === 'item');
  console.log('rooms', floor.rooms.length, 'boss', boss.id, boss.cells, 'item', item.id);
  const prev = { [floor.start]: null };
  const queue = [floor.start];
  while (queue.length) {
    const id = queue.shift();
    for (const [a, b] of floor.connections) {
      const other = a === id ? b : b === id ? a : null;
      if (other && !(other in prev)) (prev[other] = id), queue.push(other);
    }
  }
  const path = [];
  for (let id = boss.id; id; id = prev[id]) path.unshift(id);
  console.log('path', path.join(' -> '));

  const doorWorld = (roomId, door) => {
    const r = byId[roomId];
    const L = floor.layouts[roomId];
    const cellsW = Math.max(...r.cells.map((c) => c.x)) - r.cell.x + 1;
    const cellsH = Math.max(...r.cells.map((c) => c.y)) - r.cell.y + 1;
    const pad = { x: (cellsW * 15 - L.w) / 2, y: (cellsH * 9 - L.h) / 2 };
    return { x: r.cell.x * 720 + (door.cell.x + pad.x + 0.5) * 48, y: r.cell.y * 432 + (door.cell.y + pad.y + 0.5) * 48 };
  };
  const SIDE_OF = (from, to) => {
    const toCells = new Set(byId[to].cells.map((c) => `${c.x},${c.y}`));
    for (const c of byId[from].cells) {
      for (const [side, dx, dy] of [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]]) {
        if (toCells.has(`${c.x + dx},${c.y + dy}`)) return side;
      }
    }
  };
  for (let i = 0; i + 1 < path.length; i++) {
    const [from, to] = [path[i], path[i + 1]];
    const side = SIDE_OF(from, to);
    // The door on that side whose position is nearest the target room's cells.
    const target = byId[to].cells[0];
    const doors = floor.layouts[from].doors.filter((d) => d.side === side);
    const door = doors.map((d) => ({ d, p: doorWorld(from, d) }))
      .sort((a, b) => Math.hypot(a.p.x - target.x * 720, a.p.y - target.y * 432) - Math.hypot(b.p.x - target.x * 720, b.p.y - target.y * 432))[0];
    await page.evaluate(`${scene()}.player.body.reset(${door.p.x}, ${door.p.y})`);
    await hold(KEY[side], 750);
    await page.waitForTimeout(350);
    const now = await state();
    console.log(`${from} -${side}-> ${to}: now in ${now.room}`);
    if (now.room !== to) break;
  }
  await shot('02-boss-entry');
  console.log('boss entry', await state());
  await page.evaluate(`${scene()}.invincibleUntil = Infinity`);
  await page.waitForTimeout(1500);
  await shot('03-boss-fight');
  const pieces = () => page.evaluate(`${scene()}.enemies.map((e) => e.parts.length)`);
  console.log('boss pieces', await pieces(), 'locks', await page.evaluate(`${scene()}.doorLocks.length`));
  const hitPart = (enemy, part, times) =>
    page.evaluate(`(() => { const s = ${scene()}; const p = s.enemies[${enemy}]?.parts[${part}];
      for (let i = 0; i < ${times} && p; i++) s.damagePart(p, 1); })()`);
  await hitPart(0, 3, 5);
  console.log('after killing segment 3', await pieces());
  await page.waitForTimeout(1000);
  await shot('04-boss-split');
  console.log('won before all dead?', await page.evaluate(`window.game.scene.isActive('end')`));
  for (let i = 0; i < 20 && (await page.evaluate(`window.game.scene.isActive('game')`)); i++) await hitPart(0, 0, 5);
  await page.waitForTimeout(300);
  console.log('end scene active', await page.evaluate(`window.game.scene.isActive('end')`));
  await shot('05-win');
}

if (scenario === 'turret-los') {
  // Uses the room above the start on seed 7; picks rows from its real tiles.
  const tiles = await page.evaluate(`${scene()}.world.rooms.get('0,-1').layout.tiles`);
  const between = (row) => tiles[row].slice(1, 6);
  const holeRow = tiles.findIndex((r, y) => r[0] === 'floor' && r[6] === 'floor' && between(y).includes('hole') && !between(y).includes('obstacle'));
  const wallRow = tiles.findIndex((r, y) => r[0] === 'floor' && r[6] === 'floor' && between(y).includes('obstacle'));
  console.log('rows', tiles.map((r) => r.map((t) => (t === 'floor' ? '.' : t === 'hole' ? 'o' : '#')).join('')));
  console.log('holes-only row', holeRow, 'obstacle row', wallRow);
  const trial = async (row) => {
    const shots = await page.evaluate(`(async () => {
      const s = ${scene()};
      const room = s.world.rooms.get('0,-1');
      for (const e of s.enemies) for (const p of e.parts) p.destroy();
      s.enemies = [];
      s.world.currentRoomId = '0,-1';
      s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
      const at = (tx) => ({ x: (tx + 1.5) * 48, y: -432 + (${row} + 1.5) * 48 });
      s.player.body.reset(at(6).x, at(6).y);
      s.invincibleUntil = Infinity;
      s.spawnEnemies({ ...room, layout: { ...room.layout, enemies: [{ type: 'turret', cell: { x: 0, y: ${row} } }] } });
      s.enemiesWakeAt = 0;
      let fired = 0;
      const orig = s.enemyShots.add.bind(s.enemyShots);
      s.enemyShots.add = (o) => { fired++; return orig(o); };
      await new Promise((r) => setTimeout(r, 4000));
      s.enemyShots.add = orig;
      return fired;
    })()`);
    return shots;
  };
  if (holeRow >= 0) console.log('turret shots across holes in 4s:', await trial(holeRow));
  await shot('02-turret');
  if (wallRow >= 0) console.log('turret shots through obstacle in 4s:', await trial(wallRow));
}

if (scenario === 'worm') {
  // Room above the start on seed 7: the top row is clear floor.
  const worms = () =>
    page.evaluate(`${scene()}.enemies.map((e) => e.parts.map((p) => { const t = ${scene()}.world.rooms.get('0,-1'); return [Math.round((p.x - 72) / 48), Math.round((p.y + 432 - 72) / 48)]; }))`);
  await page.evaluate(`(() => {
    const s = ${scene()};
    const room = s.world.rooms.get('0,-1');
    s.world.currentRoomId = '0,-1';
    s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
    s.player.body.reset(360, -432 + 6.5 * 48);
    s.invincibleUntil = Infinity;
    s.spawnEnemies({ ...room, layout: { ...room.layout, enemies: [{ type: 'worm', cell: { x: 3, y: 0 }, tail: [{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }] }] } });
    s.enemiesWakeAt = 0;
  })()`);
  const tiles = await page.evaluate(`${scene()}.world.rooms.get('0,-1').layout.tiles`);
  let bad = 0;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(300);
    for (const w of await worms()) {
      for (const [x, y] of w) if (tiles[y]?.[x] !== 'floor') bad++;
    }
  }
  console.log('worm cells after moving', JSON.stringify(await worms()), 'samples off-floor:', bad);
  await shot('02-worm');
  const split = await page.evaluate(`(() => {
    const s = ${scene()};
    const part = s.enemies[0].parts[1];
    for (let i = 0; i < 2; i++) s.damagePart(part, 1);
    return s.enemies.map((e) => e.parts.length);
  })()`);
  console.log('pieces after killing segment 1 of 4:', split);
  await page.waitForTimeout(1500);
  console.log('pieces keep moving independently', JSON.stringify(await worms()));
  await shot('03-worm-split');
}

if (scenario === 'pickups') {
  // Room above the start on seed 7, top row and bottom row are floor.
  await page.evaluate(`(() => {
    const s = ${scene()};
    s.world.cleared.add('0,-1');
    s.world.currentRoomId = '0,-1';
    s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
    s.world.pickups.set('0,-1', [
      { id: 901, type: 'lockedChest', cell: { x: 6, y: 3 }, contents: [{ type: 'heart' }, { type: 'key' }, { type: 'key' }] },
      { id: 902, type: 'key', cell: { x: 1, y: 0 } },
      { id: 903, type: 'heart', cell: { x: 12, y: 6 } },
    ]);
    s.showPickups();
  })()`);
  const at = (tx, ty) => ({ x: (tx + 1.5) * 48, y: -432 + (ty + 1.5) * 48 });
  const standOn = async (tx, ty, ms = 150) => {
    const p = at(tx, ty);
    await page.evaluate(`${scene()}.player.body.reset(${p.x}, ${p.y})`);
    await page.waitForTimeout(ms);
  };
  const report = () => page.evaluate(`(() => { const s = ${scene()}; return {
    keys: s.world.player.keys, health: s.world.player.health,
    pickups: s.world.pickups.get('0,-1').map((p) => p.type + '@' + p.cell.x + ',' + p.cell.y).join(' ') }; })()`);
  await shot('02-pickups');
  await standOn(6, 3);
  console.log('locked chest without key:', await report());
  await standOn(1, 0);
  console.log('after key:', await report());
  await standOn(6, 3, 50);
  const opened = await report();
  console.log('after opening locked chest:', opened);
  await shot('03-chest-open');
  const drop = opened.pickups.split(' ').find((p) => p.startsWith('key@'));
  const [dx, dy] = drop.split('@')[1].split(',').map(Number);
  await standOn(dx, dy, 100);
  console.log('touching a drop inside the lockout (key count should not change):', await report());
  await page.waitForTimeout(500);
  await standOn(dx, dy - 0, 150);
  console.log('touching it after the lockout:', await report());
  await standOn(12, 6);
  console.log('heart at full health (should stay):', await report());
  await page.evaluate(`${scene()}.world.player.health = 3`);
  await standOn(12, 6);
  console.log('heart when hurt:', await report());
}

if (scenario === 'passives') {
  // 1) Item room: enter it and walk onto the passive.
  const item = await page.evaluate(`(() => { const s = ${scene()};
    const room = [...s.world.rooms.values()].find((r) => r.floorRoom.kind === 'item');
    s.enterRoom(room, s.time.now);
    const p = s.world.pickups.get(room.floorRoom.id)[0];
    const c = { x: room.floorRoom.cell.x * 720 + (p.cell.x + 1.5) * 48, y: room.floorRoom.cell.y * 432 + (p.cell.y + 1.5) * 48 };
    return { id: room.floorRoom.id, passive: p.passive, c };
  })()`);
  await page.waitForTimeout(400);
  await shot('02-item-room');
  await page.evaluate(`${scene()}.player.body.reset(${item.c.x}, ${item.c.y})`);
  await page.waitForTimeout(200);
  console.log(`item room ${item.id} held ${item.passive}; player passives now:`,
    await page.evaluate(`${scene()}.world.player.passives`));

  // 2) Fire rate: count shots in one second, without and with the passive.
  const countShots = async (passives) => {
    await page.evaluate(`(() => { const s = ${scene()}; s.world.player.passives = ${JSON.stringify(passives)};
      s.__fired = 0; const orig = s.shots.add.bind(s.shots); s.shots.add = (o) => { s.__fired++; return orig(o); }; })()`);
    await hold('ArrowDown', 1000);
    return page.evaluate(`${scene()}.__fired`);
  };
  console.log('shots/second plain:', await countShots([]), ' with fireRate:', await countShots(['fireRate']));
  await page.waitForTimeout(1500);
  console.log('shots still alive 1.5s later:', await page.evaluate(`${scene()}.shots.getChildren().map((o) => ({
    x: Math.round(o.x), y: Math.round(o.y), vx: Math.round(o.body.velocity.x), vy: Math.round(o.body.velocity.y),
    blockedDown: o.body.blocked.down, touching: o.body.touching.down, active: o.active }))`));
  console.log('player', await state());

  // 3) Homing: a turret off to the side; a shot fired straight up should bend toward it.
  await page.evaluate(`(() => {
    const s = ${scene()};
    const room = s.world.rooms.get('0,-1');
    s.world.currentRoomId = '0,-1';
    s.world.player.passives = ['homing'];
    s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
    s.player.body.reset((6 + 1.5) * 48, -432 + (6 + 1.5) * 48);
    s.invincibleUntil = Infinity;
    s.spawnEnemies({ ...room, layout: { ...room.layout, enemies: [{ type: 'turret', cell: { x: 11, y: 0 } }] } });
  })()`);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(60);
  await page.keyboard.up('ArrowUp');
  const path = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(60);
    const s = await page.evaluate(`${scene()}.shots.getChildren().map((o) => [Math.round(o.x), Math.round(o.y)])[0]`);
    if (s) path.push(s);
  }
  console.log('homing shot path (x should grow toward the turret on the right):', JSON.stringify(path));
  await shot('03-homing');
}

if (scenario === 'sword') {
  const setup = (passives) =>
    page.evaluate(`(() => {
      const s = ${scene()};
      for (const e of s.enemies) for (const p of e.parts) p.destroy();
      s.enemies = [];
      const room = s.world.rooms.get('0,-1');
      s.world.currentRoomId = '0,-1';
      s.world.player.passives = ${JSON.stringify(passives)};
      s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
      s.player.body.reset((6 + 1.5) * 48, -432 + (0 + 1.5) * 48);
      s.invincibleUntil = Infinity;
      s.spawnEnemies({ ...room, layout: { ...room.layout, enemies: [
        { type: 'zombie', cell: { x: 7, y: 0 } }, { type: 'zombie', cell: { x: 5, y: 0 } }] } });
      s.enemiesWakeAt = Infinity; // frozen in place
      s.nextShotAt = 0;
    })()`);
  const alive = () => page.evaluate(`${scene()}.enemies.map((e) => Math.round(e.parts[0].x))`);
  await setup(['sword', 'homing']);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(40);
  await shot('02-sword-swing');
  await page.keyboard.up('ArrowRight');
  console.log('after one swing right: zombies left at x =', await alive(), '(only the left one, x=312, should remain)');
  console.log('shots fired with sword:', await page.evaluate(`${scene()}.shots.getChildren().length`));
  await setup(['sword', 'fireRate']);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(40);
  await page.keyboard.up('ArrowRight');
  console.log('sword+fireRate, one swing (1.5 dmg vs 3 hp): zombies', await alive());
}

if (scenario === 'full-run') {
  const world = await page.evaluate(`(() => { const s = ${scene()};
    for (const [id, r] of s.world.rooms) if (r.floorRoom.kind !== 'boss') s.world.cleared.add(id);
    s.invincibleUntil = Infinity;
    return {
      rooms: [...s.world.rooms.values()].map((r) => ({ ...r.floorRoom, floorIndex: r.floorIndex, neighbors: r.neighbors,
        w: r.layout.width, h: r.layout.height, doors: r.layout.doors })),
    };
  })()`);
  const byId = Object.fromEntries(world.rooms.map((r) => [r.id, r]));
  const pathTo = (from, to) => {
    const prev = { [from]: null };
    const queue = [from];
    while (queue.length) {
      const id = queue.shift();
      for (const n of byId[id].neighbors) if (!(n in prev)) (prev[n] = id), queue.push(n);
    }
    const path = [];
    for (let id = to; id; id = prev[id]) path.unshift(id);
    return path;
  };
  const sideOf = (from, to) => {
    const toCells = new Set(byId[to].cells.map((c) => `${c.x},${c.y}`));
    for (const c of byId[from].cells) {
      for (const [side, dx, dy] of [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]]) {
        if (toCells.has(`${c.x + dx},${c.y + dy}`)) return { side, c };
      }
    }
  };
  const doorWorld = (r, door) => {
    const cellsW = Math.max(...r.cells.map((c) => c.x)) - r.cell.x + 1;
    const cellsH = Math.max(...r.cells.map((c) => c.y)) - r.cell.y + 1;
    const pad = { x: (cellsW * 15 - r.w) / 2, y: (cellsH * 9 - r.h) / 2 };
    return { x: r.cell.x * 720 + (door.cell.x + pad.x + 0.5) * 48, y: r.cell.y * 432 + (door.cell.y + pad.y + 0.5) * 48 };
  };
  const walkTo = async (target) => {
    const from = (await state()).room;
    const path = pathTo(from, target);
    for (let i = 0; i + 1 < path.length; i++) {
      const r = byId[path[i]];
      const { side, c } = sideOf(path[i], path[i + 1]);
      // The door on that side nearest the map cell that touches the next room.
      const mid = { x: c.x * 720 + 360, y: c.y * 432 + 216 };
      const door = r.doors.filter((d) => d.side === side).map((d) => doorWorld(r, d))
        .sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0];
      await page.evaluate(`${scene()}.player.body.reset(${door.x}, ${door.y})`);
      await hold(KEY[side], 750);
      await page.waitForTimeout(350);
      const now = (await state()).room;
      if (now !== path[i + 1]) {
        console.log(`  STUCK: wanted ${path[i + 1]} via ${side}, still in ${now}`);
        return false;
      }
    }
    return true;
  };
  const floorNow = () => page.evaluate(`${scene()}.world.rooms.get(${scene()}.world.currentRoomId).floorIndex + 1`);
  const killAll = async () => {
    for (let i = 0; i < 200; i++) {
      const left = await page.evaluate(`(() => { const s = ${scene()}; if (!s.scene.isActive()) return 0;
        const p = s.enemies[0]?.parts[0]; if (p) s.damagePart(p, 1); return s.enemies.length; })()`);
      if (!left) return;
    }
  };
  for (let f = 0; f < 3; f++) {
    const boss = world.rooms.find((r) => r.kind === 'boss' && r.floorIndex === f);
    const ok = await walkTo(boss.id);
    console.log(`floor ${f + 1}: reached boss ${boss.id}: ${ok}, HUD floor ${await floorNow()}, locks ${await page.evaluate(`${scene()}.doorLocks.length`)}`);
    if (!ok) break;
    if (f === 0) {
      await page.waitForTimeout(1000);
      await shot('03-treant-roots');
      console.log('  treant fight after 1s:', await page.evaluate(`(() => { const s = ${scene()}; return {
        enemies: s.enemies.map((e) => e.parts.length === 1 && e.parts[0].radius ? 'treant' : 'other').join(','),
        health: s.world.player.health }; })()`));
    }
    if (f === 2) {
      const shadowInfo = () => page.evaluate(`(() => { const s = ${scene()}; const ctx = s.enemyContext(s.time.now);
        const sh = s.enemies[0]?.parts[0]; const p = s.player;
        return { shadow: sh && [Math.round(sh.x), Math.round(sh.y)],
          mirrorTarget: [Math.round(2 * ctx.roomCenter.x - p.x), Math.round(2 * ctx.roomCenter.y - p.y)],
          enemyShots: s.enemyShots.getChildren().map((o) => [Math.round(o.body.velocity.x), Math.round(o.body.velocity.y)]) }; })()`);
      await page.waitForTimeout(800);
      await hold('d', 500);
      await page.waitForTimeout(400);
      console.log('  shadow vs its mirrored target after moving right:', await shadowInfo());
      await page.evaluate(`${scene()}.world.player.passives = []`);
      await hold('ArrowUp', 120);
      console.log('  after the player shoots up (shadow shot should go down, vy > 0):', (await shadowInfo()).enemyShots);
      await shot('04-shadow');
      await page.waitForTimeout(1500);
      await page.evaluate(`${scene()}.world.player.passives = ['sword']`);
      await hold('ArrowUp', 120);
      console.log('  with the sword, shadow fires no shots:', (await shadowInfo()).enemyShots.length === 0);
    }
    await killAll();
    if (f === 2) break;
    console.log(`  boss dead, locks now ${await page.evaluate(`${scene()}.doorLocks.length`)}`);
    const nextStart = world.rooms.find((r) => r.kind === 'start' && r.floorIndex === f + 1);
    console.log(`  through the exit to ${nextStart.id}: ${await walkTo(nextStart.id)}, HUD floor ${await floorNow()}`);
    if (f === 0) {
      await shot('02-floor2-start');
      console.log(`  walk back to floor 1 start: ${await walkTo(world.rooms.find((r) => r.kind === 'start' && r.floorIndex === 0).id)}, HUD floor ${await floorNow()}`);
    }
  }
  await page.waitForTimeout(300);
  console.log('won:', await page.evaluate(`window.game.scene.isActive('end')`));
}

if (scenario === 'shot-damage') {
  // A frozen 3 HP zombie straight above the player; count real shots until it dies.
  const shotsToKill = async (passives) => {
    await page.evaluate(`(() => {
      const s = ${scene()};
      for (const e of s.enemies) for (const p of e.parts) p.destroy();
      s.enemies = [];
      const room = s.world.rooms.get('0,-1');
      s.world.currentRoomId = '0,-1';
      s.world.player.passives = ${JSON.stringify(passives)};
      s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
      s.player.body.reset((6 + 1.5) * 48, -432 + (6 + 1.5) * 48);
      s.invincibleUntil = Infinity;
      s.spawnEnemies({ ...room, layout: { ...room.layout, enemies: [{ type: 'zombie', cell: { x: 6, y: 0 } }] } });
      s.enemiesWakeAt = Infinity;
      s.nextShotAt = 0;
      s.shots.clear(true, true); // no stray shots from the previous trial
      s.__hits = 0;
      const orig = s.damagePart.bind(s);
      s.damagePart = (part, dmg) => { s.__hits++; return orig(part, dmg); };
    })()`);
    for (let i = 0; i < 40 && (await page.evaluate(`${scene()}.enemies.length`)); i++) await hold('ArrowUp', 150);
    await page.waitForTimeout(400);
    return page.evaluate(`(() => { const s = ${scene()}; delete s.damagePart; return s.__hits; })()`);
  };
  console.log('hits to kill a 3 HP zombie, plain (expect 3):', await shotsToKill([]));
  console.log('hits to kill a 3 HP zombie, fireRate (expect 6):', await shotsToKill(['fireRate']));
}

if (scenario === 'immovable') {
  // Zombies chase the player straight through a stationary enemy standing between them.
  const pushTest = async (blocker) => {
    await page.evaluate(`(() => {
      const s = ${scene()};
      for (const e of s.enemies) for (const p of e.parts) p.destroy();
      s.enemies = [];
      s.enemyShots.clear(true, true);
      const room = s.world.rooms.get('0,-1');
      s.world.currentRoomId = '0,-1';
      s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
      s.player.body.reset((6 + 1.5) * 48, -432 + (6 + 1.5) * 48);
      s.invincibleUntil = Infinity;
      s.world.player.health = 6;
      s.spawnEnemies({ ...room, layout: { ...room.layout, tiles: room.layout.tiles.map((r) => r.map(() => 'floor')),
        enemies: [${blocker}, { type: 'zombie', cell: { x: 5, y: 0 } }, { type: 'zombie', cell: { x: 6, y: 0 } }, { type: 'zombie', cell: { x: 7, y: 0 } }] } });
      s.enemiesWakeAt = 0;
    })()`);
    const pos = () => page.evaluate(`(() => { const p = ${scene()}.enemies[0].parts[0]; return [Math.round(p.x), Math.round(p.y)]; })()`);
    const before = await pos();
    await page.waitForTimeout(3000);
    const after = await pos();
    return { before, after, moved: Math.round(Math.hypot(after[0] - before[0], after[1] - before[1])) };
  };
  console.log('turret pushed by zombies (moved should be 0):', await pushTest(`{ type: 'turret', cell: { x: 6, y: 4 } }`));
  console.log('treant pushed by zombies (moved should be 0):', await pushTest(`{ type: 'treantBoss', cell: { x: 5, y: 3 } }`));
}

if (scenario === 'end-race') {
  // Death and the final boss's death in the same tick, in both orders; the first should stick.
  const race = async (order) => {
    await page.goto(`${process.env.SMOKE_URL ?? 'http://localhost:5173'}/?seed=${process.env.SMOKE_SEED ?? 42}`);
    await page.waitForFunction(`!!window.game && !!${scene()}?.player`);
    await page.evaluate(`(() => {
      const s = ${scene()};
      const finalBoss = [...s.world.rooms.values()].find((r) => r.floorRoom.kind === 'boss' && r.floorIndex === 2);
      s.world.currentRoomId = finalBoss.floorRoom.id;
      s.world.player.health = 1;
      s.invincibleUntil = 0;
      for (const step of ${JSON.stringify(order)}) step === 'die' ? s.hurtPlayer() : s.clearRoom();
    })()`);
    await page.waitForTimeout(300);
    return page.evaluate(`window.game.scene.getScene('end').sys.settings.data?.won ? 'YOU WIN' : 'YOU DIED'`);
  };
  console.log('player dies, then final boss dies (expect YOU DIED):', await race(['die', 'win']));
  console.log('final boss dies, then player dies (expect YOU WIN):', await race(['win', 'die']));
}

if (scenario === 'chest-passive') {
  await page.evaluate(`(() => {
    const s = ${scene()};
    s.world.cleared.add('0,-1');
    s.world.currentRoomId = '0,-1';
    s.cameras.main.stopFollow().removeBounds().centerOn(360, -216);
    s.world.pickups.set('0,-1', [{ id: 950, type: 'chest', cell: { x: 6, y: 3 }, contents: [{ type: 'passive', passive: 'homing' }] }]);
    s.showPickups();
  })()`);
  const at = (tx, ty) => ({ x: (tx + 1.5) * 48, y: -432 + (ty + 1.5) * 48 });
  const standOn = async (tx, ty, ms) => {
    const p = at(tx, ty);
    await page.evaluate(`${scene()}.player.body.reset(${p.x}, ${p.y})`);
    await page.waitForTimeout(ms);
  };
  await standOn(6, 3, 150);
  console.log('right after opening:', await page.evaluate(`(() => { const s = ${scene()}; return {
    pickups: s.world.pickups.get('0,-1').map((p) => p.type + '@' + p.cell.x + ',' + p.cell.y), passives: s.world.player.passives }; })()`));
  const drop = await page.evaluate(`${scene()}.world.pickups.get('0,-1').find((p) => p.type === 'passive')?.cell`);
  if (!drop) throw new Error('no passive on the floor after opening the chest');
  await standOn(drop.x, drop.y, 100);
  console.log('passives right after opening the chest (expect []):', await page.evaluate(`${scene()}.world.player.passives`));
  await page.waitForTimeout(500);
  await standOn(6, 5, 50);
  await standOn(drop.x, drop.y, 150);
  console.log('passives after the lockout (expect [homing]):', await page.evaluate(`${scene()}.world.player.passives`));
}

if (scenario === 'rooms') {
  // Enters every normal and item room on one floor (SMOKE_FLOOR, default 0) and screenshots it with its enemies.
  // SMOKE_KINDS narrows it, e.g. `item`.
  const floor = Number(process.env.SMOKE_FLOOR ?? 0);
  const kinds = JSON.stringify((process.env.SMOKE_KINDS ?? 'normal,item').split(','));
  const ids = await page.evaluate(`[...${scene()}.world.rooms.values()]
    .filter((r) => r.floorIndex === ${floor} && ${kinds}.includes(r.floorRoom.kind))
    .map((r) => r.floorRoom.id)`);
  for (const id of ids) {
    const info = await page.evaluate(`(() => { const s = ${scene()};
      for (const e of s.enemies) for (const p of e.parts) p.destroy();
      s.enemies = [];
      for (const l of s.doorLocks) l.destroy();
      s.doorLocks = [];
      s.invincibleUntil = Infinity;
      const room = s.world.rooms.get('${id}');
      const door = room.layout.doors[0];
      s.player.body.reset(room.floorRoom.cell.x * 720 + (door.cell.x + 1.5) * 48, room.floorRoom.cell.y * 432 + (door.cell.y + 1.5) * 48);
      s.enterRoom(room, s.time.now);
      s.enemiesWakeAt = Infinity;
      return { archetype: room.layout.archetype, doors: room.layout.doors.map((d) => d.side).join(','), enemies: room.layout.enemies.map((e) => e.type).join(',') };
    })()`);
    await page.waitForTimeout(600);
    await shot(`room-f${floor}-${id.replace(',', '_')}`);
    console.log(id, JSON.stringify(info));
  }
}

if (scenario === 'floors') {
  // Screenshots themed rooms on every floor: the rooms with the most terrain (holes first), then the boss room.
  for (const floor of [0, 1, 2]) {
    const ids = await page.evaluate(`(() => {
      const rooms = [...${scene()}.world.rooms.values()].filter((r) => r.floorIndex === ${floor});
      const count = (r, t) => r.layout.tiles.flat().filter((x) => x === t).length;
      const normal = rooms.filter((r) => r.floorRoom.kind === 'normal')
        .sort((a, b) => count(b, 'hole') * 10 + count(b, 'obstacle') + count(b, 'rock') - (count(a, 'hole') * 10 + count(a, 'obstacle') + count(a, 'rock')));
      return [...normal.slice(0, 2), ...rooms.filter((r) => r.floorRoom.kind === 'boss')].map((r) => r.floorRoom.id);
    })()`);
    for (const id of ids) {
      const info = await page.evaluate(`(() => { const s = ${scene()};
        for (const e of s.enemies) for (const p of e.parts) p.destroy();
        s.enemies = [];
        for (const l of s.doorLocks) l.destroy();
        s.doorLocks = [];
        s.invincibleUntil = Infinity;
        const room = s.world.rooms.get('${id}');
        const door = room.layout.doors[0];
        s.player.body.reset(room.floorRoom.cell.x * 720 + (door.cell.x + 1.5) * 48, room.floorRoom.cell.y * 432 + (door.cell.y + 1.5) * 48);
        s.enterRoom(room, s.time.now);
        s.enemiesWakeAt = Infinity;
        return { kind: room.floorRoom.kind, archetype: room.layout.archetype };
      })()`);
      await page.waitForTimeout(600);
      await shot(`floor${floor}-${info.kind}-${id.replace(',', '_')}`);
      console.log(floor, id, JSON.stringify(info));
    }
  }
}

if (scenario === 'rocks') {
  // Finds a Stash room, shows its chest before clearing, and shoots the rock below it open.
  const id = await page.evaluate(`[...${scene()}.world.rooms.values()].find((r) => r.layout.archetype === 'stash')?.floorRoom.id`);
  if (!id) throw new Error('no stash room on this seed; try another SMOKE_SEED');
  const tileAt = (x, y) => page.evaluate(`${scene()}.world.rooms.get('${id}').layout.tiles[${y}][${x}]`);
  await page.evaluate(`(() => { const s = ${scene()};
    s.invincibleUntil = Infinity;
    const room = s.world.rooms.get('${id}');
    s.enterRoom(room, s.time.now);
    s.enemiesWakeAt = Infinity;
    const c = { x: room.floorRoom.cell.x * 720 + (6 + 1.5) * 48, y: room.floorRoom.cell.y * 432 + (5 + 1.5) * 48 };
    s.player.body.reset(c.x, c.y);
    s.world.player.passives = [];
  })()`);
  await page.waitForTimeout(500);
  await shot('02-stash');
  console.log('room', id, 'shown pickups before clear:', await page.evaluate(`${scene()}.pickupGroup.getChildren().length`), 'tile below chest:', await tileAt(6, 4));
  for (let i = 1; i <= 3; i++) {
    await hold('ArrowUp', 60);
    await page.waitForTimeout(450);
    console.log(`after shot ${i}: tile (6,4) =`, await tileAt(6, 4));
  }
  await shot('03-rock-broken');
  await hold('w', 500);
  console.log('walked in; pickups left:', await page.evaluate(`${scene()}.world.pickups.get('${id}').map((p) => p.type).join(',')`));
  await shot('04-chest');
}

if (scenario === 'bombs') {
  // In a Stash room: bomb the bottom of the box and run, then stand on a second bomb.
  const id = await page.evaluate(`[...${scene()}.world.rooms.values()].find((r) => r.layout.archetype === 'stash')?.floorRoom.id`);
  if (!id) throw new Error('no stash room on this seed; try another SMOKE_SEED');
  const row = (y) => page.evaluate(`${scene()}.world.rooms.get('${id}').layout.tiles[${y}].map((t) => t[0]).join('')`);
  const player = () => page.evaluate(`(() => { const s = ${scene()}; return { bombs: s.world.player.bombs, health: s.world.player.health }; })()`);
  await page.evaluate(`(() => { const s = ${scene()};
    const room = s.world.rooms.get('${id}');
    s.enterRoom(room, s.time.now);
    s.enemiesWakeAt = Infinity;
    const c = { x: room.floorRoom.cell.x * 720 + (6 + 1.5) * 48, y: room.floorRoom.cell.y * 432 + (5 + 1.5) * 48 };
    s.player.body.reset(c.x, c.y);
  })()`);
  await page.waitForTimeout(400);
  console.log('before:', await player(), 'row 4:', await row(4));
  await page.keyboard.press('e');
  await page.waitForTimeout(100);
  await shot('02-bomb-lit');
  await hold('a', 700);
  await page.waitForTimeout(1000);
  await shot('03-bomb-blast');
  console.log('after running clear:', await player(), 'row 4:', await row(4));
  await page.evaluate(`${scene()}.world.player.bombs = 1; ${scene()}.invincibleUntil = 0`);
  await page.keyboard.press('e');
  await page.waitForTimeout(1800);
  console.log('after standing on it (expect health -2, bombs 0):', await player());
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  console.log('pressing E with no bombs (expect bombs 0):', await player());
  await shot('04-hud');
}

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
