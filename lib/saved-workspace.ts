import { FILAMENTS, normalizeDesignId, type DesignId } from './catalog';
import { effectiveLabelLayout } from './label-layout';
import {
  INITIAL_CONFIGURATION,
  resolveConfiguration,
  type BuilderConfiguration,
} from './builder-configuration';

export const WORKSPACE_KEY = 'spoolstamp.workspace.v2';
export const LEGACY_WORKSPACE_KEY = 'spoolstamp.workspace.v1';
export const MAX_SAVED_ITEMS = 16;
export const MAX_COLLECTIONS = 8;
export const MAX_COLLECTION_LABELS = 8;
export const MAX_COLLECTION_NAME_LENGTH = 40;
export const MAX_WORKSPACE_BACKUP_BYTES = 96_000;
export const WORKSPACE_CHANGED_NOTICE =
  'Your saved workspace changed in another tab. The latest items are loaded; try your action again.';

/** Compare the last actual storage value, not a reserialized/sanitized workspace. */
export function workspaceRevisionChanged(
  expected: string | null | undefined,
  actual: string | null,
) {
  return expected === undefined ? actual !== null : expected !== actual;
}
export type SavedLabel = {
  filamentId: string;
  printerId: string;
  design: BuilderConfiguration['design'];
  textColor?: BuilderConfiguration['textColor'];
  textFilamentProduct?: string;
  labelLayout?: BuilderConfiguration['labelLayout'];
};
export type SavedCollection = {
  id: string;
  name: string;
  labels: SavedLabel[];
};
export type SavedWorkspace = {
  version: 1;
  remember: boolean;
  setup: SavedLabel | null;
  favorites: string[];
  drafts: SavedLabel[];
  collections: SavedCollection[];
};
export const emptyWorkspace = (): SavedWorkspace => ({
  version: 1,
  remember: false,
  setup: null,
  favorites: [],
  drafts: [],
  collections: [],
});

/** Only catalog/configuration fields leave this function. Never serialize a session or inventory. */
export function saveLabel(value: BuilderConfiguration): SavedLabel {
  return {
    filamentId: value.filament.id,
    printerId: value.printerId,
    design: normalizeDesignId(value.design) as DesignId,
    ...(value.textColor ? { textColor: value.textColor } : {}),
    ...(value.labelLayout ? { labelLayout: value.labelLayout } : {}),
    ...(value.textFilamentProduct
      ? { textFilamentProduct: value.textFilamentProduct }
      : {}),
  };
}
export function restoreLabel(value: unknown): BuilderConfiguration | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const filament = FILAMENTS.find((item) => item.id === row.filamentId);
  if (
    !filament ||
    typeof row.printerId !== 'string' ||
    typeof row.design !== 'string'
  )
    return null;
  try {
    const restored = resolveConfiguration(
      {
        printerId: row.printerId,
        design: row.design,
        ...(row.textColor === undefined ? {} : { textColor: row.textColor }),
        ...(row.labelLayout === undefined
          ? {}
          : { labelLayout: row.labelLayout }),
        ...(row.textFilamentProduct === undefined
          ? {}
          : { textFilamentProduct: row.textFilamentProduct }),
      },
      { ...INITIAL_CONFIGURATION, filament },
    );
    // Restoring a full draft must clear an old override, not inherit it via a partial merge.
    return {
      ...restored,
      textFilamentProduct: restored.textFilamentProduct,
      labelLayout: restored.labelLayout,
    };
  } catch {
    return null;
  }
}
export function draftKey(row: SavedLabel) {
  return JSON.stringify({
    filamentId: row.filamentId,
    printerId: row.printerId,
    design: normalizeDesignId(row.design),
    textColor: row.textColor,
    textFilamentProduct: row.textFilamentProduct,
    labelLayout: effectiveLabelLayout(row.design, row.labelLayout),
  });
}
function labelListKey(rows: SavedLabel[]) {
  return JSON.stringify(rows.map(draftKey));
}

