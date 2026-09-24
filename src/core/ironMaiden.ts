import { beats, fan, ring, spiral } from './bulletPatterns';
import type { Cell } from './floorGenerator';
import type { Tile } from './roomGenerator';
import type { Rng } from './rng';

/** Iron Maiden numbers; placeholders for playtest tuning. */
export const IRON_MAIDEN = {
  /** Closed and walking at the player for this long... */
  walkMs: 3200,
  /** ...then it stops and shudders this long before opening... */
  telegraphMs: 700,
  /** ...and stands open, firing, for this long. */
  openMs: 2200,
  /** While walking: a ring of this many shots every so often. */
  stompEveryMs: 1100,
  stompBullets: 10,
  /** While open: a fan of spikes at the player every so often, the first as it opens. */
  volleyEveryMs: 550,
  volleyBullets: 5,
  volleyWidth: (70 * Math.PI) / 180,
  /** Phase two, while walking: its swung chains throw a turning ring of shots every so often. */
  chainEveryMs: 180,
  chainArms: 3,
  chainSpinDegPerSec: 110,
  /** As it opens, spikes come up through the floor this near the player... */
  spikeCount: 4,
  spikeRadius: 3,
  /** ...marked this long, then out (hurting on touch) this long, longer in phase two... */
  spikeWarnMs: 650,
  spikeOutMs: 1400,
  spikeOutMsPhaseTwo: 2800,
  /** ...until they burst into a ring of this many shots. */
  spikeBullets: 6,
};

export type MaidenPhase = 'walk' | 'telegraph' | 'open';

export interface Spike {
  cell: Cell;
  placedAt: number;
  /** How long it stays out once up. */
  outMs: number;
}

export interface IronMaiden {
  phase: MaidenPhase;
  phaseStart: number;
  /** Everything up to this time has been played out. */
  lastTime: number;
  /** Floor spikes still to burst. */
  spikes: Spike[];
}

export type MaidenAttack = { kind: 'stomp' | 'volley' | 'chain'; angles: number[] } | { kind: 'spike'; cell: Cell; angles: number[] };

export interface MaidenInput {
  time: number;
  /** Below half its hit points. */
  phaseTwo: boolean;
  /** The angle toward the player. */
  aim: number;
  player: Cell;
  tiles: Tile[][];
  rng: Rng;
}

export const createIronMaiden = (time: number): IronMaiden => ({ phase: 'walk', phaseStart: time, lastTime: time, spikes: [] });

export type SpikeState = 'warning' | 'out' | 'gone';

/** A floor spike is marked, then out (it hurts to stand on), then gone, having burst. */
export function spikeAt(spike: Spike, time: number): SpikeState {
  const up = spike.placedAt + IRON_MAIDEN.spikeWarnMs;
  if (time < up) return 'warning';
  return time < up + spike.outMs ? 'out' : 'gone';
}

/** Up to `spikeCount` distinct floor cells near the player. */
function placeSpikes(input: MaidenInput, at: number): Spike[] {
  const { spikeCount, spikeRadius, spikeOutMs, spikeOutMsPhaseTwo } = IRON_MAIDEN;
  const pool: Cell[] = [];
  for (let dy = -spikeRadius; dy <= spikeRadius; dy++) {
    for (let dx = -spikeRadius; dx <= spikeRadius; dx++) {
      const c = { x: input.player.x + dx, y: input.player.y + dy };
      if (input.tiles[c.y]?.[c.x] === 'floor') pool.push(c);
    }
  }
  const spikes: Spike[] = [];
  while (spikes.length < spikeCount && pool.length) {
    const [cell] = pool.splice(input.rng.int(0, pool.length - 1), 1);
    spikes.push({ cell, placedAt: at, outMs: input.phaseTwo ? spikeOutMsPhaseTwo : spikeOutMs });
  }
  return spikes;
}

/** Hits only land while it stands open. */
export const canHurtMaiden = (maiden: IronMaiden) => maiden.phase === 'open';

const NEXT: Record<MaidenPhase, MaidenPhase> = { walk: 'telegraph', telegraph: 'open', open: 'walk' };
const LASTS: Record<MaidenPhase, number> = { walk: IRON_MAIDEN.walkMs, telegraph: IRON_MAIDEN.telegraphMs, open: IRON_MAIDEN.openMs };

/** The attacks a phase makes between `from` (exclusive) and `to` (inclusive), both inside it. */
function attacksDuring(phase: MaidenPhase, start: number, from: number, to: number, input: MaidenInput): MaidenAttack[] {
  const I = IRON_MAIDEN;
  // Ticks landing exactly on the phase's end belong to the next phase.
  const end = Math.min(to, start + LASTS[phase] - 1e-6);
  if (phase === 'walk') {
    const stomps = beats(start, I.stompEveryMs, I.stompEveryMs, from, end).map((): MaidenAttack => ({ kind: 'stomp', angles: ring(I.stompBullets) }));
    const chains = input.phaseTwo
      ? beats(start, I.chainEveryMs, I.chainEveryMs, from, end).map((t): MaidenAttack => ({ kind: 'chain', angles: spiral(I.chainArms, t, I.chainSpinDegPerSec) }))
      : [];
    return [...stomps, ...chains];
  }
  if (phase === 'open') {
    return beats(start, 0, I.volleyEveryMs, from, end).map(
      (): MaidenAttack => ({ kind: 'volley', angles: fan(input.aim, I.volleyBullets, I.volleyWidth) }),
    );
  }
  return [];
}

/** Advances the Iron Maiden to `input.time`: its new state and the attacks it makes this update. */
export function updateIronMaiden(maiden: IronMaiden, input: MaidenInput): { maiden: IronMaiden; attacks: MaidenAttack[] } {
  let m = maiden;
  const attacks: MaidenAttack[] = [];
  let from = m.lastTime;
  for (;;) {
    const end = m.phaseStart + LASTS[m.phase];
    attacks.push(...attacksDuring(m.phase, m.phaseStart, from, Math.min(input.time, end), input));
    if (input.time < end) break;
    from = end - 1e-6;
    m = { ...m, phase: NEXT[m.phase], phaseStart: end };
    if (m.phase === 'open') m = { ...m, spikes: [...m.spikes, ...placeSpikes(input, end)] };
  }
  const spikes = m.spikes.filter((s) => {
    if (spikeAt(s, input.time) !== 'gone') return true;
    attacks.push({ kind: 'spike', cell: s.cell, angles: ring(IRON_MAIDEN.spikeBullets) });
    return false;
  });
  return { maiden: { ...m, spikes, lastTime: input.time }, attacks };
}
