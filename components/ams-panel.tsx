'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Cable, LoaderCircle, ShieldCheck, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ColorSwatch } from './color-swatch';
import { PRINTERS, type Filament, type DesignId } from '@/lib/catalog';
import { type AmsInventory, type AmsProbe } from '@/lib/ams';
import { readAms, probeAms, connectAms, disconnectAms } from '@/lib/ams-client';
import {
  freshInventory,
  matchAmsSlot,
  textSpoolCandidates,
} from '@/lib/ams-matching';
import { isLoopbackUrl } from '@/lib/studio-handoff';
import { MAX_BATCH_LABELS } from '@/lib/generate-label-batch';
import { studioPresetFor } from '@/lib/studio-project';
import type { BuilderConfiguration } from '@/lib/builder-configuration';

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
  const [available, setAvailable] = useState(false);
  const [inventory, setInventory] = useState<AmsInventory | null>(null);
  const [pairing, setPairing] = useState(false);
  const [host, setHost] = useState('');
  const [serial, setSerial] = useState('');
  const [code, setCode] = useState('');
  const [probe, setProbe] = useState<AmsProbe | null>(null);
  const [busy, setBusy] = useState(false);
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
  const operation = useRef(0);
  const mounted = useRef(true);
  const previousIdentity = useRef('');
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = operation.current;
      try {
        const state = await readAms(
          AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        );
        if (!controller.signal.aborted && revision === operation.current) {
          setAvailable(state.available === true);
          setInventory(state);
        }
      } catch {
        if (!controller.signal.aborted && revision === operation.current)
          setInventory((value) =>
            value
              ? {
                  ...value,
                  connected: false,
                  stale: true,
                  message:
                    'Local connection unavailable. Reconnect or use the manual picker.',
                }
              : null,
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
      }
    };
    if (isLoopbackUrl(window.location.origin)) void poll();
    return () => {
      mounted.current = false;
      controller.abort();
      clearTimeout(timer);
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

  async function pairAction(action: () => Promise<void>) {
    if (busy) return;
    operation.current++;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Connection failed.');
    } finally {
      if (mounted.current) setBusy(false);
      operation.current++;
    }
  }
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
        {available && !inventory?.connected && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPairing(!pairing);
              setProbe(null);
              setCode('');
            }}
            disabled={busy}
          >
            {pairing ? 'Cancel' : 'Connect'}
          </Button>
        )}
        {inventory?.connected && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void pairAction(async () => {
                setInventory(await disconnectAms());
                setProbe(null);
                setCode('');
              })
            }
          >
            <Unplug size={14} /> Disconnect
          </Button>
        )}
      </div>
      {!available && (
        <p className="field-note">
          Optional AMS reading is available in the local edition. You can always
          choose filament manually.
        </p>
      )}
      {available && !inventory?.connected && !pairing && (
        <p className="field-note">
          Use loaded spools to prefill labels. Connection is optional and
          read-only.
        </p>
      )}
      {available &&
        inventory &&
        !inventory.connected &&
        inventory.message !== 'Not connected.' && (
          <output className="field-note">{inventory.message}</output>
        )}
      {pairing && !inventory?.connected && (
        <form
          className="ams-pairing"
          onSubmit={(event) => {
            event.preventDefault();
            void pairAction(async () => {
              if (!probe) {
                setProbe(await probeAms(host.trim()));
                return;
              }
              const accessCode = code;
              const token = probe.token;
              setCode('');
              // The server consumes the token even if pairing fails.
              setProbe(null);
              const result = await connectAms(
                token,
                serial.trim().toUpperCase(),
                accessCode,
              );
              if (mounted.current) {
                setInventory(result);
                setPairing(false);
                setProbe(null);
              }
            });
          }}
        >
          <p className="field-note">
            Use your printer’s LAN address and access code. No Bambu account
            login. Credentials are not saved.
          </p>
          <label htmlFor="ams-printer-ip">
            Printer IP
            <Input
              id="ams-printer-ip"
              required
              value={host}
              placeholder="192.168.1.100"
              disabled={busy || !!probe}
              autoComplete="off"
              onChange={(event) => setHost(event.target.value)}
            />
          </label>
          {probe && (
            <>
              <div className="ams-trust">
                <ShieldCheck size={18} />
                <p>
                  First-time certificate trust: only continue on a trusted
                  network with your printer’s IP. This fingerprint is pinned for
                  this session; it is not proof from Bambu Lab.
                </p>
                <code>{probe.fingerprint}</code>
              </div>
              <label htmlFor="ams-printer-serial">
                Printer serial (not AMS / Hub serial)
                <Input
                  id="ams-printer-serial"
                  required
                  value={serial}
                  autoComplete="off"
                  maxLength={32}
                  onChange={(event) => setSerial(event.target.value)}
                />
              </label>
              <label htmlFor="ams-access-code">
                LAN access code
                <Input
                  id="ams-access-code"
                  required
                  type="password"
                  autoComplete="off"
                  value={code}
                  minLength={8}
                  maxLength={8}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
            </>
          )}
          <div className="ams-actions">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : null}
              {probe
                ? 'Trust & connect read-only'
                : 'Check printer certificate'}
            </Button>
            {probe && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setProbe(null);
                  setCode('');
                }}
              >
                Change address
              </Button>
            )}
          </div>
        </form>
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
                            if (label) {
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
      {inventory?.diagnostics && inventory.diagnostics.requestsSent > 0 && (
        <details className="field-note">
          <summary>Connection diagnostics</summary>
          <p>
            Requests written: {inventory.diagnostics.requestsSent} · Reports
            received: {inventory.diagnostics.messagesReceived} · Full AMS
            snapshots: {inventory.diagnostics.fullSnapshots} · Incomplete AMS
            reports: {inventory.diagnostics.incompleteAmsReports} · Retained:{' '}
            {inventory.diagnostics.retainedMessages} · Unreadable:{' '}
            {inventory.diagnostics.invalidMessages}
          </p>
          <p>No credentials or raw printer data are shown.</p>
        </details>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
