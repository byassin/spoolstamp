'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { BatchPreview } from './batch-preview';
import { DESIGNS, FILAMENTS, PRINTERS } from '@/lib/catalog';
import type { BuilderConfiguration } from '@/lib/builder-configuration';
import { effectiveLabelLayout } from '@/lib/label-layout';
import {
  draftKey,
  restoreLabel,
  restoreLabelForBatch,
  savedLabelMatches,
  MAX_COLLECTION_NAME_LENGTH,
  MAX_WORKSPACE_BACKUP_BYTES,
  serializeWorkspaceBackup,
  type SavedWorkspace,
} from '@/lib/saved-workspace';
import type { useSavedWorkspace } from '@/hooks/use-saved-workspace';
import { MAX_BATCH_LABELS } from '@/lib/generate-label-batch';
import { expandBatchQuantities } from '@/lib/batch-quantity';
import type {
  BatchExportLayout,
  PreparedLabelPlates,
} from '@/lib/generate-label-plates';

type Selection = {
  configuration: BuilderConfiguration;
  workspace: SavedWorkspace;
  collectionId: string;
  selected: string[];
  copies: Record<string, number>;
  layout: BatchExportLayout;
};
function rowsFor(value: Selection) {
  const rows = value.collectionId
    ? (value.workspace.collections.find(
        (item) => item.id === value.collectionId,
      )?.labels ?? [])
    : value.workspace.drafts;
  return rows.filter((row) => value.selected.includes(draftKey(row)));
}
function selectionKey(value: Selection) {
  return JSON.stringify({
    collectionId: value.collectionId,
    rows: rowsFor(value).map((row) => ({
      row,
      copies: value.copies[draftKey(row)] ?? 1,
    })),
    printer: value.configuration.printerId,
    design: value.configuration.design,
    labelLayout: value.configuration.labelLayout,
    layout: value.layout,
  });
}
function itemCount(count: number, name: string) {
  return `${count} ${name}${count === 1 ? '' : 's'}`;
}
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
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [layout, setLayout] = useState<BatchExportLayout>('plates');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [importedSetup, setImportedSetup] =
    useState<BuilderConfiguration | null>(null);
  const [collectionId, setCollectionId] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [targetCollection, setTargetCollection] = useState('');
  const [removePending, setRemovePending] = useState(false);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{
    key: string;
    plan: PreparedLabelPlates;
  } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const current = useRef<Selection & { mounted: boolean }>({
    configuration,
    workspace: saved.workspace,
    selected,
    copies,
    layout,
    collectionId,
    mounted: true,
  });
  useLayoutEffect(() => {
    current.current = {
      configuration,
      workspace: saved.workspace,
      selected,
      copies,
      layout,
      collectionId,
      mounted: true,
    };
    return () => {
      current.current.mounted = false;
    };
  }, [configuration, saved.workspace, selected, copies, layout, collectionId]);
  const collection = saved.workspace.collections.find(
    (item) => item.id === collectionId,
  );
  const sourceRows = collectionId
    ? (collection?.labels ?? [])
    : saved.workspace.drafts;
  const selectedRows = rowsFor({
    configuration,
    workspace: saved.workspace,
    selected,
    copies,
    layout,
    collectionId,
  });
  const totalCopies = selectedRows.reduce(
    (total, row) => total + (copies[draftKey(row)] ?? 1),
    0,
  );
  const capture = selectionKey({
    configuration,
    workspace: saved.workspace,
    selected,
    copies,
    layout,
    collectionId,
  });
  const activePlan = preview?.key === capture ? preview.plan : null;
  const visibleRows = sourceRows.filter((row) => savedLabelMatches(row, query));
  function chooseCollection(id: string) {
    setCollectionId(id);
    setSelected([]);
    setCopies({});
    setQuery('');
    setCollectionName(
      saved.workspace.collections.find((item) => item.id === id)?.name ?? '',
    );
    setRemovePending(false);
    setPreviewError('');
  }
  async function exportBackup() {
    try {
      const contents = serializeWorkspaceBackup(saved.workspace, configuration);
      const { downloadBlob } = await import('@/lib/generate-3mf');
      if (!current.current.mounted) return;
      downloadBlob(
        new Blob([contents], { type: 'application/json' }),
        'spoolstamp-workspace.json',
      );
      setFeedback(
        'Backup downloaded: catalog choices and collection names, without Bambu sign-in data.',
      );
    } catch {
      if (current.current.mounted)
        setFeedback(
          'Could not prepare the backup. Your saved items are unchanged.',
        );
    }
  }
  async function importBackup(file: File) {
    setTransferBusy(true);
    setImportedSetup(null);
    try {
      if (file.size > MAX_WORKSPACE_BACKUP_BYTES)
        throw new Error(
          'Choose a Spoolstamp backup smaller than 96 KB. Nothing was imported.',
        );
      const raw = await file.text();
      if (!current.current.mounted) return;
      const result = saved.importBackup(raw);
      setImportedSetup(result.setup);
      setFeedback(
        `Added ${itemCount(result.addedFavorites, 'favorite')}, ${itemCount(result.addedDrafts, 'draft')} and ${itemCount(result.addedCollections, 'collection')}. Existing choices are kept.`,
      );
    } catch (cause) {
      if (current.current.mounted)
        setFeedback(
          cause instanceof Error
            ? cause.message
            : 'Could not read this backup. Nothing was imported.',
        );
    } finally {
      if (current.current.mounted) setTransferBusy(false);
    }
  }
  async function prepareBatch() {
    if (busy || !selectedRows.length) return;
    const key = capture;
    const isCurrent = () =>
      current.current.mounted && selectionKey(current.current) === key;
    setBusy(true);
    setPreview(null);
    setPreviewError('');
    setFeedback('Preparing batch preview…');
    try {
      const labels = expandBatchQuantities(
        selectedRows.map((row) => ({
          label: restoreLabelForBatch(row, configuration.design)!,
          copies: copies[draftKey(row)] ?? 1,
        })),
      );
      const printer = PRINTERS.find(
        (item) => item.id === configuration.printerId,
      )!.fullName;
      const { prepareLabelPlates } =
        await import('@/lib/generate-label-plates');
      if (!isCurrent())
        throw new Error('Saved selection changed. Preview it again.');
      const plan = await prepareLabelPlates({
        labels,
        printer,
        design: configuration.design,
        labelLayout: configuration.labelLayout,
        layout,
        isCurrent,
        onProgress(done, total) {
          if (isCurrent())
            setFeedback(`Prepared ${done} of ${itemCount(total, 'label')}`);
        },
      });
      if (!isCurrent())
        throw new Error('Saved selection changed. Preview it again.');
      setPreview({ key, plan });
      setFeedback(
        'Preview ready. Download uses these exact placements and filament assignments.',
      );
    } catch (cause) {
      if (current.current.mounted) {
        const message =
          cause instanceof Error
            ? cause.message
            : 'Could not prepare this batch. Try again.';
        setPreviewError(message);
        setFeedback(message);
      }
    } finally {
      if (current.current.mounted) setBusy(false);
    }
  }
  async function downloadBatch() {
    if (busy || !activePlan) return;
    const plan = activePlan;
    const key = capture;
    const isCurrent = () =>
      current.current.mounted && selectionKey(current.current) === key;
    setBusy(true);
    try {
      const { generatePreparedLabelPlates } =
        await import('@/lib/generate-label-plates');
      const result = await generatePreparedLabelPlates(plan, { isCurrent });
      const { downloadBlob } = await import('@/lib/generate-3mf');
      if (!isCurrent())
        throw new Error('Saved selection changed. Preview it again.');
      downloadBlob(
        result.blob,
        layout === 'plates'
          ? 'spoolstamp-saved-plates.zip'
          : 'spoolstamp-saved-labels.zip',
      );
      if (current.current.mounted)
        setFeedback(
          `Downloaded ${itemCount(result.labels, 'label')}. Confirm physical spools, brim and purge clearance in Studio.`,
        );
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
              setFeedback('Label draft saved.');
          }}
        >
          Save label draft
        </Button>
      </div>
      <details>
        <summary>
          My saved filaments (
          {itemCount(saved.workspace.drafts.length, 'draft')} ·{' '}
          {itemCount(saved.workspace.collections.length, 'collection')})
        </summary>
        <p className="field-note">
          Saved on this browser. Confirm your physical spools in Studio.
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
        <div className="saved-library-controls">
          <label>
            Labels to print
            <select
              aria-label="Saved label collection"
              value={collection?.id ?? ''}
              disabled={busy}
              onChange={(event) => chooseCollection(event.target.value)}
            >
              <option value="">
                All drafts ({saved.workspace.drafts.length})
              </option>
              {saved.workspace.collections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.labels.length})
                </option>
              ))}
            </select>
          </label>
          <label>
            Find a saved label
            <input
              type="search"
              value={query}
              maxLength={100}
              placeholder="Color, material or code…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {collection && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !sourceRows.length}
              onClick={() => {
                setSelected(sourceRows.map(draftKey));
                setCopies({});
                setQuery('');
                setFeedback(
                  `${itemCount(sourceRows.length, 'collection label')} selected. Choose copies, then preview the batch.`,
                );
              }}
            >
              Select collection
            </Button>
          )}
        </div>
        <details className="saved-collection-tools">
          <summary>
            {collection ? 'Manage collection' : 'Create a collection'}
          </summary>
          <label>
            Collection name
            <input
              value={collectionName}
              maxLength={MAX_COLLECTION_NAME_LENGTH}
              placeholder="e.g. Dry box labels"
              onChange={(event) => setCollectionName(event.target.value)}
            />
          </label>
          <div className="saved-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={!saved.ready || busy || !collectionName.trim()}
              onClick={() => {
                const id = saved.createCollection(
                  collectionName,
                  selectedRows.map((row) => restoreLabel(row)!),
                );
                if (id) {
                  chooseCollection(id);
                  setCollectionName(collectionName.trim());
                  setFeedback('Collection created.');
                }
              }}
            >
              {selectedRows.length
                ? 'Create from selection'
                : 'Create collection'}
            </Button>
            {collection && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !collectionName.trim()}
                  onClick={() => {
                    if (saved.renameCollection(collection.id, collectionName))
                      setFeedback('Collection renamed.');
                  }}
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      saved.addCollectionLabels(collection.id, [configuration])
                    )
                      setFeedback('Current label added to this collection.');
                  }}
                >
                  Add current label
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRemovePending(true)}
                >
                  Remove collection
                </Button>
              </>
            )}
          </div>
          {collection && removePending && (
            <div className="saved-actions">
              <span className="field-note">
                Remove this collection? Separate drafts and favorites stay
                saved.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (saved.removeCollection(collection.id)) {
                    chooseCollection('');
                    setFeedback('Collection removed.');
                  }
                }}
              >
                Confirm remove
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRemovePending(false)}
              >
                Keep collection
              </Button>
            </div>
          )}
        </details>
        <div className="saved-drafts">
          {visibleRows.map((row) => {
            const key = draftKey(row);
            const label = restoreLabel(row)!;
            const name = `${label.filament.product} · ${label.filament.colorName}`;
            const included = selected.includes(key);
            const count = copies[key] ?? 1;
            return (
              <div className="saved-draft" key={key}>
                <strong>{name}</strong>
                <small>
                  {DESIGNS.find((item) => item.id === row.design)?.name ??
                    'Label'}{' '}
                  · {effectiveLabelLayout(row.design, row.labelLayout)} ·{' '}
                  {row.textColor ?? 'Automatic'} text
                </small>
                <div className="saved-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelect(label)}
                    aria-label={`Use draft ${name}`}
                  >
                    Use label
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (collection)
                        saved.removeCollectionLabel(collection.id, key);
                      else saved.removeDraft(key);
                      setSelected((values) =>
                        values.filter((item) => item !== key),
                      );
                    }}
                    aria-label={`Remove saved label ${name}`}
                  >
                    Remove
                  </Button>
                </div>
                <div className="saved-label-quantity">
                  <label className="remember-setup">
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={
                        busy || (!included && totalCopies >= MAX_BATCH_LABELS)
                      }
                      onChange={(event) => {
                        if (event.target.checked)
                          setCopies({ ...copies, [key]: 1 });
                        setSelected(
                          event.target.checked
                            ? [...selected, key]
                            : selected.filter((item) => item !== key),
                        );
                      }}
                    />{' '}
                    Include in batch
                  </label>
                  {included && (
                    <label>
                      Copies
                      <select
                        aria-label={`Copies of ${name}`}
                        value={count}
                        disabled={busy}
                        onChange={(event) =>
                          setCopies({
                            ...copies,
                            [key]: Number(event.target.value),
                          })
                        }
                      >
                        {Array.from(
                          { length: MAX_BATCH_LABELS },
                          (_, index) => index + 1,
                        ).map((amount) => (
                          <option
                            key={amount}
                            value={amount}
                            disabled={
                              totalCopies - count + amount > MAX_BATCH_LABELS
                            }
                          >
                            {amount}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            );
          })}
          {!visibleRows.length && (
            <p className="field-note">
              {sourceRows.length
                ? 'No saved labels match that search.'
                : collection
                  ? 'Add your current label to start this collection.'
                  : 'Save a label draft to build your print list.'}
            </p>
          )}
        </div>
        {!!selectedRows.length && (
          <div className="saved-batch">
            <div className="saved-actions">
              <strong>
                {totalCopies} of {MAX_BATCH_LABELS} copies
              </strong>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSelected([]);
                  setCopies({});
                }}
              >
                Clear selection
              </Button>
            </div>
            {!!saved.workspace.collections.length && (
              <details className="saved-collection-add">
                <summary>Add labels to a collection</summary>
                <label>
                  Add selection to collection
                  <select
                    aria-label="Add selection to collection"
                    value={targetCollection}
                    disabled={busy}
                    onChange={(event) =>
                      setTargetCollection(event.target.value)
                    }
                  >
                    <option value="">Choose a collection…</option>
                    {saved.workspace.collections.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !targetCollection}
                  onClick={() => {
                    if (
                      saved.addCollectionLabels(
                        targetCollection,
                        selectedRows.map((row) => restoreLabel(row)!),
                      )
                    )
                      setFeedback(
                        'Selected labels added. Existing collection labels are kept.',
                      );
                  }}
                >
                  Add selected labels
                </Button>
              </details>
            )}
            <label>
              Batch layout
              <select
                aria-label="Saved batch layout"
                value={layout}
                disabled={busy}
                onChange={(event) =>
                  setLayout(event.target.value as BatchExportLayout)
                }
              >
                <option value="plates">
                  Arrange compatible labels on plates
                </option>
                <option value="separate">Separate 3MF projects</option>
              </select>
            </label>
            <p className="field-note">
              Uses your current design and printer, with each saved label’s text
              choices. Preview before downloading.
            </p>
            <div className="saved-actions">
              <Button
                variant="outline"
                disabled={busy || totalCopies > MAX_BATCH_LABELS}
                onClick={() => void prepareBatch()}
              >
                {busy ? 'Preparing…' : 'Preview batch'}
              </Button>
              <Button
                disabled={busy || !activePlan}
                onClick={() => void downloadBatch()}
              >
                Download {itemCount(totalCopies, 'label')}
              </Button>
            </div>
            <BatchPreview plan={activePlan} busy={busy} error={previewError} />
          </div>
        )}
        <details className="workspace-transfer">
          <summary>Backup &amp; restore</summary>
          <p className="field-note">
            Move catalog choices and collection names to another browser.
            Imports keep your existing items.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!saved.ready || busy || transferBusy}
            onClick={() => void exportBackup()}
          >
            Download backup
          </Button>
          <label className="workspace-backup-file">
            Import a Spoolstamp backup
            <input
              type="file"
              accept=".json,application/json"
              disabled={!saved.ready || busy || transferBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importBackup(file);
              }}
            />
          </label>
          {transferBusy && <p className="field-note">Checking backup…</p>}
          {importedSetup && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || transferBusy}
              onClick={() => {
                onSelect(importedSetup);
                setImportedSetup(null);
                setFeedback(
                  'Imported setup selected. Save it as a draft to keep it.',
                );
              }}
            >
              Use imported setup
            </Button>
          )}
        </details>
      </details>
      {(saved.notice || feedback) && (
        <output className="field-note" aria-live="polite">
          {saved.notice ||
            (feedback.startsWith('Preview ready.') && !activePlan
              ? 'Choices changed. Preview the batch again.'
              : feedback)}
        </output>
      )}
    </section>
  );
}
