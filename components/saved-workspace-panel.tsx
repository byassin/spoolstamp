'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { FILAMENTS, PRINTERS } from '@/lib/catalog';
import type { BuilderConfiguration } from '@/lib/builder-configuration';
import { draftKey, restoreLabel } from '@/lib/saved-workspace';
import type { useSavedWorkspace } from '@/hooks/use-saved-workspace';
import { MAX_BATCH_LABELS } from '@/lib/generate-label-batch';

export function SavedWorkspacePanel({
  configuration,
  saved,
  onSelect,
}: {
  configuration: BuilderConfiguration;
  saved: ReturnType<typeof useSavedWorkspace>;
  onSelect: (value: Partial<BuilderConfiguration>) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [layout, setLayout] = useState('plates');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const current = useRef({
    configuration,
    workspace: saved.workspace,
    selected,
    layout,
    mounted: true,
  });
  useLayoutEffect(() => {
    current.current = {
      configuration,
      workspace: saved.workspace,
      selected,
      layout,
      mounted: true,
    };
    return () => {
      current.current.mounted = false;
    };
  }, [configuration, saved.workspace, selected, layout]);
  const selectedDrafts = saved.workspace.drafts.filter((row) =>
    selected.includes(draftKey(row)),
  );
  async function exportDrafts() {
    if (busy || !selectedDrafts.length) return;
    const capture = JSON.stringify({
      drafts: selectedDrafts,
      printer: configuration.printerId,
      design: configuration.design,
      layout,
    });
    const isCurrent = () => {
      const value = current.current;
      return (
        value.mounted &&
        capture ===
          JSON.stringify({
            drafts: value.workspace.drafts.filter((row) =>
              value.selected.includes(draftKey(row)),
            ),
            printer: value.configuration.printerId,
            design: value.configuration.design,
            layout: value.layout,
          })
      );
    };
    setBusy(true);
    setFeedback('Preparing saved labels…');
    try {
      const labels = selectedDrafts.map((row) => restoreLabel(row)!);
      const printer = PRINTERS.find(
        (item) => item.id === configuration.printerId,
      )!.fullName;
      const options = {
        labels,
        printer,
        design: configuration.design,
        isCurrent,
        onProgress(done: number, total: number) {
          if (current.current.mounted)
            setFeedback(`Prepared ${done} of ${total} labels`);
        },
      };
      const { downloadBlob } = await import('@/lib/generate-3mf');
      if (layout === 'plates') {
        const { generateLabelPlates } =
          await import('@/lib/generate-label-plates');
        const result = await generateLabelPlates(options);
        if (!isCurrent())
          throw new Error('Saved selection changed. Try again.');
        downloadBlob(result.blob, 'spoolstamp-saved-plates.zip');
        if (current.current.mounted)
          setFeedback(
            `Downloaded ${result.plates} plate project(s). Confirm physical spools and placement in Studio before slicing.`,
          );
      } else {
        const { generateLabelBatch } =
          await import('@/lib/generate-label-batch');
        const blob = await generateLabelBatch(options);
        if (!isCurrent())
          throw new Error('Saved selection changed. Try again.');
        downloadBlob(blob, 'spoolstamp-saved-labels.zip');
        if (current.current.mounted)
          setFeedback(
            `Downloaded ${labels.length} separate projects. Confirm physical spools in Studio.`,
          );
      }
    } catch (cause) {
      if (current.current.mounted)
        setFeedback(
          cause instanceof Error ? cause.message : 'Export failed. Try again.',
        );
    } finally {
      if (current.current.mounted) setBusy(false);
    }
  }
  return (
    <section className="saved-workspace" aria-label="Saved workspace">
      <label className="remember-setup">
        <input
          type="checkbox"
          checked={saved.workspace.remember}
          disabled={!saved.ready}
          onChange={(event) => saved.remember(event.target.checked)}
        />{' '}
        Remember my setup on this browser
      </label>
      <div className="saved-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={!saved.ready}
          aria-pressed={saved.workspace.favorites.includes(
            configuration.filament.id,
          )}
          onClick={() => saved.favorite(configuration.filament.id)}
        >
          {saved.workspace.favorites.includes(configuration.filament.id)
            ? 'Remove favorite'
            : 'Save favorite'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!saved.ready}
          onClick={() => {
            if (saved.saveDraft(configuration))
              setFeedback('Label draft saved. It is not live AMS inventory.');
          }}
        >
          Save label draft
        </Button>
      </div>
      <details>
        <summary>
          My saved filaments ({saved.workspace.favorites.length} favorites ·{' '}
          {saved.workspace.drafts.length} drafts)
        </summary>
        <p className="field-note">
          Only catalog choices are saved on this browser—not Bambu login data or
          printer identifiers. Drafts are not live inventory; confirm your
          physical spools in Studio.
        </p>
        {!!saved.workspace.favorites.length && (
          <label>
            Favorite filament
            <select
              aria-label="Favorite filament"
              value=""
              onChange={(event) => {
                const filament = FILAMENTS.find(
                  (item) => item.id === event.target.value,
                );
                if (filament) onSelect({ filament });
              }}
            >
              <option value="">Choose a favorite…</option>
              {saved.workspace.favorites.map((id) => {
                const item = FILAMENTS.find((row) => row.id === id)!;
                return (
                  <option value={id} key={id}>
                    {item.product} · {item.colorName}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <div className="saved-drafts">
          {saved.workspace.drafts.map((row) => {
            const key = draftKey(row);
            const label = restoreLabel(row)!;
            const name = `${label.filament.product} · ${label.filament.colorName}`;
            return (
              <div className="saved-draft" key={key}>
                <strong>{name}</strong>
                <small>
                  {row.design === 'drybox-tab'
                    ? 'Hinged label'
                    : 'Clip-on label'}{' '}
                  · {row.textColor ?? 'Automatic'} text ·{' '}
                  {row.textFilamentProduct ?? 'Default text profile'}
                </small>
                <div className="saved-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelect(label)}
                    aria-label={`Use draft ${name}`}
                  >
                    Use draft
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      saved.removeDraft(key);
                      setSelected((values) =>
                        values.filter((item) => item !== key),
                      );
                    }}
                    aria-label={`Remove draft ${name}`}
                  >
                    Remove
                  </Button>
                </div>
                <label className="remember-setup">
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    disabled={
                      busy ||
                      (!selected.includes(key) &&
                        selectedDrafts.length >= MAX_BATCH_LABELS)
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, key]
                          : selected.filter((item) => item !== key),
                      )
                    }
                  />{' '}
                  Include in saved batch
                </label>
              </div>
            );
          })}
        </div>
        {!!selectedDrafts.length && (
          <div className="saved-batch">
            <label>
              Saved batch layout
              <select
                aria-label="Saved batch layout"
                value={layout}
                disabled={busy}
                onChange={(event) => setLayout(event.target.value)}
              >
                <option value="plates">
                  Arrange compatible labels on plates
                </option>
                <option value="separate">Separate 3MF projects</option>
              </select>
            </label>
            <p className="field-note">
              Uses your current design and printer. Different body/text product
              pairs, extra colors and bed limits produce separate plates. Studio
              still checks brim and purge-tower clearance.
            </p>
            <Button disabled={busy} onClick={() => void exportDrafts()}>
              {busy
                ? 'Preparing…'
                : `Download ${selectedDrafts.length} saved labels`}
            </Button>
          </div>
        )}
      </details>
      {(saved.notice || feedback) && (
        <output className="field-note" aria-live="polite">
          {saved.notice || feedback}
        </output>
      )}
    </section>
  );
}
