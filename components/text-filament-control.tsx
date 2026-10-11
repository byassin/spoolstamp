'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { ColorSwatch } from './color-swatch';
import { type Filament } from '../lib/catalog';
import {
  TEXT_COLORS,
  commonTextTypes,
  resolveTextColor,
  type TextColorId,
} from '../lib/text-color';
import { resolveTextFilament } from '../lib/text-filament';

export function TextFilamentControl({
  body,
  color,
  product,
  onChange,
  onAutomatic,
}: {
  body: Filament;
  color?: TextColorId;
  product?: string;
  onChange(color: TextColorId, product: string): void;
  onAutomatic(): void;
}) {
  const [expanded, setExpanded] = useState(!!color);
  const hex = resolveTextColor(body, color);
  const name =
    TEXT_COLORS.find((item) => item.hex === hex)?.name ?? 'Automatic';
  const profile = resolveTextFilament(body, product);
  const types = commonTextTypes(body);
  const choices = types.length ? types : [{ product: profile.product }];
  const chosenProduct = choices.some((item) => item.product === profile.product)
    ? profile.product
    : choices[0].product;
  const chosenColor = color ?? (hex === '#FFFFFFFF' ? 'white' : 'black');
  return (
    <div className="field text-filament-control">
      <span className="text-filament-heading">Text filament</span>
      <div className="text-filament-summary">
        <ColorSwatch colors={[hex]} />
        <span>
          <strong>{name}</strong>
          <small>
            {color ? 'Custom' : 'Automatic contrast'} · {profile.product}
          </small>
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        aria-controls="text-override-options"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? 'Hide text options'
          : color
            ? 'Edit text color'
            : 'Customize text color'}
      </Button>
      {expanded && (
        <div id="text-override-options">
          <fieldset className="text-color-options">
            <legend>Choose a text color</legend>
            {TEXT_COLORS.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={color === item.id}
                onClick={() => onChange(item.id, chosenProduct)}
              >
                <ColorSwatch colors={[item.hex]} />
                <span>{item.name}</span>
              </button>
            ))}
          </fieldset>
          <label htmlFor="text-filament">Text material · {body.material}</label>
          <select
            id="text-filament"
            value={chosenProduct}
            onChange={(event) => onChange(chosenColor, event.target.value)}
          >
            {choices.map((item) => (
              <option key={item.product} value={item.product}>
                {item.product}
              </option>
            ))}
          </select>
          <p className="field-note">
            Choose a contrasting color in the same material family as your
            label. Match your actual spool and confirm its AMS slot in Studio.
            Color swatches are approximate.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onAutomatic();
              setExpanded(false);
            }}
          >
            Use automatic text
          </Button>
        </div>
      )}
    </div>
  );
}
