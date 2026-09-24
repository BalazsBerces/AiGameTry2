import { describe, expect, it } from 'vitest';
import type { Tile } from './roomGenerator';
import { createRng } from './rng';
import {
  canHurtMaiden,
  createIronMaiden,
  IRON_MAIDEN,
  spikeAt,
  updateIronMaiden,
  type IronMaiden,
  type MaidenAttack,
} from './ironMaiden';

const open = (w: number, h: number): Tile[][] => Array.from({ length: h }, () => Array<Tile>(w).fill('floor'));

/** Runs the maiden from `from` to `to` in 20 ms frames; returns it and every attack it made. */
function run(maiden: IronMaiden, from: number, to: number, phaseTwo = false, tiles = open(20, 12)) {
  const rng = createRng(1);
  const attacks: { at: number; attack: MaidenAttack }[] = [];
  let m = maiden;
  for (let time = from; time <= to; time += 20) {
    const out = updateIronMaiden(m, { time, phaseTwo, aim: 0, player: { x: 10, y: 6 }, tiles, rng });
    m = out.maiden;
    for (const attack of out.attacks) attacks.push({ at: time, attack });
  }
  return { maiden: m, attacks };
}

describe('iron maiden cycle', () => {
  const { walkMs, telegraphMs, openMs } = IRON_MAIDEN;

  it('walks closed, stops to warn, opens, then closes and walks again', () => {
    const start = createIronMaiden(0);
    expect(start.phase).toBe('walk');
    expect(run(start, 0, walkMs + 10).maiden.phase).toBe('telegraph');
    expect(run(start, 0, walkMs + telegraphMs + 10).maiden.phase).toBe('open');
    expect(run(start, 0, walkMs + telegraphMs + openMs + 10).maiden.phase).toBe('walk');
  });

  it('stomps out an even ring of shots now and then while it walks, never while stopped', () => {
    const { attacks } = run(createIronMaiden(0), 0, walkMs + telegraphMs + openMs - 20);
    const stomps = attacks.filter((a) => a.attack.kind === 'stomp');
    expect(stomps.length).toBe(Math.floor(walkMs / IRON_MAIDEN.stompEveryMs));
    for (const s of stomps) {
      expect(s.at).toBeLessThan(walkMs);
      expect(s.attack.angles.length).toBe(IRON_MAIDEN.stompBullets);
    }
  });

  it('sprays fans of spikes aimed at the player while open, never while closed', () => {
    const { attacks } = run(createIronMaiden(0), 0, walkMs + telegraphMs + openMs - 20);
    const volleys = attacks.filter((a) => a.attack.kind === 'volley');
    expect(volleys.length).toBe(Math.ceil(openMs / IRON_MAIDEN.volleyEveryMs));
    for (const v of volleys) {
      expect(v.at).toBeGreaterThanOrEqual(walkMs + telegraphMs);
      expect(v.attack.angles.length).toBe(IRON_MAIDEN.volleyBullets);
      // Aimed at the player (angle 0 here): the fan is centred on it.
      const mean = v.attack.angles.reduce((s, a) => s + a, 0) / v.attack.angles.length;
      expect(mean).toBeCloseTo(0);
    }
  });

  it('spins its chains into spirals of shots while it walks in phase two only', () => {
    const chains = (phaseTwo: boolean) =>
      run(createIronMaiden(0), 0, walkMs - 20, phaseTwo).attacks.filter((a) => a.attack.kind === 'chain');
    expect(chains(false)).toEqual([]);
    const spun = chains(true);
    expect(spun.length).toBeGreaterThan(5);
    // The rings turn from one to the next.
    expect(spun[1].attack.angles[0]).not.toBeCloseTo(spun[0].attack.angles[0]);
  });

  it('drives spikes up through the floor around the player as it opens', () => {
    const tiles = open(20, 12);
    tiles[6][11] = 'obstacle';
    tiles[5][10] = 'hole';
    const { maiden } = run(createIronMaiden(0), 0, walkMs + telegraphMs + 10, false, tiles);
    expect(maiden.spikes.length).toBe(IRON_MAIDEN.spikeCount);
    const cells = maiden.spikes.map((s) => `${s.cell.x},${s.cell.y}`);
    expect(new Set(cells).size).toBe(cells.length);
    for (const s of maiden.spikes) {
      expect(Math.max(Math.abs(s.cell.x - 10), Math.abs(s.cell.y - 6))).toBeLessThanOrEqual(IRON_MAIDEN.spikeRadius);
      expect(tiles[s.cell.y][s.cell.x]).toBe('floor');
    }
  });

  it('marks each spike, then has it out, then bursts it into a ring of shots and is rid of it', () => {
    const opensAt = walkMs + telegraphMs;
    const { spikeWarnMs, spikeOutMs, spikeBullets } = IRON_MAIDEN;
    const { maiden } = run(createIronMaiden(0), 0, opensAt + 10);
    const spike = maiden.spikes[0];
    expect(spikeAt(spike, opensAt + spikeWarnMs - 10)).toBe('warning');
    expect(spikeAt(spike, opensAt + spikeWarnMs + 10)).toBe('out');
    const later = run(maiden, opensAt + 10, opensAt + spikeWarnMs + spikeOutMs + 30);
    const bursts = later.attacks.filter((a) => a.attack.kind === 'spike');
    expect(bursts.length).toBe(IRON_MAIDEN.spikeCount);
    for (const b of bursts) expect(b.attack.angles.length).toBe(spikeBullets);
    expect(later.maiden.spikes).toEqual([]);
  });

  it('leaves its spikes out longer in phase two', () => {
    const opensAt = walkMs + telegraphMs;
    const spikeOf = (phaseTwo: boolean) => run(createIronMaiden(0), 0, opensAt + 10, phaseTwo).maiden.spikes[0];
    const stillOut = opensAt + IRON_MAIDEN.spikeWarnMs + IRON_MAIDEN.spikeOutMs + 10;
    expect(spikeAt(spikeOf(false), stillOut)).toBe('gone');
    expect(spikeAt(spikeOf(true), stillOut)).toBe('out');
  });

  it('can only be hurt while open', () => {
    const at = (t: number) => canHurtMaiden(run(createIronMaiden(0), 0, t).maiden);
    expect(at(walkMs / 2)).toBe(false);
    expect(at(walkMs + telegraphMs / 2)).toBe(false);
    expect(at(walkMs + telegraphMs + openMs / 2)).toBe(true);
    expect(at(walkMs + telegraphMs + openMs + walkMs / 2)).toBe(false);
  });
});
