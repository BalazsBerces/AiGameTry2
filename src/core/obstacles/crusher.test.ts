import { describe, expect, it } from 'vitest';
import type { Cell } from '../map/floorGenerator';
import { crusherWakes, slideCrusher, type CrusherAxis } from './crusher';
import type { Tile } from '../rooms/roomGenerator';

/** `.` floor, `#` stone, `o` hole, `C` crusher, `P` the player (on floor). */
function grid(picture: string) {
  const rows = picture.trim().split('\n').map((r) => r.trim());
  const crushers: Cell[] = [];
  let player: Cell | undefined;
  const tiles = rows.map((row, y) =>
    [...row].map((ch, x): Tile => {
      if (ch === 'C') crushers.push({ x, y });
      if (ch === 'P') player = { x, y };
      return ch === '#' ? 'obstacle' : ch === 'o' ? 'hole' : ch === 'C' ? 'crusher' : 'floor';
    }),
  );
  return { tiles, crusher: crushers[0], player: player! };
}

describe('crusher slide', () => {
  it('sweeps every cell up to the room edge and stops on the last one', () => {
    const { tiles, crusher } = grid(`
      .C....
    `);
    expect(slideCrusher(tiles, crusher, 'right')).toEqual({
      swept: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }],
      stop: { x: 5, y: 0 },
    });
    expect(slideCrusher(tiles, crusher, 'left')).toEqual({ swept: [{ x: 0, y: 0 }], stop: { x: 0, y: 0 } });
  });

  it('stops just before stone, a hole or another crusher', () => {
    for (const blocker of ['#', 'o', 'C']) {
      const { tiles } = grid(`
        .
        C
        .
        .
        ${blocker}
        .
      `);
      expect(slideCrusher(tiles, { x: 0, y: 1 }, 'down'), blocker).toEqual({
        swept: [{ x: 0, y: 2 }, { x: 0, y: 3 }],
        stop: { x: 0, y: 3 },
      });
    }
  });

  it('stays put when something is right next to it', () => {
    const { tiles, crusher } = grid(`
      #C..
    `);
    expect(slideCrusher(tiles, crusher, 'left')).toEqual({ swept: [], stop: crusher });
  });
});

describe('crusher wakes', () => {
  const wakes = (picture: string, axis: CrusherAxis) => {
    const { tiles, crusher, player } = grid(picture);
    return crusherWakes(tiles, { cell: crusher, axis }, player);
  };

  it('toward a player in clear line along its axis', () => {
    expect(wakes(`
      ......
      .C..P.
      ......
    `, 'horizontal')).toBe('right');
    expect(wakes(`
      .P....
      ......
      .C....
    `, 'vertical')).toBe('up');
  });

  it('not for a player in line across its axis', () => {
    expect(wakes(`
      .P....
      ......
      .C....
    `, 'horizontal')).toBeUndefined();
  });

  it('not for a player on a diagonal', () => {
    expect(wakes(`
      ......
      .C....
      ..P...
    `, 'horizontal')).toBeUndefined();
    expect(wakes(`
      ....P.
      ......
      .C....
    `, 'vertical')).toBeUndefined();
  });

  it('not when the line is blocked', () => {
    expect(wakes(`
      ......
      .C.#P.
      ......
    `, 'horizontal')).toBeUndefined();
  });

  it('across a hole it cannot slide over, since the player is in plain sight', () => {
    expect(wakes(`
      ......
      .C.oP.
      ......
    `, 'horizontal')).toBe('right');
  });
});
