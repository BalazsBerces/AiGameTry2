import { describe, expect, it } from 'vitest';
import type { Tile } from './roomGenerator';
import { blocksShots, blocksSight, bombDestructible, flyersPass, hitsToBreak, hurtsOnTouch, isWalkable, phasingPasses, reflectsShots } from './tiles';

const ALL: Tile[] = ['floor', 'obstacle', 'rock', 'hole'];
const those = (holds: (t: Tile) => boolean) => ALL.filter(holds);

describe('tile table', () => {
  it('only floor is walkable', () => {
    expect(those(isWalkable)).toEqual(['floor']);
  });

  it('stone and rock stop shots and sight; holes do not', () => {
    expect(those(blocksShots)).toEqual(['obstacle', 'rock']);
    expect(those(blocksSight)).toEqual(['obstacle', 'rock']);
  });

  it('flyers cross floor and holes but not stone or rock', () => {
    expect(those(flyersPass)).toEqual(['floor', 'hole']);
  });

  it('phasing enemies pass through everything', () => {
    expect(those(phasingPasses)).toEqual(ALL);
  });

  it('no existing tile hurts or reflects', () => {
    expect(those(hurtsOnTouch)).toEqual([]);
    expect(those(reflectsShots)).toEqual([]);
  });

  it('rock breaks after three shots; nothing else breaks from shots', () => {
    expect(hitsToBreak('rock')).toBe(3);
    expect(those((t) => hitsToBreak(t) !== undefined)).toEqual(['rock']);
  });

  it('bombs destroy stone and rock but not holes', () => {
    expect(those(bombDestructible)).toEqual(['obstacle', 'rock']);
  });
});
