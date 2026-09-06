import { FILAMENTS, type Filament } from './catalog';
import { textColorForFilament } from './filament-appearance';
import { studioPresetFor } from './studio-project';
import { AMS_FRESH_MS, type AmsInventory, type AmsSlot } from './ams';

export function freshInventory(inventory: AmsInventory, now = Date.now()) {
  return (
    inventory.connected &&
    !inventory.stale &&
    inventory.updatedAt !== null &&
    now >= inventory.updatedAt &&
    now - inventory.updatedAt < AMS_FRESH_MS
  );
}

export function matchAmsSlot(slot: AmsSlot): Filament[] {
  if (
    slot.present !== true ||
    slot.reading ||
    !slot.productId ||
    !slot.material ||
    !slot.color
  )
    return [];
  return FILAMENTS.filter(
    (filament) =>
      filament.amsId === slot.productId &&
      filament.material === slot.material &&
      filament.colors.length === slot.colors.length &&
      filament.colors.every(
        (color, at) => color.toUpperCase() === slot.colors[at],
      ),
  );
}

export function textSpoolCandidates(
  body: Filament,
  inventory: AmsInventory,
  printer: string,
) {
  if (!freshInventory(inventory)) return [];
  const target = textColorForFilament(body.colors);
  return inventory.slots.flatMap((slot) => {
    // No nearest-color fallback: gray, transparent, or multicolor is not black/white.
    if (
      slot.present !== true ||
      slot.reading ||
      slot.color !== target ||
      slot.colors.length !== 1 ||
      slot.colors[0] !== target ||
      slot.material !== body.material
    )
      return [];
    const products = FILAMENTS.filter(
      (filament) =>
        filament.amsId === slot.productId &&
        filament.material === body.material,
    );
    const productNames = new Set(products.map((item) => item.product));
    if (productNames.size !== 1) return [];
    const filament = products[0];
    try {
      if (studioPresetFor(filament, printer).preset.isSupport === '1')
        return [];
    } catch {
      return [];
    }
    return [{ slot, product: filament.product }];
  });
}
