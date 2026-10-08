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
import { CloudAmsConnection } from './cloud-ams-connection';
import { validateCloudApiOrigin } from '@/lib/cloud-ams-client';
const subscribeOrigin = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => '';

export function AmsPanel({
  filament,
  printerName,
  design,
  textFilamentProduct,
  autoText,
  onAutoTextChange,
  onSelect,
  onLabelSelected,
}: {
  filament: Filament;
  printerName: string;
  design: DesignId;
  textFilamentProduct?: string;
  autoText: boolean;
  onAutoTextChange: (value: boolean) => void;
  onSelect: (value: Partial<BuilderConfiguration>) => void;
  onLabelSelected?: () => void;
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
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const live = useRef({
    inventory,
    printerName,
    design,
    selected,
    confirmed,
    textFilamentProduct,
    autoText,
  });
  useLayoutEffect(() => {
    live.current = {
      inventory,
      printerName,
      design,
      selected,
      confirmed,
      textFilamentProduct,
      autoText,
    };
  }, [
    inventory,
    printerName,
    design,
    selected,
    confirmed,
    textFilamentProduct,
    autoText,
  ]);
  const mounted = useRef(true);
  const previousIdentity = useRef('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
    }
  }, [identity]);
  const fresh = inventory !== null && freshInventory(inventory);
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
  async function downloadBatch() {
    if (!fresh || !inventory || batchBusy) return;
    const labels = selected.map((key) => resolveLabel(key));
    if (labels.some((item) => !item)) return;
    const captured = JSON.stringify({
      identity,
      printerName,
      design,
      selected,
      confirmed,
      autoText,
      textFilamentProduct,
    });
    const isCurrent = () => {
      const current = live.current;
      if (
        !mounted.current ||
        !current.inventory ||
        !freshInventory(current.inventory)
      )
        return false;
      const currentIdentity = JSON.stringify(
        current.inventory.slots.map(
          ({ remaining: _remaining, ...slot }) => slot,
        ),
      );
      return (
        captured ===
        JSON.stringify({
          identity: currentIdentity,
          printerName: current.printerName,
          design: current.design,
          selected: current.selected,
          confirmed: current.confirmed,
          autoText: current.autoText,
          textFilamentProduct: current.textFilamentProduct,
        })
      );
    };
    setBatchBusy(true);
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
      const { generateLabelBatch } = await import('@/lib/generate-label-batch');
      const { downloadBlob } = await import('@/lib/generate-3mf');
      const blob = await generateLabelBatch({
        labels: (labels as Filament[]).map((body) => ({
          filament: body,
          textFilamentProduct: textProductFor(body),
        })),
        printer: printerName,
        design,
        isCurrent,
        onProgress: (done, total) => {
          if (mounted.current) setProgress(`Prepared ${done} of ${total}`);
        },
      });
      downloadBlob(blob, 'AMS-filament-labels.zip');
      setProgress(
        `Downloaded ${labels.length} separate 3MF projects. Confirm each project’s AMS assignments in Studio.`,
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
        <CloudAmsConnection origin={cloudOrigin} onInventory={setInventory} />
      ) : (
        <p className="field-note">
          Cloud AMS is not configured on this edition yet. You can always choose
          filament manually.
        </p>
      )}
      {inventory?.connected && (
        <>
          <p className="field-note">
            {inventory.printerName ??
              'Connection established · identifying printer…'}
            {inventory.firmware ? ` · ${inventory.firmware}` : ''}
          </p>
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
          <output className="field-note">{inventory.message}</output>
          <label className="ams-auto">
            <input
              type="checkbox"
              checked={autoText}
              onChange={(event) => onAutoTextChange(event.target.checked)}
            />{' '}
            Use compatible loaded black/white text automatically
          </label>
          {autoText && (
            <p className="field-note">
              {!fresh
                ? 'Automatic text selection is paused until the AMS inventory is received.'
                : suggestedText
                  ? `Text suggestion: ${suggestedText.product} · ${suggestedText.slot.label}. Confirm the physical slot in Studio.`
                  : 'No confirmed compatible black/white spool found. Check the text filament choice manually.'}
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
                          onChange={(event) =>
                            setConfirmed({
                              ...confirmed,
                              [slot.key]: event.target.value,
                            })
                          }
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
                              onSelect({
                                filament: label,
                                textFilamentProduct: textProductFor(label),
                              });
                              onLabelSelected?.();
                            }
                          }}
                        >
                          Use label
                        </Button>
                        <label className="ams-auto">
                          <input
                            type="checkbox"
                            aria-label={`Include ${slot.label} in batch`}
                            checked={selected.includes(slot.key)}
                            disabled={
                              disabled ||
                              (!selected.includes(slot.key) &&
                                selected.length >= MAX_BATCH_LABELS)
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
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {!!selected.length && (
            <div className="ams-batch">
              <Button
                disabled={batchBusy || !fresh}
                onClick={() => void downloadBatch()}
              >
                {batchBusy && (
                  <LoaderCircle size={16} className="animate-spin" />
                )}
                Download {selected.length} labels
              </Button>
              <small>
                ZIP of separate 3MF projects · current design and printer · up
                to {MAX_BATCH_LABELS}
              </small>
            </div>
          )}
          {progress && <output className="field-note">{progress}</output>}
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
