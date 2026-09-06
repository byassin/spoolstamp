import type { ColorType, Filament } from '@/lib/catalog';

export type FilamentAppearance = Pick<
  Filament,
  'colors' | 'colorType' | 'transparent' | 'product'
>;

export function normalizeColor(color: string) {
  const match = color.toUpperCase().match(/^#([0-9A-F]{6})([0-9A-F]{2})?$/);
  return match ? `#${match[1]}${match[2] || 'FF'}` : '#D9E0DBFF';
}

function luminance(color: string) {
  const channels = normalizeColor(color)
    .slice(1, 7)
    .match(/../g)!
    .map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

export function textColorForFilament(colors: readonly string[]) {
  const palette = colors.length ? colors : ['#D9E0DBFF'];
  const minimumContrast = (text: string) =>
    Math.min(
      ...palette.map((color) =>
        contrastRatio(
          text,
          normalizeColor(color).endsWith('00') ? '#D9E0DB' : color,
        ),
      ),
    );
  return minimumContrast('#000000FF') >= minimumContrast('#FFFFFFFF')
    ? '#000000FF'
    : '#FFFFFFFF';
}

export function appearanceLabel(filament: FilamentAppearance) {
  if (
    filament.transparent ||
    filament.colors.every((color) => normalizeColor(color).endsWith('00'))
  )
    return 'Transparent';
  if (filament.colorType === 'multi') return `${filament.colors.length}-color`;
  if (filament.colorType === 'gradient') return 'Gradient';
  if (
    filament.colors.some((color) => !normalizeColor(color).endsWith('FF')) ||
    /translucent/i.test(filament.product)
  )
    return 'Translucent';
  if (/silk/i.test(filament.product)) return 'Silk';
  if (/matte/i.test(filament.product)) return 'Matte';
  return 'Solid color';
}

export function colorBackground(
  colors: readonly string[],
  type: ColorType = 'single',
) {
  const palette = colors.length ? colors.map(normalizeColor) : ['#D9E0DBFF'];
  const stops =
    type === 'multi'
      ? palette.map(
          (color, index) =>
            `${color} ${(index * 100) / palette.length}% ${((index + 1) * 100) / palette.length}%`,
        )
      : palette.length === 1
        ? [palette[0], palette[0]]
        : palette;
  return `linear-gradient(120deg, ${stops.join(', ')}), conic-gradient(#dce1df 25%, #89928d 0 50%, #dce1df 0 75%, #89928d 0)`;
}
