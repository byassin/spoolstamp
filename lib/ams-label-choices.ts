import { type AmsInventory } from './ams';
import { type Filament } from './catalog';
import { freshInventory, matchAmsSlot } from './ams-matching';

/** Capture catalog choices only while fresh. No slot, printer, quantity or timestamp is retained. */
export function captureLabelChoices(
  inventory: AmsInventory,
  now = Date.now(),
): Filament[] {
  if (!freshInventory(inventory, now)) return [];
  const choices = new Map<string, Filament>();
  for (const slot of inventory.slots) {
    const matches = matchAmsSlot(slot);
    if (matches.length === 1) choices.set(matches[0].id, matches[0]);
  }
  return [...choices.values()];
}
