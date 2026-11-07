import { describe, expect, it } from 'vitest';
import { DEFAULT_FILAMENT, FILAMENTS } from '../lib/catalog';
import { INITIAL_CONFIGURATION } from '../lib/builder-configuration';
import {
  emptyWorkspace,
  MAX_SAVED_ITEMS,
  MAX_WORKSPACE_BACKUP_BYTES,
  parseWorkspaceBackup,
  serializeWorkspaceBackup,
  mergeWorkspaceBackup,
  saveLabel,
  parseWorkspace,
  workspaceRevisionChanged,
} from '../lib/saved-workspace';

const draft = saveLabel(INITIAL_CONFIGURATION);
const backup = () => ({
  format: 'spoolstamp-workspace',
  version: 1,
  setup: draft,
  favorites: [DEFAULT_FILAMENT.id],
  drafts: [draft],
});

describe('saved workspace backup transfer', () => {
  it('detects external writes, deletion and recovery from initially unavailable storage', () => {
    const before = JSON.stringify({ ...emptyWorkspace(), drafts: [draft] });
    const after = JSON.stringify(emptyWorkspace());
    expect(workspaceRevisionChanged(before, before)).toBe(false);
    expect(workspaceRevisionChanged(before, after)).toBe(true);
    expect(workspaceRevisionChanged(before, null)).toBe(true);
    expect(workspaceRevisionChanged(null, null)).toBe(false);
    expect(workspaceRevisionChanged(undefined, null)).toBe(false);
    expect(workspaceRevisionChanged(undefined, before)).toBe(true);
    // Reload the external record; never merge a stale draft back into deletions.
    expect(parseWorkspace(after).drafts).toEqual([]);
    expect(parseWorkspace(null).drafts).toEqual([]);
  });
  it('round trips catalog choices while keeping setup separate from browser remembering', () => {
    const source = {
      ...emptyWorkspace(),
      favorites: [DEFAULT_FILAMENT.id],
      drafts: [draft],
    };
    const raw = serializeWorkspaceBackup(source, INITIAL_CONFIGURATION);
    const parsed = parseWorkspaceBackup(raw);
    expect(parsed).toEqual(backup());
    const result = mergeWorkspaceBackup(emptyWorkspace(), raw);
    expect(result.workspace.remember).toBe(false);
    expect(result.workspace.setup).toBeNull();
    expect(result.setup?.filament).toBe(DEFAULT_FILAMENT);
    expect(result.addedFavorites).toBe(1);
    expect(result.addedDrafts).toBe(1);
  });
  it('exports allowlisted catalog fields only, never accidentally attached secrets or inventory', () => {
    const source = {
      ...emptyWorkspace(),
      remember: true,
      setup: {
        ...draft,
        email: 'private@example.com',
        serial: 'PRIVATE',
        remaining: 50,
      },
      drafts: [{ ...draft, csrf: 'private-token' }],
      email: 'private@example.com',
      token: 'private-token',
    };
    const raw = serializeWorkspaceBackup(source);
    expect(raw).not.toMatch(/private|email|serial|csrf|remaining|token/);
    expect(parseWorkspaceBackup(raw).setup).toEqual(draft);
  });
  it('rejects corrupted, foreign, oversized and unknown-field backups rather than silently recovering', () => {
    const cases: unknown[] = [
      null,
      [],
      {},
      { ...backup(), version: 2 },
      { ...backup(), format: 'something-else' },
      { ...backup(), email: 'private@example.com' },
      { ...backup(), drafts: [{ ...draft, token: 'private' }] },
      { ...backup(), setup: { ...draft, serial: 'private' } },
      { ...backup(), favorites: ['custom-brand'] },
      { ...backup(), drafts: [{ ...draft, filamentId: 'custom-brand' }] },
      { ...backup(), drafts: [{ ...draft, printerId: 'other-printer' }] },
      { ...backup(), drafts: [{ ...draft, design: 'unknown' }] },
      { ...backup(), drafts: [{ ...draft, textColor: 'purple' }] },
      {
        ...backup(),
        drafts: [{ ...draft, textFilamentProduct: 'PETG Basic' }],
      },
      {
        ...backup(),
        favorites: Array(MAX_SAVED_ITEMS + 1).fill(DEFAULT_FILAMENT.id),
      },
      { ...backup(), drafts: Array(MAX_SAVED_ITEMS + 1).fill(draft) },
      { ...backup(), setup: undefined },
    ];
    for (const value of cases)
      expect(() => parseWorkspaceBackup(JSON.stringify(value))).toThrow();
    expect(() => parseWorkspaceBackup('not json')).toThrow(
      'valid Spoolstamp backup',
    );
    expect(() =>
      parseWorkspaceBackup(' '.repeat(MAX_WORKSPACE_BACKUP_BYTES + 1)),
    ).toThrow('96 KB');
    expect(() =>
      parseWorkspaceBackup('é'.repeat(MAX_WORKSPACE_BACKUP_BYTES / 2 + 1)),
    ).toThrow('96 KB');
  });
  it('deduplicates repeated choices and preserves existing drafts, setup and remember setting', () => {
    const next = saveLabel({
      ...INITIAL_CONFIGURATION,
      filament: FILAMENTS.find((row) => row.id !== DEFAULT_FILAMENT.id)!,
    });
    const current = {
      ...emptyWorkspace(),
      remember: true,
      setup: next,
      favorites: [next.filamentId],
      drafts: [next, draft],
    };
    const previous = structuredClone(current);
    const input = {
      ...backup(),
      favorites: [DEFAULT_FILAMENT.id, DEFAULT_FILAMENT.id],
      drafts: [draft, draft],
    };
    const result = mergeWorkspaceBackup(current, JSON.stringify(input));
    expect(current).toEqual(previous);
    expect(result.workspace.setup).toBe(next);
    expect(result.workspace.remember).toBe(true);
    expect(result.workspace.drafts).toEqual([next, draft]);
    expect(result.addedDrafts).toBe(0);
    expect(result.addedFavorites).toBe(1);
  });
  it('rejects a capacity overflow atomically instead of truncating either workspace', () => {
    const full = {
      ...emptyWorkspace(),
      favorites: FILAMENTS.slice(0, MAX_SAVED_ITEMS).map((row) => row.id),
      drafts: FILAMENTS.slice(0, MAX_SAVED_ITEMS).map((filament) =>
        saveLabel({ ...INITIAL_CONFIGURATION, filament }),
      ),
    };
    const before = structuredClone(full);
    const extra = FILAMENTS[MAX_SAVED_ITEMS];
    const extraBackup = {
      ...backup(),
      favorites: [extra.id],
      drafts: [saveLabel({ ...INITIAL_CONFIGURATION, filament: extra })],
    };
    expect(() =>
      mergeWorkspaceBackup(full, JSON.stringify(extraBackup)),
    ).toThrow('isn’t room');
    expect(full).toEqual(before);
    expect(
      mergeWorkspaceBackup(
        full,
        serializeWorkspaceBackup(full, INITIAL_CONFIGURATION),
      ).workspace,
    ).toEqual(full);
  });
});
