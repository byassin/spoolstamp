'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

import {
  Cable,
  Tag,
  Link2,
  X,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  LoaderCircle,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FilamentSelectors } from '@/components/filament-selectors';
import { ColorSwatch } from '@/components/color-swatch';
import { LabelPreview } from '@/components/label-preview';
import {
  CATALOG_META,
  DEFAULT_PRINTER,
  DESIGNS,
  FILAMENT_TYPES,
  PRINTERS,
  type DesignId,
} from '@/lib/catalog';
import {
  appearanceLabel,
  textColorForFilament,
} from '@/lib/filament-appearance';
import { filamentForProduct } from '@/lib/builder-configuration';
import { useLabelBuilder } from '@/hooks/use-label-builder';
import { studioPresetFor } from '@/lib/studio-project';
import { resolveTextFilament } from '@/lib/text-filament';
import { AmsPanel } from '@/components/ams-panel';

export default function Home() {
  const [autoAmsText, setAutoAmsText] = useState(true);
  const [amsOpen, setAmsOpen] = useState(false);
  const amsDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (amsOpen) amsDialog.current?.showModal();
    else amsDialog.current?.close();
  }, [amsOpen]);
  const {
    filament,
    design,
    printerId,
    textFilamentProduct,
    generating,
    busyAction,
    localStudio,
    studioTransfer,
    studioError,
    download,
    error,
    updateConfiguration,
    generateAndDownload,
    retryStudio,
    allowStudioOpen,
  } = useLabelBuilder();
  const printer =
    PRINTERS.find((item) => item.id === printerId) ?? DEFAULT_PRINTER;
  const selectedDesign = DESIGNS.find((item) => item.id === design)!;
  const textColor = textColorForFilament(filament.colors);
  const textColorName = textColor === '#FFFFFFFF' ? 'White' : 'Black';
  const textFilament = resolveTextFilament(filament, textFilamentProduct);
  const isMixed = filament.colors.length > 1;
  let presetError: string | null = null;
  try {
    studioPresetFor(filament, printer.fullName);
    studioPresetFor(textFilament, printer.fullName);
  } catch (cause) {
    presetError =
      cause instanceof Error ? cause.message : 'No compatible printer preset.';
  }

  return (
    <main className="label-app">
      <header className="app-header">
        <Image
          className="brand-mark"
          src="/brand/spoolstamp-mark.png"
          alt=""
          width={40}
          height={40}
        />
        <div className="brand-name">
          <h1>Spoolstamp</h1>
          <span>Filament label studio</span>
        </div>
        <Button
          className="ams-launcher"
          variant="outline"
          onClick={() => setAmsOpen(true)}
          aria-haspopup="dialog"
        >
          <Cable size={17} /> My AMS
        </Button>
      </header>
      <div className="builder-layout">
        <section
          className="selection-panel panel-padding"
          aria-label="Design and filament"
        >
          <fieldset className="design-field">
            <legend>
              <span className="step-number">01</span> Choose a design
            </legend>
            <RadioGroup
              value={design}
              onValueChange={(value) =>
                updateConfiguration({ design: value as DesignId })
              }
              aria-label="Label design"
              className="design-options"
            >
              {DESIGNS.map((item) => (
                <label
                  key={item.id}
                  className="design-option"
                  htmlFor={`design-${item.id}`}
                >
                  <span className="design-icon" aria-hidden="true">
                    {item.id === 'drybox-tab' ? (
                      <Tag size={25} />
                    ) : (
                      <Link2 size={25} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {item.id === 'drybox-tab'
                        ? 'Hinged label'
                        : 'Clip-on label'}
                    </strong>
                    <small>
                      {item.id === 'drybox-tab'
                        ? '60 × 88 mm · Dry box'
                        : '51.4 × 15 mm · Two lines'}
                    </small>
                  </span>
                  <RadioGroupItem
                    id={`design-${item.id}`}
                    value={item.id}
                    aria-label={item.name}
                  />
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="panel-section-heading">
            <span className="step-number">02</span>
            <h2>Choose your filament</h2>
          </div>
          <FilamentSelectors
            filament={filament}
            onTypeChange={(product) =>
              updateConfiguration({
                filament: filamentForProduct(product, filament),
              })
            }
            onColorChange={(next) => updateConfiguration({ filament: next })}
          />
          <button
            className="loaded-spools-shortcut"
            onClick={() => setAmsOpen(true)}
          >
            <Cable size={16} /> Or choose a loaded AMS spool{' '}
            <span aria-hidden="true">↗</span>
          </button>
          <p className="catalog-note">
            {CATALOG_META.count} Bambu filament colors
            <br />
            Independent community project.
          </p>
        </section>

        <section className="preview-panel" aria-label="Label preview">
          <div className="preview-heading">
            <div>
              <h2>{selectedDesign.name}</h2>
              <p>
                {filament.product} / {filament.colorName}
              </p>
            </div>
            <span className="preview-profile">
              <Printer size={14} /> {printer.name}
            </span>
          </div>
          <div className="preview-stage">
            <LabelPreview
              filament={filament}
              design={design}
              printerName={printer.fullName}
            />
          </div>
          <p className="preview-caption">
            {isMixed
              ? 'Color placement is illustrative. A gradient or split-color spool prints as one filament.'
              : appearanceLabel(filament) === 'Transparent' ||
                  appearanceLabel(filament) === 'Translucent'
                ? 'Transparency is illustrative; the printed finish depends on wall thickness and material.'
                : 'Drag to orbit · Scroll to zoom · Preview color is approximate'}
          </p>
        </section>

        <section
          className="settings-panel panel-padding"
          aria-label="Print setup"
        >
          <div className="panel-section-heading first-heading">
            <span className="step-number">03</span>
            <h2>Print setup</h2>
          </div>
          <div className="field printer-field">
            <label htmlFor="target-printer">Printer</label>
            <div className="printer-select">
              <Printer size={17} aria-hidden="true" />
              <select
                id="target-printer"
                value={printerId}
                onChange={(event) =>
                  updateConfiguration({ printerId: event.target.value })
                }
              >
                {PRINTERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
            <p className="field-note">0.4 mm nozzle · 0.20 mm Standard</p>
          </div>
          <div className="field printer-field">
            <label htmlFor="text-filament">
              Text filament · {textColorName}
            </label>
            <div className="printer-select">
              <ColorSwatch colors={[textColor]} />
              <select
                id="text-filament"
                value={textFilament.product}
                onChange={(event) => {
                  setAutoAmsText(false);
                  updateConfiguration({
                    textFilamentProduct: event.target.value,
                  });
                }}
                aria-describedby="text-filament-note"
              >
                {FILAMENT_TYPES.filter(
                  (item) => item.material === filament.material,
                ).map((item) => (
                  <option key={item.product} value={item.product}>
                    {item.product}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
            <p className="field-note" id="text-filament-note">
              Match your loaded {textColorName.toLowerCase()} spool. Confirm its
              AMS slot in Studio.
            </p>
          </div>
          <section
            className="details-section"
            aria-labelledby="filament-details-heading"
          >
            <h2 id="filament-details-heading">Filament & print details</h2>
            <dl className="spec-list">
              <Spec label="Color code" value={filament.colorCode} />
              <Spec
                label="Nozzle"
                value={temperature(filament.nozzleTemperature)}
              />
              <Spec
                label="Textured plate"
                value={temperature(filament.texturedPlateTemperature)}
              />
              <Spec
                label="Drying"
                value={
                  filament.dryingTemperature == null
                    ? 'Not specified'
                    : `${filament.dryingTemperature} °C${filament.dryingTime == null ? '' : ` · ${filament.dryingTime} h`}`
                }
              />
              <Spec label="AMS family" value={filament.amsId} />
            </dl>
          </section>
        </section>

        <section className="export-panel" aria-label="Export label">
          <div className="export-main">
            <div className="print-colors">
              <div>
                <ColorSwatch
                  colors={filament.colors}
                  colorType={filament.colorType}
                />
                <span>
                  <small>Body</small>
                  <strong>{filament.colorName}</strong>
                </span>
              </div>
              <span className="color-separator" aria-hidden="true">
                +
              </span>
              <div>
                <ColorSwatch colors={[textColor]} />
                <span>
                  <small>Text · {textFilament.product}</small>
                  <strong>{textColorName}</strong>
                </span>
              </div>
            </div>
            <div className="export-actions">
              {localStudio &&
                (studioTransfer ? (
                  <Button
                    className="studio-button"
                    nativeButton={false}
                    render={
                      <a
                        href={studioTransfer.launchUrl}
                        rel="noreferrer"
                        aria-label="Open in Bambu Studio"
                        onClick={(event) => {
                          if (!allowStudioOpen(studioTransfer.path))
                            event.preventDefault();
                        }}
                      />
                    }
                  >
                    <ExternalLink size={18} /> Open in Bambu Studio
                  </Button>
                ) : (
                  <Button
                    className="studio-button"
                    disabled={!studioError || !!presetError}
                    onClick={retryStudio}
                  >
                    {!studioError && !presetError ? (
                      <LoaderCircle className="animate-spin" size={18} />
                    ) : (
                      <ExternalLink size={18} />
                    )}
                    {presetError
                      ? 'Open in Bambu Studio'
                      : studioError
                        ? 'Retry Studio preparation'
                        : 'Preparing for Studio…'}
                  </Button>
                ))}
              <Button
                className="download-button"
                disabled={generating || !!presetError}
                onClick={() => {
                  void generateAndDownload().catch(() => undefined);
                }}
              >
                {busyAction === 'download' ? (
                  <LoaderCircle className="animate-spin" size={18} />
                ) : (
                  <Download size={18} />
                )}
                {busyAction === 'download' ? 'Preparing 3MF…' : 'Download 3MF'}
              </Button>
            </div>
          </div>
          <output className="download-status" aria-live="polite">
            {error || presetError || studioError ? (
              <span className="error-message">
                {error || presetError || studioError}
              </span>
            ) : studioTransfer ? (
              <span>
                Ready to open · Confirm AMS slots in Studio, then slice and
                print.
              </span>
            ) : download ? (
              <span className="success-message">
                <Check size={15} /> Downloaded {download.filename}
              </span>
            ) : localStudio ? (
              <span>Preparing your current selection…</span>
            ) : (
              <span>
                Open as a project in Bambu Studio. Confirm your two spool
                assignments, then slice and print.
              </span>
            )}
          </output>
        </section>
      </div>
      <dialog
        ref={amsDialog}
        className="ams-drawer"
        aria-labelledby="ams-heading"
        onCancel={() => setAmsOpen(false)}
        onClose={() => setAmsOpen(false)}
      >
        <div className="drawer-top">
          <span>YOUR LOADED FILAMENT</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close My AMS"
            onClick={() => setAmsOpen(false)}
          >
            <X size={20} />
          </Button>
        </div>
        <AmsPanel
          filament={filament}
          printerName={printer.fullName}
          design={design}
          textFilamentProduct={textFilamentProduct}
          autoText={autoAmsText}
          onAutoTextChange={setAutoAmsText}
          onSelect={updateConfiguration}
          onLabelSelected={() => setAmsOpen(false)}
        />
      </dialog>
    </main>
  );
}

function temperature(value: number | null) {
  return value == null ? 'Not specified' : `${value} °C`;
}
function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
