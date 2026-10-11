import { FILAMENT_TYPES, type Filament } from './catalog';
import {
  contrastRatio,
  normalizeColor,
  textColorForFilament,
} from './filament-appearance';

export const TEXT_COLORS = [
  { id: 'white', name: 'White', hex: '#FFFFFFFF' },
  { id: 'black', name: 'Black', hex: '#000000FF' },
  { id: 'gray', name: 'Gray', hex: '#AFB1AEFF' },
  { id: 'red', name: 'Red', hex: '#C12E1FFF' },
  { id: 'blue', name: 'Blue', hex: '#0A2989FF' },
  { id: 'yellow', name: 'Yellow', hex: '#F4EE2AFF' },
] as const;
export type TextColorId = (typeof TEXT_COLORS)[number]['id'];

/** Advisory screen-color estimate, not a guarantee of physical print contrast. */
export function textContrastWarning(body: Filament, override?: TextColorId) {
  if (
    !override ||
    body.transparent ||
    !body.colors.length ||
    body.colors.some((color) => !normalizeColor(color).endsWith('FF'))
  )
    return null;
  const chosen = resolveTextColor(body, override);
  const ratio = Math.min(
    ...body.colors.map((color) => contrastRatio(color, chosen)),
  );
  if (ratio >= 3) return null;
  const suggested =
    textColorForFilament(body.colors) === '#FFFFFFFF' ? 'white' : 'black';
  return {
    ratio,
    suggested: suggested as TextColorId,
    suggestedName: suggested === 'white' ? 'White' : 'Black',
  };
}

export function resolveTextColor(
  body: Filament,
  override?: TextColorId,
): string {
  if (override === undefined) return textColorForFilament(body.colors);
  const selected = TEXT_COLORS.find((color) => color.id === override);
  if (!selected) throw new Error('Choose a supported text color.');
  return selected.hex;
}

/** Common printable profiles only; exclude support, decorative and filled variants. */
export function commonTextTypes(body: Filament) {
  return FILAMENT_TYPES.filter(
    (item) =>
      item.material === body.material &&
      /^(PLA (Basic|Matte|Tough\+)|PETG (Basic|HF)|ABS|ASA|PC|PA6|PA12|TPU (for AMS|95A HF))$/.test(
        item.product,
      ),
  );
}
