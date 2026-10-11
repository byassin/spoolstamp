import { AMS_FRESH_MS, type AmsInventory } from './ams';
import { freshInventory } from './ams-matching';

export function snapshotStatus(inventory: AmsInventory | null, now: number) {
  if (!inventory || inventory.updatedAt === null || inventory.updatedAt > now)
    return {
      fresh: false,
      text: 'No current AMS snapshot. Read your printer to choose loaded spools.',
    };
  const age = Math.floor((now - inventory.updatedAt) / 1000);
  const fresh = freshInventory(inventory, now);
  const elapsed =
    age < 60 ? `${age}s` : `${Math.floor(age / 60)}m ${age % 60}s`;
  return {
    fresh,
    text: `Last read ${elapsed} ago · ${fresh ? `${Math.max(0, Math.ceil((AMS_FRESH_MS - now + inventory.updatedAt) / 1000))}s left to choose or save loaded labels` : 'not current inventory; saved drafts are still available'}`,
  };
}

/** Bound service-state polling during an outage; never retry email/login/printer reads. */
export function cloudPollDelay(failures: number) {
  return Math.min(60_000, 5_000 * 2 ** Math.min(4, Math.max(0, failures)));
}
