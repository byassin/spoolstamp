import {
  DEFAULT_FILAMENT,
  DEFAULT_PRINTER,
  DESIGNS,
  FILAMENTS,
  FILAMENTS_BY_PRODUCT,
  PRINTERS,
  type DesignId,
  type Filament,
} from '@/lib/catalog';
import { resolveTextFilament } from '@/lib/text-filament';

export type BuilderConfiguration = {
  filament: Filament;
  printerId: string;
  design: DesignId;
  textFilamentProduct?: string;
};
export const INITIAL_CONFIGURATION: BuilderConfiguration = {
  filament: DEFAULT_FILAMENT,
  printerId: DEFAULT_PRINTER.id,
  design: 'drybox-tab',
};

export function sameConfiguration(
  a: BuilderConfiguration,
  b: BuilderConfiguration,
) {
  return (
    a.filament === b.filament &&
    a.printerId === b.printerId &&
    a.design === b.design &&
    a.textFilamentProduct === b.textFilamentProduct
  );
}

export function filamentForProduct(product: string, current: Filament) {
  const candidates = FILAMENTS_BY_PRODUCT.get(product);
  if (!candidates?.length) throw new Error('Unknown filament type.');
  return (
    candidates.find((item) => item.colorName === current.colorName) ??
    candidates[0]
  );
}

/** Validate the entire agent request before changing visible state. */
export function resolveConfiguration(
  input: unknown,
  current: BuilderConfiguration,
): BuilderConfiguration {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Configuration must be an object.');
  const value = input as Record<string, unknown>;
  for (const [key, field] of Object.entries(value)) {
    if (
      ![
        'filamentProduct',
        'filamentColorCode',
        'printerId',
        'design',
        'textFilamentProduct',
      ].includes(key) ||
      typeof field !== 'string' ||
      !field
    )
      throw new Error(`Invalid configuration field: ${key}.`);
  }
  let filament = value.filamentProduct
    ? filamentForProduct(value.filamentProduct as string, current.filament)
    : current.filament;
  if (value.filamentColorCode) {
    const match = FILAMENTS.find(
      (item) => item.colorCode === value.filamentColorCode,
    );
    if (!match) throw new Error('Unknown filament color code.');
    if (value.filamentProduct && match.product !== value.filamentProduct)
      throw new Error(
        'This color does not belong to the selected filament type.',
      );
    filament = match;
  }
  const printerId = (value.printerId ?? current.printerId) as string;
  const design = (value.design ?? current.design) as DesignId;
  if (!PRINTERS.some((item) => item.id === printerId))
    throw new Error('Unknown printer.');
  if (!DESIGNS.some((item) => item.id === design))
    throw new Error('Unknown design.');
  const textFilamentProduct = (value.textFilamentProduct ??
    (filament.material === current.filament.material
      ? current.textFilamentProduct
      : undefined)) as string | undefined;
  resolveTextFilament(filament, textFilamentProduct);
  return {
    filament,
    printerId,
    design,
    ...(textFilamentProduct ? { textFilamentProduct } : {}),
  };
}
