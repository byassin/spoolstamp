'use client';

import { Layers3, Search } from 'lucide-react';
import { useId } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';
import { InputGroupAddon } from '@/components/ui/input-group';
import { ColorSwatch } from '@/components/color-swatch';
import {
  FILAMENT_TYPES,
  FILAMENTS_BY_PRODUCT,
  type Filament,
  type FilamentType,
} from '@/lib/catalog';
import { appearanceLabel } from '@/lib/filament-appearance';

export function FilamentSelectors({
  filament,
  onTypeChange,
  onColorChange,
}: {
  filament: Filament;
  onTypeChange: (product: string) => void;
  onColorChange: (filament: Filament) => void;
}) {
  const id = useId();
  const selectedType = FILAMENT_TYPES.find(
    (type) => type.product === filament.product,
  )!;
  const colors = FILAMENTS_BY_PRODUCT.get(filament.product) ?? [];
  return (
    <div className="filament-selectors">
      <div className="field">
        <label id={`${id}-type-label`} htmlFor={`${id}-type`}>
          Filament type
        </label>
        <Combobox
          items={FILAMENT_TYPES}
          value={selectedType}
          onValueChange={(type) => type && onTypeChange(type.product)}
          itemToStringLabel={(type) => type.product}
          itemToStringValue={(type) => type.product}
          isItemEqualToValue={(a, b) => a.product === b.product}
          autoHighlight
        >
          <ComboboxTrigger
            id={`${id}-type`}
            aria-labelledby={`${id}-type-label ${id}-selected-type`}
            className="selector-trigger"
          >
            <span className="selector-icon">
              <Layers3 size={19} />
            </span>
            <span className="selector-value">
              <span id={`${id}-selected-type`}>{filament.product}</span>
              <small>{selectedType.colorCount} colors</small>
            </span>
          </ComboboxTrigger>
          <ComboboxContent className="selector-popup">
            <ComboboxInput
              className="selector-search"
              aria-label="Search filament types"
              placeholder="Search filament types…"
              showTrigger={false}
            >
              <InputGroupAddon>
                <Search size={16} />
              </InputGroupAddon>
            </ComboboxInput>
            <ComboboxEmpty className="selector-empty">
              No filament types found. Try PLA or PETG.
            </ComboboxEmpty>
            <ComboboxList className="selector-list">
              {(type: FilamentType) => (
                <ComboboxItem
                  key={type.product}
                  value={type}
                  className="selector-option"
                >
                  <span className="option-content">
                    <span>{type.product}</span>
                    <small>
                      {type.colorCount}{' '}
                      {type.colorCount === 1 ? 'color' : 'colors'}
                    </small>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      <div className="field">
        <label id={`${id}-color-label`} htmlFor={`${id}-color`}>
          Color
        </label>
        <Combobox
          key={filament.product}
          items={colors}
          value={filament}
          onValueChange={(color) => color && onColorChange(color)}
          itemToStringLabel={(color) => `${color.colorName} ${color.colorCode}`}
          itemToStringValue={(color) => color.id}
          isItemEqualToValue={(a, b) => a.id === b.id}
          filter={(color, query) =>
            `${color.colorName} ${color.colorCode} ${appearanceLabel(color)} ${color.colors.join(' ')}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())
          }
          autoHighlight
        >
          <ComboboxTrigger
            id={`${id}-color`}
            aria-labelledby={`${id}-color-label ${id}-selected-color`}
            className="selector-trigger"
          >
            <ColorSwatch
              colors={filament.colors}
              colorType={filament.colorType}
            />
            <span className="selector-value">
              <span id={`${id}-selected-color`}>{filament.colorName}</span>
              <small>
                Code {filament.colorCode} · {appearanceLabel(filament)}
              </small>
            </span>
          </ComboboxTrigger>
          <ComboboxContent className="selector-popup">
            <ComboboxInput
              className="selector-search"
              aria-label={`Search ${filament.product} colors`}
              placeholder="Search color or code…"
              showTrigger={false}
            >
              <InputGroupAddon>
                <Search size={16} />
              </InputGroupAddon>
            </ComboboxInput>
            <ComboboxEmpty className="selector-empty">
              No matching colors. Try a name or five-digit code.
            </ComboboxEmpty>
            <ComboboxList className="selector-list">
              {(color: Filament) => (
                <ComboboxItem
                  key={color.id}
                  value={color}
                  className="selector-option"
                >
                  <ColorSwatch
                    colors={color.colors}
                    colorType={color.colorType}
                  />
                  <span className="option-content">
                    <span>{color.colorName}</span>
                    <small>
                      Code {color.colorCode} · {appearanceLabel(color)}
                    </small>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    </div>
  );
}
