import { AMS_FRESH_MS, type AmsInventory } from './ams';
import { freshInventory } from './ams-matching';
import type { HostedCloudState } from './cloud-ams';

export const formatReadWait = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;

/** One mutually exclusive status; never show an old sign-in message beside a fresh read. */
export function connectionStatus(
  state: HostedCloudState,
  printer: string,
  now: number,
  hasLabelChoices = false,
) {
  if (!printer)
    return {
      kind: 'select',
      title: 'Choose your printer',
      detail: 'Then read its loaded spools.',
    };
  if (state.pending)
    return {
      kind: 'reading',
      title: 'Reading your AMS…',
      detail: 'This can take up to a minute.',
    };
  if (printer !== state.selectedSerial || state.inventory.updatedAt === null) {
    if (printer === state.selectedSerial && !state.inventory.connected)
      return {
        kind: 'offline',
        title: 'Couldn’t read your AMS',
        detail:
          state.inventory.message === 'Sign in to read your AMS.'
            ? 'Check that your printer is online, then try again.'
            : state.inventory.message ||
              'Check that your printer is online, then try again.',
      };
    return {
      kind: 'ready',
      title: 'Ready to read',
      detail: 'Read once to get your label choices.',
    };
  }
  const snapshot = snapshotStatus(state.inventory, now);
  return snapshot.fresh
    ? {
        kind: 'fresh',
        title: 'Spools ready',
        detail:
          'Choose a label below. You can come back for more without another read.',
      }
    : {
        kind: 'expired',
        title: hasLabelChoices
          ? 'Label choices ready'
          : 'Live snapshot expired',
        detail: hasLabelChoices
          ? 'Keep making labels below. Refresh only if spools changed.'
          : 'Refresh when available, or choose filament manually.',
      };
}

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