/** Explicit defaults stop the builder's current layout overriding an older saved label. */
export function restoreLabelForBatch(
  row: SavedLabel,
  design: DesignId,
): BuilderConfiguration | null {
  const restored = restoreLabel(row);
  return restored
    ? {
        ...restored,
        design: normalizeDesignId(design) as DesignId,
        labelLayout: effectiveLabelLayout(design, row.labelLayout),
      }
    : null;
}

export function collectionName(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Enter a collection name.');
  const name = input.trim().normalize('NFC');
  if (
    !name ||
    Array.from(name).length > MAX_COLLECTION_NAME_LENGTH ||
    Array.from(name).some((character) => {
      const code = character.codePointAt(0)!;
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        (code >= 0x200b && code <= 0x200f) ||
        code === 0xfeff ||
        (code >= 0x2028 && code <= 0x202e) ||
        (code >= 0x2060 && code <= 0x206f)
      );
    })
  )
    throw new Error(
      `Use a collection name with 1–${MAX_COLLECTION_NAME_LENGTH} visible characters.`,
    );
  return name;
}
function validCollectionId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length <= 64 &&
    /^collection-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
  );
}
function newCollectionId() {
  return `collection-${crypto.randomUUID()}`;
}
/** Stable import identity prevents repeated imports of a conflicting ID making more copies. */
function importedCollectionId(collection: SavedCollection) {
  let hash = 2166136261;
  for (const character of JSON.stringify({
    id: collection.id,
    name: collection.name,
    labels: labelListKey(collection.labels),
  }))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `collection-import-${(hash >>> 0).toString(36)}`;
}
function uniqueLabels(inputs: unknown[], strict: boolean): SavedLabel[] {
  const rows: SavedLabel[] = [];
  for (const input of inputs) {
    const row = strict
      ? backupLabel(input)
      : (() => {
          const restored = restoreLabel(input);
          return restored ? saveLabel(restored) : null;
        })();
    if (row && !rows.some((item) => draftKey(item) === draftKey(row)))
      rows.push(row);
  }
  return rows;
}
function readCollection(
  input: unknown,
  strict: boolean,
): SavedCollection | null {
  try {
    if (
      !exactKeys(input, ['id', 'name', 'labels']) ||
      !validCollectionId(input.id) ||
      !Array.isArray(input.labels) ||
      input.labels.length > MAX_COLLECTION_LABELS
    )
      throw new Error('Invalid collection.');
    const name = collectionName(input.name);
    if (strict && name !== input.name)
      throw new Error('Invalid collection name.');
    return { id: input.id, name, labels: uniqueLabels(input.labels, strict) };
  } catch {
    if (strict)
      throw new Error(
        'This backup contains an invalid collection. Nothing was imported.',
      );
    return null;
  }
}

