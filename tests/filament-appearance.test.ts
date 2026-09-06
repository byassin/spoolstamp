import { describe, expect, it } from 'vitest';
import { DEFAULT_FILAMENT, FILAMENTS } from '../lib/catalog';
import {
  appearanceLabel,
  colorBackground,
  contrastRatio,
  normalizeColor,
  textColorForFilament,
} from '../lib/filament-appearance';

describe('shared filament appearance', () => {
  it('normalizes six-digit colors without discarding alpha', () => {
    expect(normalizeColor('#aBc123')).toBe('#ABC123FF');
    expect(normalizeColor('#abcdef80')).toBe('#ABCDEF80');
    expect(normalizeColor('not-a-color')).toBe('#D9E0DBFF');
  });
  it('renders every palette stop, with hard split colors and a transparency checker underneath', () => {
    const colors = ['#FF0000FF', '#00FF00FF', '#0000FFFF', '#FFFFFF80'];
    const split = colorBackground(colors, 'multi');
    expect(split).toContain('#FF0000FF 0% 25%');
    expect(split).toContain('#FFFFFF80 75% 100%');
    const gradient = colorBackground(colors, 'gradient');
    colors.forEach((color) => expect(gradient).toContain(color));
    expect(gradient).toContain('conic-gradient');
    expect(gradient).not.toContain('25% 50%');
  });
  it('distinguishes clear, translucent, split, gradient, silk, and matte appearances', () => {
    expect(
      appearanceLabel({ ...DEFAULT_FILAMENT, colors: ['#00000000'] }),
    ).toBe('Transparent');
    expect(
      appearanceLabel({ ...DEFAULT_FILAMENT, colors: ['#ABCDEF80'] }),
    ).toBe('Translucent');
    expect(
      appearanceLabel({
        ...DEFAULT_FILAMENT,
        colors: ['#000000FF', '#FFFFFFFF'],
        colorType: 'multi',
      }),
    ).toBe('2-color');
    expect(
      appearanceLabel({ ...DEFAULT_FILAMENT, colorType: 'gradient' }),
    ).toBe('Gradient');
    expect(appearanceLabel({ ...DEFAULT_FILAMENT, product: 'PLA Silk' })).toBe(
      'Silk',
    );
    expect(appearanceLabel({ ...DEFAULT_FILAMENT, product: 'PLA Matte' })).toBe(
      'Matte',
    );
  });
  it('chooses only pure black or white using the whole palette, consistently for preview and export', () => {
    expect(textColorForFilament(['#000000FF'])).toBe('#FFFFFFFF');
    expect(textColorForFilament(['#FFFFFFFF'])).toBe('#000000FF');
    expect(textColorForFilament(['#00000000'])).toBe('#000000FF');
    expect(textColorForFilament(['#307FE2FF', '#54FF9BFF'])).toBe('#000000FF');
    for (const filament of FILAMENTS) {
      const text = textColorForFilament(filament.colors);
      expect(['#000000FF', '#FFFFFFFF']).toContain(text);
      const other = text === '#FFFFFFFF' ? '#000000FF' : '#FFFFFFFF';
      const palette = filament.colors.map((color) =>
        color.endsWith('00') ? '#D9E0DBFF' : color,
      );
      const minimum = (candidate: string) =>
        Math.min(...palette.map((color) => contrastRatio(color, candidate)));
      expect(minimum(text)).toBeGreaterThanOrEqual(minimum(other));
    }
  });
});
