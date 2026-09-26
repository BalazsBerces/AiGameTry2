import type { Cell } from '../map/floorGenerator';
import { distanceField, floodFill, inBounds } from '../map/grid';
import { flyersPass, isWalkable } from '../map/tiles';
import { ENEMY_CHASE_SPEED, ENEMY_CLASS } from '../enemies/enemies';
import type { Door, EnemySpawn, Tile } from './roomGenerator';
import type { MirrorAxis } from './roomValidator';

/**
 * Room for the player to kite in. A trap pocket is floor reachable only through a single
 * one-tile-wide way in, big enough to be cornered in; `openTraps` knocks through the closed end of
 * each so it loops round. An escape route is a way out of a doorway that leads somewhere the
 * player reaches before any enemy can.
 */

/** Least floor behind a one-way-in entrance for it to be a trap (a tile or two is just a nook). */
export const TRAP_SIZE = 3;

/**
 * Kiting sums, placeholders for playtest tuning: the player's speed (its start speed, 190px/s),
 * how long enemies hold still after the player walks in, how much sooner the player must reach a
 * tile than any enemy for it to count as clear, and how far a way out must lead.
 */
export const KITING = { playerSpeed: 4, wakeSeconds: 0.5, marginSeconds: 0.25, escapeDistance: 4, routesPerDoor: 2 };

const STEPS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const key = (c: Cell) => `${c.x},${c.y}`;
const walkableAt = (tiles: Tile[][], c: Cell) => inBounds(tiles, c) && isWalkable(tiles[c.y][c.x]);

/**
 * The bridges of the walkable grid (edges no loop runs through), each with what lies beyond it:
 * the depth-first subtree under its far end, counted as tiles and as tiles beside a doorway, and
 * the whole connected area it belongs to, counted the same way.
 */
interface Bridge {
  near: number;
  far: number;
  beyond: { size: number; byDoor: number };
  area: { size: number; byDoor: number };
}

/** The four neighbours of tile `i` on a grid `width` wide, -1 off its edge. */
const neighbours = (i: number, width: number, cells: number) => {
  const x = i % width;
  return [x + 1 < width ? i + 1 : -1, x > 0 ? i - 1 : -1, i + width < cells ? i + width : -1, i - width];
};

function bridges(walkable: Uint8Array, width: number, byDoor: Uint8Array): Bridge[] {
  const cells = walkable.length;
  const disc = new Int32Array(cells).fill(-1);
  const low = new Int32Array(cells);
  const size = new Int32Array(cells);
  const doorCount = new Int32Array(cells);
  const parent = new Int32Array(cells).fill(-1);
  const next = new Uint8Array(cells);
  const found: (Omit<Bridge, 'area'> & { root: number })[] = [];
  const areas = new Map<number, { size: number; byDoor: number }>();
  let time = 0;
  // Iterative DFS (Tarjan), so big rooms never overflow the stack.
  for (let root = 0; root < cells; root++) {
    if (!walkable[root] || disc[root] >= 0) continue;
    const stack = [root];
    disc[root] = low[root] = time++;
    size[root] = 1;
    doorCount[root] = byDoor[root];
    while (stack.length) {
      const i = stack[stack.length - 1];
      if (next[i] < 4) {
        const n = neighbours(i, width, cells)[next[i]++];
        if (n < 0 || !walkable[n] || n === parent[i]) continue;
        if (disc[n] >= 0) low[i] = Math.min(low[i], disc[n]);
        else {
          disc[n] = low[n] = time++;
          parent[n] = i;
          size[n] = 1;
          doorCount[n] = byDoor[n];
          stack.push(n);
        }
        continue;
      }
      stack.pop();
      const p = parent[i];
      if (p < 0) continue;
      low[p] = Math.min(low[p], low[i]);
      size[p] += size[i];
      doorCount[p] += doorCount[i];
      if (low[i] > disc[p]) found.push({ near: p, far: i, beyond: { size: size[i], byDoor: doorCount[i] }, root });
    }
    areas.set(root, { size: size[root], byDoor: doorCount[root] });
  }
  return found.map(({ root, ...b }) => ({ ...b, area: areas.get(root)! }));
}

/** The walkable tiles reachable from `from` without crossing the edge to `not`, as cells. */
function side(walkable: Uint8Array, width: number, from: number, not: number): Cell[] {
  const seen = new Uint8Array(walkable.length);
  seen[from] = 1;
  const out = [from];
  for (let q = 0; q < out.length; q++) {
    for (const n of neighbours(out[q], width, walkable.length)) {
      if (n < 0 || !walkable[n] || seen[n] || (q === 0 && n === not)) continue;
      seen[n] = 1;
      out.push(n);
    }
  }
  return out.map((i) => ({ x: i % width, y: Math.floor(i / width) }));
}

