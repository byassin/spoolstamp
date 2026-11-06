import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FILAMENTS } from '../lib/catalog';
import { INITIAL_CONFIGURATION } from '../lib/builder-configuration';
import {
  addCollectionLabels,
  collectionName,
  createCollection,
  draftKey,
  emptyWorkspace,
  MAX_COLLECTION_LABELS,
  MAX_COLLECTIONS,
  mergeWorkspaceBackup,
  parseWorkspace,
  parseWorkspaceBackup,
  removeCollection,
  removeCollectionLabel,
  renameCollection,
  restoreLabel,
  restoreLabelForBatch,
  savedLabelMatches,
  saveLabel,
  serializeWorkspaceBackup,
} from '../lib/saved-workspace';

const draft = saveLabel(INITIAL_CONFIGURATION);
const other = saveLabel({
  ...INITIAL_CONFIGURATION,
  filament: FILAMENTS.find((item) => item.id !== draft.filamentId)!,
});
const backup = (collections: unknown[]) =>
  JSON.stringify({
    format: 'spoolstamp-workspace',
    version: 1,
    setup: null,
    favorites: [],
    drafts: [],
    collections,
  });
const collection = (labels = [draft]) => ({
  id: 'collection-example',
  name: 'Dry box',
  labels,
});

describe('local named label collections', () => {
  it('deduplicates semantic default layouts and ignores unrelated fields across storage, collections and imports', () => {
    for (const design of [
      'drybox-tab',
      'adhesive-label',
      'rounded-adhesive-label',
    ] as const) {
      const old = { ...draft, design };
      expect(draftKey(old)).toBe(draftKey({ ...old, labelLayout: 'detailed' }));
      expect(draftKey(old)).not.toBe(
        draftKey({ ...old, labelLayout: 'simple' }),
      );
    }
    const clip = { ...draft, design: 'clip-label' as const };
    expect(draftKey(clip)).toBe(draftKey({ ...clip, labelLayout: 'detailed' }));
    expect(draftKey(clip)).toBe(draftKey({ ...clip, labelLayout: 'simple' }));
    const unknown = { ...draft, token: 'ignored', arbitrary: 'ignored' };
    expect(draftKey(unknown)).toBe(draftKey(draft));
    const explicit = { ...draft, labelLayout: 'detailed' as const };
    const stored = parseWorkspace(
      JSON.stringify({
        ...emptyWorkspace(),
        drafts: [draft, explicit, unknown],
      }),
    );
    expect(stored.drafts).toEqual([draft]);
    const created = createCollection(stored, 'Duplicates', [draft, explicit]);
    expect(created.collection.labels).toEqual([draft]);
    const input = JSON.stringify({
      format: 'spoolstamp-workspace',
      version: 1,
      setup: null,
      favorites: [],
      drafts: [explicit],
      collections: [{ ...created.collection, labels: [explicit] }],
    });
    const merged = mergeWorkspaceBackup(created.workspace, input);
    expect(merged.addedDrafts).toBe(0);
    expect(merged.addedCollections).toBe(0);
    expect(merged.workspace.collections).toEqual(created.workspace.collections);
  });
  it('keeps the synthetic screenshot fixture catalog-valid and free of cloud identity', () => {
    const raw = readFileSync(
      new URL('./fixtures/workspace-v040.json', import.meta.url),
      'utf8',
    );
    const fixture = parseWorkspaceBackup(raw);
    expect(fixture.setup?.design).toBe('rounded-adhesive-label');
    expect(fixture.setup?.labelLayout).toBe('simple');
    expect(fixture.collections?.[0].name).toBe('PLA drawer');
    expect(fixture.collections?.[0].labels).toHaveLength(3);
    expect(raw).not.toMatch(/email|token|serial|remaining|csrf|updatedAt/);
  });
  it('uses explicit saved layout defaults for batch design rather than inheriting the current builder layout', () => {
    expect(restoreLabelForBatch(draft, 'drybox-tab')?.labelLayout).toBe(
      'detailed',
    );
    expect(
      restoreLabelForBatch({ ...draft, design: 'clip-label' }, 'adhesive-label')
        ?.labelLayout,
    ).toBe('detailed');
    expect(
      restoreLabelForBatch({ ...draft, labelLayout: 'simple' }, 'drybox-tab')
        ?.labelLayout,
    ).toBe('simple');
    expect(
      restoreLabelForBatch({ ...draft, labelLayout: 'detailed' }, 'clip-label')
        ?.labelLayout,
    ).toBe('simple');
    const oldSaved = restoreLabelForBatch(draft, 'adhesive-label')!;
    expect(oldSaved.design).toBe('adhesive-label');
    expect(
      { ...INITIAL_CONFIGURATION, labelLayout: 'simple', ...oldSaved }
        .labelLayout,
    ).toBe('detailed');
  });
  it('loads old v1 storage/backups without losing setup, favorites or drafts', () => {
    const old = {
      version: 1,
      remember: true,
      setup: draft,
      favorites: [draft.filamentId],
      drafts: [draft],
    };
    const restored = parseWorkspace(JSON.stringify(old));
    expect(restored).toEqual({ ...old, collections: [] });
    const oldBackup = JSON.stringify({
      format: 'spoolstamp-workspace',
      version: 1,
      setup: draft,
      favorites: old.favorites,
      drafts: old.drafts,
    });
    const merged = mergeWorkspaceBackup(emptyWorkspace(), oldBackup);
    expect(merged.workspace.drafts).toEqual([draft]);
    expect(merged.workspace.favorites).toEqual(old.favorites);
    expect(merged.workspace.collections).toEqual([]);
    expect(merged.setup?.filament.id).toBe(draft.filamentId);
    expect(merged.workspace.remember).toBe(false);
  });
  it('creates, renames, adds and removes without changing separate drafts or the source workspace', () => {
    const start = { ...emptyWorkspace(), drafts: [draft] };
    const before = structuredClone(start);
    const created = createCollection(start, '  Dry box  ', [draft, draft]);
    expect(created.collection.id).toMatch(/^collection-[a-z0-9-]+$/);
    expect(created.collection.name).toBe('Dry box');
    expect(created.collection.labels).toEqual([draft]);
    const added = addCollectionLabels(
      created.workspace,
      created.collection.id,
      [other, draft],
    );
    const renamed = renameCollection(added, created.collection.id, 'Reprints');
    expect(renamed.collections[0].labels).toEqual([draft, other]);
    expect(renamed.collections[0].name).toBe('Reprints');
    const removedLabel = removeCollectionLabel(
      renamed,
      created.collection.id,
      draftKey(draft),
    );
    expect(removedLabel.collections[0].labels).toEqual([other]);
    expect(
      removeCollection(removedLabel, created.collection.id).drafts,
    ).toEqual([draft]);
    expect(start).toEqual(before);
    expect(() => createCollection(renamed, 'REPRINTS')).toThrow('already uses');
  });
  it('enforces collection and label capacities atomically', () => {
    const labels = FILAMENTS.slice(0, MAX_COLLECTION_LABELS).map((filament) =>
      saveLabel({ ...INITIAL_CONFIGURATION, filament }),
    );
    const created = createCollection(emptyWorkspace(), 'Full', labels);
    const before = structuredClone(created.workspace);
    const extra = saveLabel({
      ...INITIAL_CONFIGURATION,
      filament: FILAMENTS[MAX_COLLECTION_LABELS],
    });
    expect(() =>
      addCollectionLabels(created.workspace, created.collection.id, [extra]),
    ).toThrow('Nothing was added');
    expect(created.workspace).toEqual(before);
    let full = emptyWorkspace();
    for (let index = 0; index < MAX_COLLECTIONS; index++)
      full = createCollection(full, `Box ${index}`).workspace;
    expect(() => createCollection(full, 'Extra')).toThrow('make room');
    const fullBefore = structuredClone(full);
    const input = JSON.stringify({
      format: 'spoolstamp-workspace',
      version: 1,
      setup: null,
      favorites: [draft.filamentId],
      drafts: [draft],
      collections: [collection()],
    });
    expect(() => mergeWorkspaceBackup(full, input)).toThrow(
      'Nothing was imported',
    );
    expect(full).toEqual(fullBefore);
  });
  it('round trips detailed/simple choices while omitted old layouts clear a current override', () => {
    for (const labelLayout of ['simple', 'detailed'] as const) {
      const configuration = { ...INITIAL_CONFIGURATION, labelLayout };
      const row = saveLabel(configuration);
      expect(restoreLabel(row)?.labelLayout).toBe(labelLayout);
      const workspace = createCollection(emptyWorkspace(), labelLayout, [
        row,
      ]).workspace;
      expect(
        parseWorkspaceBackup(serializeWorkspaceBackup(workspace))
          .collections?.[0].labels[0].labelLayout,
      ).toBe(labelLayout);
    }
    const restored = restoreLabel(draft)!;
    expect(
      { ...INITIAL_CONFIGURATION, labelLayout: 'simple', ...restored }
        .labelLayout,
    ).toBeUndefined();
    expect(restoreLabel({ ...draft, labelLayout: 'unknown' })).toBeNull();
  });
  it('strictly rejects malformed names, IDs, collection fields and nested secret fields', () => {
    for (const name of [
      '',
      ' '.repeat(4),
      'x'.repeat(41),
      'a\nb',
      '\u202eprivate',
      '\u200b',
      '\ud800',
    ])
      expect(() => collectionName(name)).toThrow();
    expect(collectionName(' Workshop 🎨 ')).toBe('Workshop 🎨');
    for (const row of [
      { ...collection(), id: '../private' },
      { ...collection(), id: 'collection-' },
      { ...collection(), name: 'Untrimmed ' },
      { ...collection(), name: 'x'.repeat(41) },
      { ...collection(), labels: [{ ...draft, token: 'private' }] },
      { ...collection(), labels: [{ ...draft, labelLayout: 'unknown' }] },
      { ...collection(), serial: 'PRIVATE' },
      { ...collection(), labels: Array(MAX_COLLECTION_LABELS + 1).fill(draft) },
    ])
      expect(() => parseWorkspaceBackup(backup([row]))).toThrow(
        'invalid collection',
      );
    expect(() =>
      parseWorkspaceBackup(backup([collection(), collection()])),
    ).toThrow('duplicate collection IDs');
    const recovered = parseWorkspace(
      JSON.stringify({
        ...emptyWorkspace(),
        drafts: [draft],
        collections: [collection(), { ...collection(), id: '../bad' }],
      }),
    );
    expect(recovered.drafts).toEqual([draft]);
    expect(recovered.collections).toEqual([collection()]);
  });
  it('keeps catalog-only data, supports search, and uses effective clip layout', () => {
    const loaded = parseWorkspace(
      JSON.stringify({
        ...emptyWorkspace(),
        collections: [
          collection([{ ...draft, token: 'private' } as typeof draft]),
        ],
      }),
    );
    expect(serializeWorkspaceBackup(loaded)).not.toMatch(
      /private|token|serial|remaining|email/,
    );
    expect(
      savedLabelMatches(
        draft,
        `${INITIAL_CONFIGURATION.filament.material} ${INITIAL_CONFIGURATION.filament.colorCode}`,
      ),
    ).toBe(true);
    expect(savedLabelMatches(draft, 'not-a-catalog-color')).toBe(false);
    expect(
      savedLabelMatches(
        { ...draft, design: 'clip-label', labelLayout: 'detailed' },
        'simple',
      ),
    ).toBe(true);
    expect(
      savedLabelMatches(
        { ...draft, design: 'clip-label', labelLayout: 'detailed' },
        'detailed',
      ),
    ).toBe(false);
  });
  it('merges ID/name conflicts without overwriting and makes repeated imports idempotent', () => {
    const current = {
      ...emptyWorkspace(),
      drafts: [draft],
      collections: [collection()],
    };
    const before = structuredClone(current);
    const raw = backup([collection([other])]);
    const result = mergeWorkspaceBackup(current, raw);
    expect(result.addedCollections).toBe(1);
    expect(result.workspace.collections[0]).toEqual(collection());
    expect(result.workspace.collections[1].id).not.toBe(collection().id);
    expect(result.workspace.collections[1].name).toBe('Dry box (2)');
    expect(result.workspace.collections[1].labels).toEqual([other]);
    expect(mergeWorkspaceBackup(result.workspace, raw).addedCollections).toBe(
      0,
    );
    expect(current).toEqual(before);
  });
  it('deduplicates repeat imports after a name-only conflict or a local rename', () => {
    const current = { ...emptyWorkspace(), collections: [collection()] };
    const incoming = { ...collection([other]), id: 'collection-another-box' };
    const raw = backup([incoming]);
    const first = mergeWorkspaceBackup(current, raw);
    expect(first.workspace.collections[1]).toEqual({
      ...incoming,
      name: 'Dry box (2)',
    });
    const again = mergeWorkspaceBackup(first.workspace, raw);
    expect(again.addedCollections).toBe(0);
    expect(again.workspace.collections).toEqual(first.workspace.collections);
    const renamed = renameCollection(
      first.workspace,
      incoming.id,
      'My preferred name',
    );
    const afterRename = mergeWorkspaceBackup(renamed, raw);
    expect(afterRename.addedCollections).toBe(0);
    expect(afterRename.workspace.collections[1].name).toBe('My preferred name');
    expect(current.collections).toEqual([collection()]);
  });
});
