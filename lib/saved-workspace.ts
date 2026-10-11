import { FILAMENTS } from './catalog';
import {
  INITIAL_CONFIGURATION,
  resolveConfiguration,
  type BuilderConfiguration,
} from './builder-configuration';

export const WORKSPACE_KEY = 'spoolstamp.workspace.v1';
export const MAX_SAVED_ITEMS = 16;
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
