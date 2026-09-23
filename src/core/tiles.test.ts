import { describe, expect, it } from 'vitest';
import type { Tile } from './roomGenerator';
import { blocksShots, blocksSight, bombDestructible, flyersPass, hitsToBreak, hurtsOnTouch, isWalkable, phasingPasses, reflectsShots } from './tiles';

const ALL: Tile[] = ['floor', 'obstacle', 'rock', 'hole', 'thorn'];
const those = (holds: (t: Tile) => boolean) => ALL.filter(holds);

describe('tile table', () => {
  it('only floor is walkable', () => {
    expect(those(isWalkable)).toEqual(['floor']);
  });

  it('stone and rock stop shots and sight; holes do not', () => {
    expect(those(blocksShots)).toEqual(['obstacle', 'rock']);
    expect(those(blocksSight)).toEqual(['obstacle', 'rock']);
  });

  it('flyers cross floor, holes and thorns but not stone or rock', () => {
    expect(those(flyersPass)).toEqual(['floor', 'hole', 'thorn']);
  });

  it('phasing enemies pass through everything', () => {
    expect(those(phasingPasses)).toEqual(ALL);
  });

  it('only thorns hurt on touch; nothing reflects yet', () => {
    expect(those(hurtsOnTouch)).toEqual(['thorn']);
    expect(those(reflectsShots)).toEqual([]);
  });

  it('a thorn bush stops feet but not shots, sight or flyers, and never breaks', () => {
    expect(isWalkable('thorn')).toBe(false);
    expect(blocksShots('thorn')).toBe(false);
    expect(blocksSight('thorn')).toBe(false);
    expect(hitsToBreak('thorn')).toBeUndefined();
    expect(bombDestructible('thorn')).toBe(false);
  });

  it('rock breaks after three shots; nothing else breaks from shots', () => {
    expect(hitsToBreak('rock')).toBe(3);
    expect(those((t) => hitsToBreak(t) !== undefined)).toEqual(['rock']);
  });

  it('bombs destroy stone and rock but not holes', () => {
    expect(those(bombDestructible)).toEqual(['obstacle', 'rock']);
  });
});

describe('crusher tile', () => {
  it('is a solid block: not walked, flown or seen through, and it stops shots', () => {
    expect(isWalkable('crusher')).toBe(false);
    expect(flyersPass('crusher')).toBe(false);
    expect(blocksSight('crusher')).toBe(true);
    expect(blocksShots('crusher')).toBe(true);
  });

  it('only ghosts drift through it', () => {
    expect(phasingPasses('crusher')).toBe(true);
  });

  it('cannot be shot or bombed away, and hurts by sliding rather than on touch', () => {
    expect(hitsToBreak('crusher')).toBeUndefined();
    expect(bombDestructible('crusher')).toBe(false);
    expect(hurtsOnTouch('crusher')).toBe(false);
    expect(reflectsShots('crusher')).toBe(false);
  });
});
