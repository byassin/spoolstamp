import type { ColorType } from '@/lib/catalog';
import { colorBackground } from '@/lib/filament-appearance';
import { cn } from '@/lib/utils';

export function ColorSwatch({
  colors,
  colorType = 'single',
  className,
}: {
  colors: readonly string[];
  colorType?: ColorType;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('color-swatch', className)}
      style={{
        backgroundImage: colorBackground(colors, colorType),
        backgroundSize: '100% 100%, 8px 8px',
      }}
    />
  );
}
