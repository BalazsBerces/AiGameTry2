import { describe, expect, it } from 'vitest';
import { PASSIVE_ART, passiveArtKey } from './passiveArt';

const loaded = (...keys: string[]) => ({ exists: (key: string) => keys.includes(key) });

describe('passiveArtKey', () => {
  it('gives the texture key of freeze and poison once their art is loaded', () => {
    const textures = loaded('freeze', 'poison');
    expect(passiveArtKey(textures, 'freeze')).toBe('freeze');
    expect(passiveArtKey(textures, 'poison')).toBe('poison');
  });

  it('gives nothing for a passive without art', () => {
    expect(passiveArtKey(loaded('freeze', 'poison', 'homing'), 'homing')).toBeUndefined();
  });

  it('gives nothing when the art failed to load', () => {
    expect(passiveArtKey(loaded('poison'), 'freeze')).toBeUndefined();
  });
});

describe('PASSIVE_ART', () => {
  it('lists freeze and poison PNGs under their current texture keys', () => {
    expect(PASSIVE_ART).toEqual([
      { passive: 'freeze', key: 'freeze', url: '/art/passives/freeze.png' },
      { passive: 'poison', key: 'poison', url: '/art/passives/poison.png' },
    ]);
  });
});
