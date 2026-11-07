'use client';

import type { DesignId } from '@/lib/catalog';
import { effectiveLabelLayout, type LabelLayout } from '@/lib/label-layout';

export function LabelLayoutControl({
  design,
  value,
  onChange,
}: {
  design: DesignId;
  value?: LabelLayout;
  onChange: (value: LabelLayout) => void;
}) {
  const layout = effectiveLabelLayout(design, value);
  if (design === 'clip-label')
    return (
      <p className="field-note label-layout-note">Compact two-line lettering</p>
    );
  return (
    <fieldset className="label-layout-control">
      <legend>Label detail</legend>
      <div>
        <button
          type="button"
          aria-pressed={layout === 'simple'}
          onClick={() => onChange('simple')}
        >
          Simple
        </button>
        <button
          type="button"
          aria-pressed={layout === 'detailed'}
          onClick={() => onChange('detailed')}
        >
          Detailed
        </button>
      </div>
      <p className="field-note">
        {layout === 'simple'
          ? 'Material and color, easy to spot.'
          : design === 'drybox-tab'
            ? 'Adds codes and print information.'
            : 'Adds the catalog code when space allows.'}
      </p>
    </fieldset>
  );
}
