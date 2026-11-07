'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Cable, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColorSwatch } from './color-swatch';
import { PRINTERS, type Filament, type DesignId } from '@/lib/catalog';
import { type AmsInventory } from '@/lib/ams';
import {
  freshInventory,
  matchAmsSlot,
  textSpoolCandidates,
} from '@/lib/ams-matching';
import { MAX_BATCH_LABELS } from '@/lib/generate-label-batch';
import { studioPresetFor } from '@/lib/studio-project';
import type { BuilderConfiguration } from '@/lib/builder-configuration';
import type { TextColorId } from '@/lib/text-color';
import { CloudAmsConnection } from './cloud-ams-connection';
import { validateCloudApiOrigin } from '@/lib/cloud-ams-client';
import { snapshotStatus } from '@/lib/ams-freshness';
import { captureLabelChoices } from '@/lib/ams-label-choices';
import { AmsLabelChoices } from './ams-label-choices';
import { BatchPreview } from './batch-preview';
import {
  batchQuantityTotal,
  expandBatchQuantities,
} from '@/lib/batch-quantity';
import type { PreparedLabelPlates } from '@/lib/generate-label-plates';
import type { LabelLayout } from '@/lib/label-layout';
const subscribeOrigin = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => '';

export function AmsPanel({
  filament,
  printerName,
  design,
  labelLayout,
  textFilamentProduct,
  textColor,
  autoText,
  onAutoTextChange,
  onSelect,
  onLabelSelected,
  onSaveDraft,
}: {
  filament: Filament;
  printerName: string;
  design: DesignId;
  labelLayout?: LabelLayout;
  textFilamentProduct?: string;
  textColor?: TextColorId;
  autoText: boolean;
  onAutoTextChange: (value: boolean) => void;
  onSelect: (value: Partial<BuilderConfiguration>) => void;
  onLabelSelected?: () => void;
  onSaveDraft?: (value: Partial<BuilderConfiguration>) => boolean;
}) {
  const origin = useSyncExternalStore(
    subscribeOrigin,
    browserOrigin,
    serverOrigin,
  );
  const cloudOrigin = validateCloudApiOrigin(
    import.meta.env.VITE_AMS_API_ORIGIN,
    origin,
  );
  const [inventory, setInventory] = useState<AmsInventory | null>(null);
  const [labelChoices, setLabelChoices] = useState<Filament[]>([]);
  const capturedRead = useRef<number | null>(null);
  function receiveInventory(value: AmsInventory | null) {
    setInventory(value);
    if (
      value &&
      freshInventory(value) &&
      value.updatedAt !== capturedRead.current
    ) {
      capturedRead.current = value.updatedAt;
      setLabelChoices(captureLabelChoices(value));
    }
  }
  function rememberChoice(value: Filament) {
    setLabelChoices((previous) =>
      previous.some((item) => item.id === value.id)
        ? previous
        : [...previous, value],
    );
  }
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [prepared, setPrepared] = useState<{
    signature: string;
    plan: PreparedLabelPlates;
  } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [layout, setLayout] = useState<'separate' | 'plates'>('separate');
  const [clock, setClock] = useState(() => Date.now());
  const live = useRef({
    inventory,
    printerName,
    design,
    labelLayout,
    selected,
    copies,
    confirmed,
    textFilamentProduct,
    textColor,
    autoText,
    layout,
  });
  useLayoutEffect(() => {
    live.current = {
      inventory,
      printerName,
      design,
      labelLayout,
      selected,
      copies,
      confirmed,
      textFilamentProduct,
      textColor,
      autoText,
      layout,
    };
  }, [
    inventory,
    printerName,
    design,
    labelLayout,
    selected,
    copies,
    confirmed,
    textFilamentProduct,
    textColor,
    autoText,
    layout,
  ]);
  const mounted = useRef(true);
  const previousIdentity = useRef('');
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  const identity = inventory
    ? JSON.stringify(
        inventory.slots.map(({ remaining: _remaining, ...slot }) => slot),
      )
    : '';
  useEffect(() => {
    if (identity !== previousIdentity.current) {
      previousIdentity.current = identity;
      setConfirmed({});
      setSelected([]);
      setCopies({});
      setPrepared(null);
    }
  }, [identity]);
  const freshness = snapshotStatus(inventory, clock);
  const fresh = freshness.fresh;
  const textChoices = inventory
    ? textSpoolCandidates(filament, inventory, printerName)
    : [];
  const suggestedText = textChoices[0];
  const suggestedProduct = suggestedText?.product;
  useEffect(() => {
    if (
      autoText &&
      fresh &&
      suggestedProduct &&
      textFilamentProduct !== suggestedProduct
    )
      onSelect({ textFilamentProduct: suggestedProduct });
  }, [autoText, fresh, suggestedProduct, textFilamentProduct, onSelect]);

  function resolveLabel(key: string) {
    const slot = inventory?.slots.find((item) => item.key === key);
    if (!slot) return undefined;
    const matches = matchAmsSlot(slot);
    return matches.length === 1
      ? matches[0]
      : matches.find((item) => item.id === confirmed[key]);
  }
  function textProductFor(body: Filament) {
    return autoText && inventory
      ? textSpoolCandidates(body, inventory, printerName)[0]?.product
      : body.material === filament.material
        ? textFilamentProduct
        : undefined;
  }
  const batchSignature = JSON.stringify({
    identity,
    printerName,
    design,
    labelLayout,
    selected,
    copies,
    confirmed,
    autoText,
    textFilamentProduct,
    textColor,
    layout,
  });
  const preparedPlan =
    prepared?.signature === batchSignature ? prepared.plan : null;
  let quantityError = '';
  let totalCopies = 0;
  try {
    totalCopies = batchQuantityTotal(
      selected.map((key) => ({ copies: copies[key] ?? 1 })),
    );
  } catch (cause) {
    quantityError =
      cause instanceof Error ? cause.message : 'Review the label copies.';
  }
  function isBatchCurrent(signature: string) {
    const current = live.current;
    if (
      !mounted.current ||
      !current.inventory ||
      !freshInventory(current.inventory)
    )
      return false;
    const currentIdentity = JSON.stringify(
      current.inventory.slots.map(({ remaining: _remaining, ...slot }) => slot),
    );
    return (
      signature ===
      JSON.stringify({
        identity: currentIdentity,
        printerName: current.printerName,
        design: current.design,
        labelLayout: current.labelLayout,
        selected: current.selected,
        copies: current.copies,
        confirmed: current.confirmed,
        autoText: current.autoText,
        textFilamentProduct: current.textFilamentProduct,
        textColor: current.textColor,
        layout: current.layout,
      })
    );
  }
  async function prepareBatch() {
    if (!fresh || !inventory || batchBusy) return;
    const labels = selected.map((key) => resolveLabel(key));
    if (labels.some((item) => !item)) return;
    const captured = batchSignature;
    const isCurrent = () => isBatchCurrent(captured);
    setBatchBusy(true);
    setPrepared(null);
    setError('');
    setProgress('Preparing labels…');
    try {
      if (
        autoText &&
        (labels as Filament[]).some((body) => !textProductFor(body))
      )
        throw new Error(
          'A selected label has no confirmed compatible black/white spool. Export it individually and choose its text filament.',
        );
      const { prepareLabelPlates } =
        await import('@/lib/generate-label-plates');
      const options = {
        labels: expandBatchQuantities(
          (labels as Filament[]).map((body, index) => ({
            label: {
              filament: body,
              textFilamentProduct: textProductFor(body),
              textColor: autoText ? undefined : textColor,
            },
            copies: copies[selected[index]] ?? 1,
          })),
        ),
        printer: printerName,
        design,
        labelLayout,
        layout,
        isCurrent,
        onProgress: (done: number, total: number) => {
          if (mounted.current) setProgress(`Prepared ${done} of ${total}`);
        },
      };
      const plan = await prepareLabelPlates(options);
      if (!isCurrent())
        throw new Error(
          'AMS choices changed or expired. Read again before preparing a live batch.',
        );
      setPrepared({ signature: captured, plan });
      setProgress(
        'Preview ready. Confirm your label choices before downloading.',
      );
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : 'Batch export failed.',
        );
        setProgress('');
      }
    } finally {
      if (mounted.current) setBatchBusy(false);
    }
  }
  async function downloadBatch() {
    if (!preparedPlan || batchBusy || !isBatchCurrent(batchSignature)) return;
    const captured = batchSignature;
    const isCurrent = () => isBatchCurrent(captured);
    setBatchBusy(true);
    setError('');
    setProgress('Preparing ZIP…');
    try {
      const { generatePreparedLabelPlates } =
        await import('@/lib/generate-label-plates');
      const { downloadBlob } = await import('@/lib/generate-3mf');
      const result = await generatePreparedLabelPlates(preparedPlan, {
        isCurrent,
      });
      if (!isCurrent())
        throw new Error(
          'AMS choices changed or expired. Prepare the batch again.',
        );
      downloadBlob(
        result.blob,
        preparedPlan.layout === 'plates'
          ? 'AMS-filament-plates.zip'
          : 'AMS-filament-labels.zip',
      );
      setProgress(
        `Downloaded ${result.labels} labels in ${result.plates} projects. Confirm physical spools and placement in Studio.`,
      );
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : 'Batch export failed.',
        );
        setProgress('');
      }
    } finally {
      if (mounted.current) setBatchBusy(false);
    }
  }
  const detectedPrinter = PRINTERS.find(
    (item) => item.fullName === inventory?.printerName,
  );
  return (
    <section className="ams-panel" aria-labelledby="ams-heading">
      <div className="ams-heading">
        <h2 id="ams-heading">
          <Cable size={17} /> My AMS <small>Preview</small>
        </h2>
      </div>
      {cloudOrigin ? (
        <CloudAmsConnection
          origin={cloudOrigin}
          onInventory={receiveInventory}
          hasLabelChoices={labelChoices.length > 0}
        />
      ) : (
        <p className="field-note">
          AMS isn’t available here. You can choose filament manually.
        </p>
      )}
      {!fresh && (
        <AmsLabelChoices
          choices={labelChoices}
          onSelect={(choice) => {
            onSelect({
              filament: choice,
              textFilamentProduct:
                choice.material === filament.material
                  ? textFilamentProduct
                  : undefined,
              textColor,
            });
            onLabelSelected?.();
          }}
        />
      )}
      {inventory?.connected && fresh && (
        <>
          {detectedPrinter && detectedPrinter.fullName !== printerName && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSelect({ printerId: detectedPrinter.id })}
            >
              Use {detectedPrinter.name} print profile
            </Button>
          )}
          {fresh && !detectedPrinter && (
            <p className="field-note">
              Printer profile not identified. Check the Printer selection before
              exporting.
            </p>
          )}
          <label className="ams-auto">
            <input
              type="checkbox"
              checked={autoText}
              onChange={(event) => onAutoTextChange(event.target.checked)}
            />{' '}
            Match text to a loaded black/white spool
          </label>
          {autoText && (
            <p className="field-note">
              {!fresh
                ? 'Text can be chosen in Print setup.'
                : suggestedText
                  ? `Text: ${suggestedText.product} · ${suggestedText.slot.label}`
                  : 'No matching text spool. Choose one in Print setup.'}
            </p>
          )}
          <div className="ams-slots">
            {inventory.slots.map((slot) => {
              const matches = matchAmsSlot(slot);
              const label = resolveLabel(slot.key);
              let compatible = !!label;
              if (label) {
                try {
                  studioPresetFor(label, printerName);
                } catch {
                  compatible = false;
                }
              }
              const disabled = !fresh || !compatible || batchBusy;
              return (
                <div className="ams-slot" key={slot.key}>
                  <div className="ams-slot-title">
                    <ColorSwatch
                      colors={slot.colors.length ? slot.colors : ['#D9E0DBFF']}
                    />
                    <strong>{slot.label}</strong>
                    <span>
                      {slot.present === false
                        ? 'Empty'
                        : slot.present === null
                          ? 'Presence unknown'
                          : slot.reading
                            ? 'Reading…'
                            : slot.material || 'Unknown spool'}
                    </span>
                  </div>
                  {slot.present === true && !slot.reading && (
                    <>
                      {label ? (
                        <p>
                          {label.product}
                          <br />
                          <strong>{label.colorName}</strong>
                        </p>
                      ) : (
                        <p className="field-note">
                          {matches.length > 1
                            ? 'Multiple catalog matches. Confirm the spool:'
                            : 'No exact catalog match. Use the manual filament picker; no SKU has been inferred.'}
                        </p>
                      )}
                      {matches.length > 1 && (
                        <select
                          aria-label={`Confirm filament in ${slot.label}`}
                          value={confirmed[slot.key] ?? ''}
                          disabled={!fresh || batchBusy}
                          onChange={(event) => {
                            setConfirmed({
                              ...confirmed,
                              [slot.key]: event.target.value,
                            });
                            const choice = matches.find(
                              (item) => item.id === event.target.value,
                            );
                            if (
                              choice &&
                              live.current.inventory &&
                              freshInventory(live.current.inventory)
                            )
                              rememberChoice(choice);
                          }}
                        >
                          <option value="">Choose exact filament…</option>
                          {matches.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.product} · {item.colorName} ·{' '}
                              {item.colorCode}
                            </option>
                          ))}
                        </select>
                      )}
                      {slot.remaining !== null && (
                        <small>
                          {slot.remaining}% remaining · printer estimate
                        </small>
                      )}
                      {label && !compatible && (
                        <p className="field-note">
                          No compatible preset for the selected printer.
                        </p>
                      )}
                      <div className="ams-actions">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => {
                            if (
                              label &&
                              live.current.inventory &&
                              freshInventory(live.current.inventory)
                            ) {
                              rememberChoice(label);
                              onSelect({
                                filament: label,
                                textFilamentProduct: textProductFor(label),
                                textColor: autoText ? undefined : textColor,
                              });
                              onLabelSelected?.();
                            }
                          }}
                        >
                          Use label
                        </Button>
                        {onSaveDraft && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={disabled}
                            onClick={() => {
                              const current = live.current.inventory;
                              if (
                                !label ||
                                !current ||
                                !freshInventory(current)
                              )
                                return;
                              const product = textProductFor(label);
                              if (autoText && !product) {
                                setError(
                                  'Choose a compatible text filament manually before saving this draft.',
                                );
                                return;
                              }
                              if (
                                onSaveDraft({
                                  filament: label,
                                  textFilamentProduct: product,
                                  textColor: autoText ? undefined : textColor,
                                })
                              )
                                setProgress('Saved in My saved filaments.');
                            }}
                          >
                            Save draft
                          </Button>
                        )}
                        <label className="ams-auto">
                          <input
                            type="checkbox"
                            aria-label={`Include ${slot.label} in batch`}
                            checked={selected.includes(slot.key)}
                            disabled={
                              disabled ||
                              (!selected.includes(slot.key) &&
                                totalCopies >= MAX_BATCH_LABELS)
                            }
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, slot.key]
                                  : selected.filter((key) => key !== slot.key),
                              )
                            }
                          />{' '}
                          Batch
                        </label>
                        {selected.includes(slot.key) && (
                          <label className="batch-copies">
                            Copies
                            <select
                              aria-label={`Copies of ${slot.label}`}
                              value={copies[slot.key] ?? 1}
                              disabled={disabled || batchBusy}
                              onChange={(event) =>
                                setCopies((value) => ({
                                  ...value,
                                  [slot.key]: Number(event.target.value),
                                }))
                              }
                            >
                              {Array.from(
                                { length: MAX_BATCH_LABELS },
                                (_, index) => (
                                  <option
                                    key={index + 1}
                                    value={index + 1}
                                    disabled={
                                      index +
                                        1 +
                                        selected
                                          .filter((key) => key !== slot.key)
                                          .reduce(
                                            (total, key) =>
                                              total + (copies[key] ?? 1),
                                            0,
                                          ) >
                                      MAX_BATCH_LABELS
                                    }
                                  >
                                    {index + 1}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {!!selected.length && (
            <div className="ams-batch">
              <label>
                Batch layout
                <select
                  aria-label="AMS batch layout"
                  value={layout}
                  disabled={batchBusy}
                  onChange={(event) =>
                    setLayout(event.target.value as 'separate' | 'plates')
                  }
                >
                  <option value="separate">Separate 3MF projects</option>
                  <option value="plates">
                    Arrange compatible labels on plates
                  </option>
                </select>
              </label>
              <p className="field-note">
                {quantityError ||
                  `${totalCopies} of ${MAX_BATCH_LABELS} labels, including copies`}
              </p>
              <Button
                disabled={batchBusy || !fresh || !!quantityError}
                onClick={() => void prepareBatch()}
              >
                {batchBusy && !preparedPlan
                  ? 'Preparing preview…'
                  : preparedPlan
                    ? 'Update preview'
                    : 'Preview batch'}
              </Button>
              <BatchPreview
                plan={preparedPlan}
                busy={batchBusy && !preparedPlan}
              />
              {preparedPlan && (
                <Button
                  disabled={batchBusy || !fresh}
                  onClick={() => void downloadBatch()}
                >
                  {batchBusy && (
                    <LoaderCircle size={16} className="animate-spin" />
                  )}
                  Download {preparedPlan.labelCount} labels
                </Button>
              )}
              <small>
                ZIP · current design and printer · up to {MAX_BATCH_LABELS}{' '}
                labels.
                {layout === 'plates'
                  ? ' Product pairs, colors and bed limits may produce several plates. Check brim and purge-tower clearance in Studio.'
                  : ' One project per label.'}
              </small>
            </div>
          )}
          {progress && (
            <output className="field-note">
              {progress.startsWith('Preview ready.') && !preparedPlan
                ? 'Choices changed. Preview the batch again.'
                : progress}
            </output>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
