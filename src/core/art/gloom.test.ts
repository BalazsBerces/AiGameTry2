import { describe, expect, it } from 'vitest';
import type { Tile } from '../rooms/roomGenerator';
import { geodeLook, type Action } from './characters';
import { GLOOM, PULSE, WALL_SHADE, geodeLight, glowersOf, isGloomy, pulse, type GlowRoom } from './gloom';
import { TILE, wallGems } from './terrain';

const CAVES = 1;

/** `C` crystal, `G` glowshroom, `M` giant mushroom (obstacle), `r` mushroom cap (rock), `.` floor. */
const tilesOf = (rows: string[]): Tile[][] =>
  rows.map((row) => [...row].map((c) => ({ C: 'crystal', G: 'glowshroom', M: 'obstacle', r: 'rock', '.': 'floor' })[c] as Tile));
const HOLLOW_LOOKS: Partial<Record<Tile, string>> = { crystal: 'crystal cluster', glowshroom: 'glowshroom', obstacle: 'giant mushroom', rock: 'mushroom cap' };
const room = (rows: string[], extra: Partial<GlowRoom> = {}): GlowRoom => ({ tiles: tilesOf(rows), lookOf: (t) => HOLLOW_LOOKS[t], decor: [], walls: [], ...extra });

describe("a room's glowers", () => {
  it('lights one per crystal cluster, crystal spire, glowshroom and giant mushroom (and mushroom cap), in their colours', () => {
    const glowers = glowersOf(room(['C.G', 'M.C']));
    expect(glowers.filter((g) => g.tint === 'cyan')).toHaveLength(2);
    expect(glowers.filter((g) => g.tint === 'violet')).toHaveLength(1);
    expect(glowers.filter((g) => g.tint === 'plum')).toHaveLength(1);
    expect(glowers).toHaveLength(4);
    const spires = glowersOf(room(['C'], { lookOf: () => 'crystal spire' }));
    expect(spires.map((g) => g.tint)).toEqual(['cyan']);
  });

  it('sits each on its tile', () => {
    const [g] = glowersOf(room(['..', '.G']));
    expect(Math.floor(g.x / TILE)).toBe(1);
    expect(Math.floor(g.y / TILE)).toBe(1);
  });

  it('lights giant mushrooms and mushroom caps a deep plum, the glowshroom alone violet and brightest', () => {
    const [glowshroom] = glowersOf(room(['G']));
    const [giant] = glowersOf(room(['M']));
    const [cap] = glowersOf(room(['r']));
    expect(glowshroom.tint).toBe('violet');
    for (const g of [giant, cap]) {
      expect(g.tint).toBe('plum');
      expect(g.intensity).toBeGreaterThan(0);
      expect(g.intensity).toBeLessThan(glowshroom.intensity);
    }
    expect(cap.radius).toBeLessThan(giant.radius);
  });

  it('leaves rock and bare floor unlit', () => {
    expect(glowersOf(room(['...', '...']))).toEqual([]);
    expect(glowersOf(room(['r'], { lookOf: () => 'loose rock' }))).toEqual([]);
  });

  it('loses the light of a glower whose tile broke', () => {
    const tiles = tilesOf(['G.', '.C']);
    expect(glowersOf({ ...room([]), tiles })).toHaveLength(2);
    tiles[0][0] = 'floor';
    expect(glowersOf({ ...room([]), tiles })).toHaveLength(1);
  });

  it('lets glints, spores and lying shards glow faintly, other decor not at all', () => {
    const decor = ['glints', 'spores', 'shards', 'pebbles', 'bones', 'caps'].map((kind, x) => ({ kind, cell: { x, y: 0 } }));
    const faint = glowersOf(room(['......'], { decor }));
    expect(faint.map((g) => g.tint)).toEqual(['cyan', 'violet', 'cyan']);
    const crystal = glowersOf(room(['C'], { lookOf: () => 'crystal spire' }))[0];
    for (const g of faint) {
      expect(g.intensity).toBeLessThan(crystal.intensity / 2);
      expect(g.radius).toBeLessThan(crystal.radius / 2);
    }
  });

  it('lights each wall gem faintly where its veined wall piece sets it, none in a strata wall', () => {
    const walls = (['top', 'bottom', 'left', 'right', 'corner'] as const).flatMap((side, i) => [0, 1, 2, 3].map((variant) => ({ cell: { x: variant, y: -1 - i }, side, variant })));
    const gems = walls.flatMap((w) => wallGems(w.side, w.variant).map((g) => ({ x: (w.cell.x + 0.5) * TILE + g.x, y: (w.cell.y + 0.5) * TILE + g.y })));
    expect(gems.length).toBeGreaterThan(0);
    const lit = glowersOf(room([], { walls, veined: true }));
    expect(lit.map((g) => ({ x: g.x, y: g.y }))).toEqual(gems);
    for (const g of lit) expect(g.tint).toBe('cyan');
    expect(glowersOf(room([], { walls, veined: false }))).toEqual([]);
  });

  it('gives neighbours seeds of their own, so they breathe out of step', () => {
    const seeds = glowersOf(room(['CCC', 'GGG'])).map((g) => g.seed);
    expect(new Set(seeds).size).toBe(6);
  });

  it("lights a small crystal cluster less far than a tall crystal spire, its glowing core smaller too", () => {
    const [cluster] = glowersOf(room(['C']));
    const [spire] = glowersOf(room(['C'], { lookOf: () => 'crystal spire' }));
    expect(cluster.radius).toBeLessThan(spire.radius);
    expect(cluster.core).toBeLessThan(spire.core);
  });
});