/** Search catalog descriptions only; this never examines cloud or account data. */
export function savedLabelMatches(row: SavedLabel, query: string): boolean {
  const configuration = restoreLabel(row);
  if (!configuration) return false;
  const filament = configuration.filament;
  const text = [
    filament.product,
    filament.material,
    filament.colorName,
    filament.colorCode,
    row.design,
    row.textColor ?? 'automatic',
    row.textFilamentProduct ?? '',
    effectiveLabelLayout(row.design, row.labelLayout),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((part) => text.includes(part));
}

function checkCollectionName(
  workspace: SavedWorkspace,
  name: string,
  except?: string,
) {
  if (
    workspace.collections.some(
      (row) =>
        row.id !== except &&
        row.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    throw new Error(
      'A collection already uses that name. Choose another name.',
    );
}
export function createCollection(
  workspace: SavedWorkspace,
  input: string,
  labels: SavedLabel[] = [],
) {
  const name = collectionName(input);
  checkCollectionName(workspace, name);
  if (workspace.collections.length >= MAX_COLLECTIONS)
    throw new Error(
      `You can keep ${MAX_COLLECTIONS} collections. Remove one to make room.`,
    );
  const rows = uniqueLabels(labels, true);
  if (rows.length > MAX_COLLECTION_LABELS)
    throw new Error(
      `A collection holds up to ${MAX_COLLECTION_LABELS} labels.`,
    );
  const collection = { id: newCollectionId(), name, labels: rows };
  return {
    workspace: {
      ...workspace,
      collections: [...workspace.collections, collection],
    },
    collection,
  };
}
export function renameCollection(
  workspace: SavedWorkspace,
  id: string,
  input: string,
): SavedWorkspace {
  const name = collectionName(input);
  checkCollectionName(workspace, name, id);
  if (!workspace.collections.some((row) => row.id === id))
    throw new Error('Choose an existing collection.');
  return {
    ...workspace,
    collections: workspace.collections.map((row) =>
      row.id === id ? { ...row, name } : row,
    ),
  };
}
export function addCollectionLabels(
  workspace: SavedWorkspace,
  id: string,
  labels: SavedLabel[],
): SavedWorkspace {
  const collection = workspace.collections.find((row) => row.id === id);
  if (!collection) throw new Error('Choose an existing collection.');
  const rows = uniqueLabels([...collection.labels, ...labels], true);
  if (rows.length > MAX_COLLECTION_LABELS)
    throw new Error(
      `A collection holds up to ${MAX_COLLECTION_LABELS} labels. Nothing was added.`,
    );
  return {
    ...workspace,
    collections: workspace.collections.map((row) =>
      row.id === id ? { ...row, labels: rows } : row,
    ),
  };
}
export function removeCollectionLabel(
  workspace: SavedWorkspace,
  id: string,
  key: string,
): SavedWorkspace {
  return {
    ...workspace,
    collections: workspace.collections.map((row) =>
      row.id === id
        ? {
            ...row,
            labels: row.labels.filter((label) => draftKey(label) !== key),
          }
        : row,
    ),
  };
}
export function removeCollection(
  workspace: SavedWorkspace,
  id: string,
): SavedWorkspace {
  return {
    ...workspace,
    collections: workspace.collections.filter((row) => row.id !== id),
  };
}
export function parseWorkspace(raw: string | null): SavedWorkspace {
  const empty = emptyWorkspace();
  if (
    !raw ||
    raw.length > MAX_WORKSPACE_BACKUP_BYTES ||
    new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BACKUP_BYTES
  )
    return empty;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1) return empty;
    const remember = value.remember === true;
    const setup = remember ? restoreLabel(value.setup) : null;
    const favorites = Array.isArray(value.favorites)
      ? [
          ...new Set<string>(
            value.favorites.filter(
              (id: unknown) =>
                typeof id === 'string' &&
                FILAMENTS.some((item) => item.id === id),
            ),
          ),
        ].slice(0, MAX_SAVED_ITEMS)
      : [];
    const drafts: SavedLabel[] = [];
    if (Array.isArray(value.drafts))
      for (const input of value.drafts.slice(0, MAX_SAVED_ITEMS)) {
        const restored = restoreLabel(input);
        if (!restored) continue;
        const row = saveLabel(restored);
        if (!drafts.some((item) => draftKey(item) === draftKey(row)))
          drafts.push(row);
      }
    const collections: SavedCollection[] = [];
    if (Array.isArray(value.collections))
      for (const input of value.collections.slice(0, MAX_COLLECTIONS)) {
        const collection = readCollection(input, false);
        if (collection && !collections.some((row) => row.id === collection.id))
          collections.push(collection);
      }
    return {
      version: 1,
      remember,
      setup: setup ? saveLabel(setup) : null,
      favorites,
      drafts,
      collections,
    };
  } catch {
    return empty;
  }
}

/** Isolate new fields from old tabs that still rewrite the legacy namespace. */
export function loadStoredWorkspace(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): {
  workspace: SavedWorkspace;
  revision: string | null | undefined;
  persistent: boolean;
} {
  let workspace = emptyWorkspace();
  let revision: string | null | undefined;
  try {
    const raw = storage.getItem(WORKSPACE_KEY);
    revision = raw;
    if (raw !== null)
      return { workspace: parseWorkspace(raw), revision, persistent: true };
    const legacy = storage.getItem(LEGACY_WORKSPACE_KEY);
    workspace = parseWorkspace(legacy);
    // Another current-version tab may have initialized or edited while legacy was read.
    const latest = storage.getItem(WORKSPACE_KEY);
    revision = latest;
    if (latest !== null)
      return { workspace: parseWorkspace(latest), revision, persistent: true };
    if (legacy !== null) {
      const migrated = JSON.stringify(workspace);
      storage.setItem(WORKSPACE_KEY, migrated);
      revision = migrated;
    }
    return { workspace, revision, persistent: true };
  } catch {
    // Preserve any recovered choices for this visit if reads or quota prevent migration.
    return { workspace, revision, persistent: false };
  }
}

export type WorkspaceBackup = {
  format: 'spoolstamp-workspace';
  version: 1;
  setup: SavedLabel | null;
  favorites: string[];
  drafts: SavedLabel[];
  collections?: SavedCollection[];
};

function exactKeys(
  value: unknown,
  allowed: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function backupLabel(value: unknown): SavedLabel {
  if (
    !exactKeys(value, [
      'filamentId',
      'printerId',
      'design',
      'textColor',
      'textFilamentProduct',
      'labelLayout',
    ])
  )
    throw new Error(
      'This backup contains unsupported label fields. Nothing was imported.',
    );
  const restored = restoreLabel(value);
  if (!restored)
    throw new Error(
      'This backup contains a label that is not in the current catalog. Nothing was imported.',
    );
  return saveLabel(restored);
}

/** Strict file transfer validation: unlike storage recovery, never silently drop invalid records. */
export function parseWorkspaceBackup(raw: string): WorkspaceBackup {
  if (
    raw.length > MAX_WORKSPACE_BACKUP_BYTES ||
    new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BACKUP_BYTES
  )
    throw new Error(
      'Choose a Spoolstamp backup smaller than 96 KB. Nothing was imported.',
    );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      'This is not a valid Spoolstamp backup. Nothing was imported.',
    );
  }
  if (
    !exactKeys(value, [
      'format',
      'version',
      'setup',
      'favorites',
      'drafts',
      'collections',
    ]) ||
    value.format !== 'spoolstamp-workspace' ||
    value.version !== 1 ||
    !Array.isArray(value.favorites) ||
    !Array.isArray(value.drafts) ||
    !Object.hasOwn(value, 'setup')
  )
    throw new Error(
      'This backup format is not supported. Nothing was imported.',
    );
  if (
    value.favorites.length > MAX_SAVED_ITEMS ||
    value.drafts.length > MAX_SAVED_ITEMS
  )
    throw new Error(
      `A backup can contain up to ${MAX_SAVED_ITEMS} favorites and ${MAX_SAVED_ITEMS} drafts. Nothing was imported.`,
    );
  const favorites: string[] = [];
  for (const id of value.favorites) {
    if (typeof id !== 'string' || !FILAMENTS.some((row) => row.id === id))
      throw new Error(
        'This backup contains a favorite that is not in the current catalog. Nothing was imported.',
      );
    if (!favorites.includes(id)) favorites.push(id);
  }
  const drafts: SavedLabel[] = [];
  for (const input of value.drafts) {
    const row = backupLabel(input);
    if (!drafts.some((item) => draftKey(item) === draftKey(row)))
      drafts.push(row);
  }
  const collections: SavedCollection[] = [];
  if (value.collections !== undefined) {
    if (
      !Array.isArray(value.collections) ||
      value.collections.length > MAX_COLLECTIONS
    )
      throw new Error(
        `A backup can contain up to ${MAX_COLLECTIONS} collections. Nothing was imported.`,
      );
    for (const input of value.collections) {
      const collection = readCollection(input, true)!;
      if (collections.some((row) => row.id === collection.id))
        throw new Error(
          'This backup contains duplicate collection IDs. Nothing was imported.',
        );
      collections.push(collection);
    }
  }
  return {
    format: 'spoolstamp-workspace',
    version: 1,
    setup: value.setup === null ? null : backupLabel(value.setup),
    favorites,
    drafts,
    ...(collections.length ? { collections } : {}),
  };
}

