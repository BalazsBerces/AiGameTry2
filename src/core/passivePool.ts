import { PASSIVE_POOL } from './roomGenerator';
import type { Rng } from './rng';
import type { Passive, PassiveLevels } from './weaponModel';

/** A passive the player doesn't own yet, at random; none once they own them all. */
export function offerPassive(owned: PassiveLevels, rng: Rng): Passive | undefined {
  const missing = PASSIVE_POOL.filter((p) => !owned[p]);
  return missing.length ? rng.pick(missing) : undefined;
}

/** The owned passive a boss kill upgrades: one still at level 1, at random; none if there is no such passive. */
export function pickUpgrade(owned: PassiveLevels, rng: Rng): Passive | undefined {
  const upgradable = PASSIVE_POOL.filter((p) => owned[p] === 1);
  return upgradable.length ? rng.pick(upgradable) : undefined;
}
