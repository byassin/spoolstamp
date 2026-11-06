import { FILAMENTS } from './catalog';
import {
  INITIAL_CONFIGURATION,
  resolveConfiguration,
  type BuilderConfiguration,
} from './builder-configuration';

export const WORKSPACE_KEY = 'spoolstamp.workspace.v1';
export const MAX_SAVED_ITEMS = 16;
export const MAX_WORKSPACE_BACKUP_BYTES = 32_000;
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
};
export type SavedWorkspace = {
  version: 1;
  remember: boolean;
  setup: SavedLabel | null;
  favorites: string[];
  drafts: SavedLabel[];
};
export const emptyWorkspace = (): SavedWorkspace => ({
  version: 1,
  remember: false,
  setup: null,
  favorites: [],
  drafts: [],
});

/** Only catalog/configuration fields leave this function. Never serialize a session or inventory. */
export function saveLabel(value: BuilderConfiguration): SavedLabel {
  return {
    filamentId: value.filament.id,
    printerId: value.printerId,
    design: value.design,
    ...(value.textColor ? { textColor: value.textColor } : {}),
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
        ...(row.textFilamentProduct === undefined
          ? {}
          : { textFilamentProduct: row.textFilamentProduct }),
      },
      { ...INITIAL_CONFIGURATION, filament },
    );
    // Restoring a full draft must clear an old override, not inherit it via a partial merge.
    return { ...restored, textFilamentProduct: restored.textFilamentProduct };
  } catch {
    return null;
  }
}
export function draftKey(row: SavedLabel) {
  return JSON.stringify(row);
}
export function parseWorkspace(raw: string | null): SavedWorkspace {
  const empty = emptyWorkspace();
  if (!raw || raw.length > 32_000) return empty;
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
    return {
      version: 1,
      remember,
      setup: setup ? saveLabel(setup) : null,
      favorites,
      drafts,
    };
  } catch {
    return empty;
  }
}

export type WorkspaceBackup = {
  format: 'spoolstamp-workspace';
  version: 1;
  setup: SavedLabel | null;
  favorites: string[];
  drafts: SavedLabel[];
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
      'Choose a Spoolstamp backup smaller than 32 KB. Nothing was imported.',
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
    !exactKeys(value, ['format', 'version', 'setup', 'favorites', 'drafts']) ||
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
  return {
    format: 'spoolstamp-workspace',
    version: 1,
    setup: value.setup === null ? null : backupLabel(value.setup),
    favorites,
    drafts,
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
  return {
    workspace: { ...current, favorites, drafts },
    setup: imported.setup ? restoreLabel(imported.setup) : null,
    addedFavorites: favorites.length - current.favorites.length,
    addedDrafts: drafts.length - current.drafts.length,
  };
}