/**
 * Every trap pocket: TRAP_SIZE or more walkable tiles reachable only through a single one-tile
 * way in (the side of a bridge away from every door), largest pockets only, never one holding a
 * `den` tile (an enemy pen that is meant to have one opening).
 */
export function trapPockets(tiles: Tile[][], doors: readonly Door[], dens: readonly Cell[] = []): Cell[][] {
  const denKeys = new Set(dens.map(key));
  const width = tiles[0].length;
  const cells = tiles.length * width;
  // Doorways are ways out, not floor to be cornered on: leave them out, and call the side they open onto the door's.
  const walkable = new Uint8Array(cells);
  tiles.forEach((row, y) => row.forEach((t, x) => (walkable[y * width + x] = isWalkable(t) ? 1 : 0)));
  const byDoor = new Uint8Array(cells);
  for (const d of doors) {
    const i = d.cell.y * width + d.cell.x;
    walkable[i] = 0;
    for (const n of neighbours(i, width, cells)) if (n >= 0) byDoor[n] = 1;
  }
  const pockets = bridges(walkable, width, byDoor)
    .flatMap(({ near, far, beyond, area }) => {
      // A dead end is the smaller side, one no door opens into; a bridge with doors both sides is
      // just a narrow way through, and the room beyond a narrow doorway is the room itself.
      const rest = { size: area.size - beyond.size, byDoor: area.byDoor - beyond.byDoor };
      const [pocketSide, restSide, from, not] = beyond.size <= rest.size ? [beyond, rest, far, near] : [rest, beyond, near, far];
      if (pocketSide.size < TRAP_SIZE || pocketSide.byDoor > 0 || restSide.byDoor === 0) return [];
      return [side(walkable, width, from, not)];
    })
    .filter((p) => !p.some((c) => denKeys.has(key(c))))
    .sort((p, q) => q.length - p.length);
  // Keep only the outermost: a pocket inside a bigger one is the same trap.
  const kept: Cell[][] = [];
  for (const p of pockets) {
    const inside = kept.some((k) => {
      const ks = new Set(k.map(key));
      return p.every((c) => ks.has(key(c)));
    });
    if (!inside) kept.push(p);
  }
  return kept;
}

/** Terrain the opener may knock through: stone, rock and the like, never room wall, holes or crushers. */
const OPENABLE: ReadonlySet<Tile> = new Set(['obstacle', 'rock', 'crystal', 'glowshroom', 'thorn']);

/** A cell and its images across the axes. */
function images(c: Cell, width: number, height: number, axes: readonly MirrorAxis[]): Cell[] {
  let out = [c];
  for (const axis of axes) {
    out = out.flatMap((p) => [p, axis === 'vertical' ? { x: width - 1 - p.x, y: p.y } : { x: p.x, y: height - 1 - p.y }]);
  }
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(key(p)) && !!seen.add(key(p)));
}

/**
 * The tiles with every trap pocket opened up: at each, the barrier tile at the pocket's closed
 * end (farthest from its way in) that joins it to other floor is knocked through, with its images
 * across the axes so the room stays mirrored, until no trap is left. Undefined if some trap has
 * nothing that may be knocked through. A room with no traps comes back as it was.
 */
export function openTraps(tiles: Tile[][], doors: readonly Door[], axes: readonly MirrorAxis[], dens: readonly Cell[] = []): Tile[][] | undefined {
  let out = tiles;
  const height = tiles.length;
  const width = tiles[0].length;
  for (let round = 0; round < 32; round++) {
    const [pocket] = trapPockets(out, doors, dens);
    if (!pocket) return out;
    const inPocket = new Set(pocket.map(key));
    // Depth into the pocket, from its way in (the pocket tile touching the rest of the floor).
    const mouth = pocket.find((c) => STEPS.some((s) => {
      const n = { x: c.x + s.x, y: c.y + s.y };
      return walkableAt(out, n) && !inPocket.has(key(n));
    }))!;
    const depth = distanceField(out, mouth, isWalkable);
    const current = out;
    // Only ever onto floor the doors lead to, never into somewhere sealed on purpose (a tomb, an island).
    const reached = new Set(doors.flatMap((d) => [...floodFill(current, d.cell, isWalkable)]));
    const candidates = pocket
      .flatMap((c) => STEPS.map((s) => ({ from: c, at: { x: c.x + s.x, y: c.y + s.y } })))
      .filter(({ at }) => inBounds(current, at) && OPENABLE.has(current[at.y][at.x]))
      // It must lead through to floor outside the pocket, straight across the barrier.
      .filter(({ from, at }) => {
        const beyond = { x: at.x + (at.x - from.x), y: at.y + (at.y - from.y) };
        const sealsOff = STEPS.some((s) => {
          const n = { x: at.x + s.x, y: at.y + s.y };
          return walkableAt(current, n) && !reached.has(key(n));
        });
        return reached.has(key(beyond)) && !inPocket.has(key(beyond)) && !sealsOff;
      })
      .sort((a, b) => depth[b.from.y][b.from.x] - depth[a.from.y][a.from.x]);
    if (!candidates.length) return undefined;
    const next = current.map((row) => [...row]);
    for (const c of images(candidates[0].at, width, height, axes)) if (OPENABLE.has(next[c.y][c.x])) next[c.y][c.x] = 'floor';
    out = next;
  }
  return trapPockets(out, doors, dens).length ? undefined : out;
}