describe('how dark the gloom is', () => {
  it('is lighter than it was, but still there', () => {
    expect(GLOOM.alpha).toBeGreaterThan(0);
    expect(GLOOM.alpha).toBeLessThan(0.55);
  });

  it('still shades the rock round the room deeper, just less heavily', () => {
    for (const band of WALL_SHADE.bands) {
      expect(band).toBeGreaterThan(0);
      expect(band).toBeLessThan(0.12);
    }
  });
});

describe("a geode's light", () => {
  const SHUT: [Action, number] = ['idle', 0];
  const OPEN: [Action, number] = ['attack', 1];
  const [cluster] = glowersOf(room(['C']));

  it('is cyan, like the crystal it is', () => {
    for (const [a, f] of [SHUT, OPEN, ['attack', 2] as [Action, number]]) expect(geodeLight(a, f).tint).toBe('cyan');
  });

  it('seeps faintly while shut, and spreads about as far as a crystal cluster once open', () => {
    const shut = geodeLight(...SHUT);
    const open = geodeLight(...OPEN);
    expect(shut.radius).toBeLessThan(open.radius);
    expect(shut.intensity).toBeLessThan(open.intensity);
    expect(shut.core).toBeLessThan(open.core);
    expect(Math.abs(open.radius - cluster.radius)).toBeLessThanOrEqual(10);
    expect(open.core).toBeLessThan(open.radius / 2);
  });

  it('swells across the charge and flares brightest as it fires', () => {
    const charge = [0, 1, 2].map((f) => geodeLight('attack', f).intensity);
    expect(charge[0]).toBeGreaterThan(geodeLight('idle', 1).intensity);
    expect(charge[1]).toBeGreaterThan(charge[0]);
    expect(charge[2]).toBeGreaterThan(charge[1]);
    expect(charge[2]).toBeLessThanOrEqual(1);
  });

  it('follows the glow its art draws: pulsing with it at rest, dipping when hurt', () => {
    const rest = [0, 1].map((f) => ({ light: geodeLight('idle', f).intensity, glow: geodeLook('idle', f).glow }));
    expect(rest[0].light / rest[0].glow).toBeCloseTo(rest[1].light / rest[1].glow);
    expect(Math.sign(rest[1].light - rest[0].light)).toBe(Math.sign(rest[1].glow - rest[0].glow));
    expect(geodeLight('hurt', 0).intensity).toBeLessThan(Math.min(...rest.map((r) => r.light)));
  });
});

describe("a geode's glow", () => {
  it('is the same for the same action and frame', () => {
    for (const [a, f] of [['idle', 0], ['attack', 2], ['hurt', 0]] as [Action, number][]) expect(geodeLook(a, f)).toEqual(geodeLook(a, f));
  });

  it('rises across the charge, highest as it fires, and opens on its core part way through', () => {
    const charge = [0, 1, 2].map((f) => geodeLook('attack', f));
    expect(charge[1].glow).toBeGreaterThan(charge[0].glow);
    expect(charge[2].glow).toBeGreaterThan(charge[1].glow);
    expect(charge.map((c) => c.open > 0.5)).toEqual([false, true, true]);
    expect(geodeLook('idle', 0).open).toBe(0);
  });
});

describe('which rooms are gloomy', () => {
  it('puts every caves room under the gloom: start, item, normal and cleared alike', () => {
    expect(isGloomy({ floorIndex: CAVES, enemies: [] })).toBe(true);
    expect(isGloomy({ floorIndex: CAVES, enemies: [{ type: 'ghoul' }, { type: 'geode' }] })).toBe(true);
  });

  it("leaves the worm boss's arena fully lit", () => {
    expect(isGloomy({ floorIndex: CAVES, enemies: [{ type: 'wormBoss' }] })).toBe(false);
  });

  it('leaves the forest and the dungeon as they are', () => {
    expect(isGloomy({ floorIndex: 0, enemies: [] })).toBe(false);
    expect(isGloomy({ floorIndex: 2, enemies: [] })).toBe(false);
    expect(isGloomy({ floorIndex: 2, enemies: [{ type: 'candleWitch' }] })).toBe(false);
  });
});

describe('the pulse', () => {
  const times = Array.from({ length: 3000 }, (_, i) => i * 23);

  it('never leaves its bounds, so a light pool never vanishes', () => {
    for (const seed of [0, 1, 7, 12345]) {
      for (const t of times) {
        const p = pulse(seed, t);
        expect(p).toBeGreaterThanOrEqual(PULSE.min);
        expect(p).toBeLessThanOrEqual(PULSE.max);
      }
    }
    expect(PULSE.min).toBeGreaterThan(0);
  });

  it('is the same for the same seed at the same moment', () => {
    for (const t of [0, 1234, 99_999]) expect(pulse(7, t)).toBe(pulse(7, t));
  });

  it('breathes slowly: a few seconds from one swell to the next', () => {
    // Count the swells (local peaks) over a minute: a 3-5 s breath gives 12-20.
    const samples = Array.from({ length: 600 }, (_, i) => pulse(5, i * 100));
    const peaks = samples.filter((v, i) => i > 0 && i < samples.length - 1 && v > samples[i - 1] && v >= samples[i + 1]).length;
    expect(peaks).toBeGreaterThanOrEqual(11);
    expect(peaks).toBeLessThanOrEqual(21);
  });

  it('keeps neighbours out of step with each other', () => {
    for (const seed of [1, 2, 3, 40]) {
      const apart = times.filter((t) => Math.abs(pulse(seed, t) - pulse(seed + 1, t)) > 0.02).length;
      expect(apart / times.length, `seeds ${seed} and ${seed + 1}`).toBeGreaterThan(0.5);
    }
  });
});
