import { FILAMENTS_BY_PRODUCT, type Filament } from '@/lib/catalog';

/** A profile choice, independent of the automatically contrasting text RGB. */
export function resolveTextFilament(
  body: Filament,
  product?: string,
): Filament {
  const selected =
    product ?? (body.material === 'PLA' ? 'PLA Basic' : body.product);
  const candidate = FILAMENTS_BY_PRODUCT.get(selected)?.[0];
  if (!candidate) throw new Error('Unknown text filament type.');
  if (candidate.material !== body.material)
    throw new Error(
      `Choose a ${body.material} text filament to match the label material.`,
    );
  return candidate;
}
