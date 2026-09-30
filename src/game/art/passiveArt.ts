import type { Passive } from '../../core/player/weaponModel';

/** A passive drawn from its own PNG instead of the tinted paper star. */
export interface PassiveArt {
  passive: Passive;
  key: string;
  url: string;
}

/** Every passive with custom art; the boot scene loads each one. */
export const PASSIVE_ART: readonly PassiveArt[] = [
  { passive: 'freeze', key: 'freeze', url: '/art/passives/freeze.png' },
  { passive: 'poison', key: 'poison', url: '/art/passives/poison.png' },
];

/** The passive's art texture key, or undefined if it has no art or the art did not load. */
export function passiveArtKey(textures: { exists(key: string): boolean }, passive: Passive): string | undefined {
  const key = PASSIVE_ART.find((a) => a.passive === passive)?.key;
  return key !== undefined && textures.exists(key) ? key : undefined;
}
