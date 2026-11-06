import type { DesignId } from './catalog';

export type LabelLayout = 'simple' | 'detailed';

export function isLabelLayout(value: unknown): value is LabelLayout {
  return value === 'simple' || value === 'detailed';
}

/** Old drafts keep detailed defaults; the narrow supplied clip stays two-line only. */
export function effectiveLabelLayout(
  design: DesignId,
  layout?: LabelLayout,
): LabelLayout {
  if (layout !== undefined && !isLabelLayout(layout))
    throw new Error('Unknown label layout.');
  return design === 'clip-label' ? 'simple' : (layout ?? 'detailed');
}