/**
 * For each door, how many ways out of it lead somewhere: first steps into the room from the
 * doorway whose clear tiles (ones the player reaches sooner than any enemy, by KITING's margin)
 * stretch at least KITING.escapeDistance steps from the door. Walkers are timed by the walking
 * distance, flyers by the straight line, over holes; enemies hold still for KITING.wakeSeconds.
 */
export function escapeRoutes(tiles: Tile[][], doors: readonly Door[], enemies: readonly EnemySpawn[]): number[] {
  const width = tiles[0].length;
  const cells = tiles.length * width;
  const walkable = new Uint8Array(cells);
  tiles.forEach((row, y) => row.forEach((t, x) => (walkable[y * width + x] = isWalkable(t) ? 1 : 0)));
  // The soonest any enemy can be on each tile, in seconds. Walkers of a kind share a speed, so
  // one search from all of them at once serves the lot.
  const threat = new Float64Array(cells).fill(Infinity);
  const walkersBySpeed = new Map<number, Cell[]>();
  for (const e of enemies) {
    const speed = ENEMY_CHASE_SPEED[e.type];
    if (!speed) continue;
    const cls = ENEMY_CLASS[e.type];
    if (cls === 'walker') {
      walkersBySpeed.set(speed, [...(walkersBySpeed.get(speed) ?? []), e.cell, ...(e.tail ?? [])]);
      continue;
    }
    tiles.forEach((row, y) =>
      row.forEach((tile, x) => {
        if (cls !== 'phasing' && !flyersPass(tile)) return;
        const t = KITING.wakeSeconds + Math.hypot(x - e.cell.x, y - e.cell.y) / speed;
        if (t < threat[y * width + x]) threat[y * width + x] = t;
      }),
    );
  }
  for (const [speed, from] of walkersBySpeed) {
    const dist = steps(walkable, width, from);
    for (let i = 0; i < cells; i++) if (dist[i] >= 0) threat[i] = Math.min(threat[i], KITING.wakeSeconds + dist[i] / speed);
  }
  return doors.map((door) => {
    const fromDoor = steps(walkable, width, [door.cell]);
    const clear = (i: number) => walkable[i] === 1 && fromDoor[i] >= 0 && fromDoor[i] / KITING.playerSpeed + KITING.marginSeconds < threat[i];
    const doorIndex = door.cell.y * width + door.cell.x;
    let routes = 0;
    for (const s of STEPS) {
      const first = { x: door.cell.x + s.x, y: door.cell.y + s.y };
      if (!inBounds(tiles, first) || !clear(first.y * width + first.x)) continue;
      // Clear tiles reachable from this first step, never back through the doorway.
      const seen = new Uint8Array(cells);
      seen[doorIndex] = 1;
      const queue = [first.y * width + first.x];
      seen[queue[0]] = 1;
      let leads = false;
      for (let q = 0; q < queue.length && !leads; q++) {
        const i = queue[q];
        if (fromDoor[i] >= KITING.escapeDistance) leads = true;
        const x = i % width;
        for (const n of [x + 1 < width ? i + 1 : -1, x > 0 ? i - 1 : -1, i + width < cells ? i + width : -1, i - width]) {
          if (n < 0 || seen[n] || !clear(n)) continue;
          seen[n] = 1;
          queue.push(n);
        }
      }
      if (leads) routes++;
    }
    return routes;
  });
}

/** Walking steps from the nearest of `from` to every tile, -1 where none reaches. */
function steps(walkable: Uint8Array, width: number, from: readonly Cell[]): Int32Array {
  const cells = walkable.length;
  const dist = new Int32Array(cells).fill(-1);
  const queue: number[] = [];
  for (const c of from) {
    const i = c.y * width + c.x;
    if (dist[i] < 0) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % width;
    for (const n of [x + 1 < width ? i + 1 : -1, x > 0 ? i - 1 : -1, i + width < cells ? i + width : -1, i - width]) {
      if (n < 0 || dist[n] >= 0 || !walkable[n]) continue;
      dist[n] = dist[i] + 1;
      queue.push(n);
    }
  }
  return dist;
}