/** Only allowlisted catalog selections are exported, never session or inventory objects. */
export function serializeWorkspaceBackup(
  workspace: SavedWorkspace,
  configuration?: BuilderConfiguration,
): string {
  const safe = parseWorkspace(JSON.stringify(workspace));
  const backup: WorkspaceBackup = {
    format: 'spoolstamp-workspace',
    version: 1,
    setup: configuration ? saveLabel(configuration) : safe.setup,
    favorites: safe.favorites,
    drafts: safe.drafts,
    ...(safe.collections.length ? { collections: safe.collections } : {}),
  };
  return JSON.stringify(parseWorkspaceBackup(JSON.stringify(backup)), null, 2);
}

/** Merge atomically. Setup/Remember never change implicitly; setup can be restored explicitly. */
export function mergeWorkspaceBackup(current: SavedWorkspace, raw: string) {
  const imported = parseWorkspaceBackup(raw);
  const favorites = [...current.favorites];
  for (const id of imported.favorites)
    if (!favorites.includes(id)) favorites.push(id);
  const drafts = [...current.drafts];
  for (const row of imported.drafts)
    if (!drafts.some((item) => draftKey(item) === draftKey(row)))
      drafts.push(row);
  if (favorites.length > MAX_SAVED_ITEMS || drafts.length > MAX_SAVED_ITEMS)
    throw new Error(
      `There isn’t room for this backup. Keep at most ${MAX_SAVED_ITEMS} favorites and ${MAX_SAVED_ITEMS} drafts; remove some saved items and try again. Nothing was imported.`,
    );
  const collections = [...current.collections];
  for (const input of imported.collections ?? []) {
    if (
      collections.some(
        (row) =>
          (row.name === input.name || row.id === input.id) &&
          labelListKey(row.labels) === labelListKey(input.labels),
      )
    )
      continue;
    let id = input.id;
    if (collections.some((row) => row.id === id)) {
      const base = importedCollectionId(input);
      id = base;
      let collision = 2;
      while (
        collections.some(
          (row) =>
            row.id === id &&
            labelListKey(row.labels) !== labelListKey(input.labels),
        )
      )
        id = `${base}-${collision++}`;
      if (collections.some((row) => row.id === id)) continue;
    }
    let name = input.name;
    let suffix = 2;
    while (
      collections.some(
        (row) => row.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      const ending = ` (${suffix++})`;
      name =
        Array.from(input.name)
          .slice(0, MAX_COLLECTION_NAME_LENGTH - ending.length)
          .join('') + ending;
    }
    collections.push({ ...input, name, id });
  }
  if (collections.length > MAX_COLLECTIONS)
    throw new Error(
      `There isn’t room for this backup. Keep at most ${MAX_COLLECTIONS} collections; remove one and try again. Nothing was imported.`,
    );
  return {
    workspace: { ...current, favorites, drafts, collections },
    setup: imported.setup ? restoreLabel(imported.setup) : null,
    addedFavorites: favorites.length - current.favorites.length,
    addedDrafts: drafts.length - current.drafts.length,
    addedCollections: collections.length - current.collections.length,
  };
}
