import type { Filament } from '@/lib/catalog';
import { ColorSwatch } from './color-swatch';
import { Button } from './ui/button';

/** These are reusable catalog choices, deliberately not live AMS slots. */
export function AmsLabelChoices({
  choices,
  onSelect,
}: {
  choices: Filament[];
  onSelect: (filament: Filament) => void;
}) {
  if (!choices.length) return null;
  return (
    <section
      className="ams-label-library"
      aria-label="Labels from your last read"
    >
      <h3>Labels from your last read</h3>
      <p className="field-note">
        Reusable label choices, not live inventory. Confirm spools in Studio.
      </p>
      <div className="ams-label-choices">
        {choices.map((filament) => (
          <div className="ams-label-choice" key={filament.id}>
            <ColorSwatch
              colors={filament.colors}
              colorType={filament.colorType}
            />
            <div>
              <strong>{filament.colorName}</strong>
              <small>{filament.product}</small>
            </div>
            <Button
              variant="outline"
              onClick={() => onSelect(filament)}
              aria-label={`Use label ${filament.product} ${filament.colorName}`}
            >
              Use label
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
