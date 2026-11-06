import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIGURATION } from '../lib/builder-configuration';
import {
  LEGACY_WORKSPACE_KEY,
  WORKSPACE_KEY,
  createCollection,
  emptyWorkspace,
  loadStoredWorkspace,
  parseWorkspace,
  restoreLabel,
  saveLabel,
} from '../lib/saved-workspace';

const draft = saveLabel(INITIAL_CONFIGURATION);
const legacy = JSON.stringify({
  version: 1,
  remember: true,
  setup: draft,
  favorites: [draft.filamentId],
  drafts: [draft],
});
function fakeStorage(initial: [string, string][] = []) {
  const values = new Map(initial);
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem(this: void, key: string) {
      return values.get(key) ?? null;
    },
    setItem(this: void, key: string, value: string) {
      writes.push(key);
      values.set(key, value);
    },
  };
}

describe('isolated local workspace migration', () => {
  it('copies old setup, favorites and drafts once, without changing the old key', () => {
    const storage = fakeStorage([[LEGACY_WORKSPACE_KEY, legacy]]);
    const loaded = loadStoredWorkspace(storage);
    expect(loaded.persistent).toBe(true);
    expect(loaded.workspace.setup).toEqual(draft);
    expect(loaded.workspace.favorites).toEqual([draft.filamentId]);
    expect(loaded.workspace.drafts).toEqual([draft]);
    expect(loaded.workspace.collections).toEqual([]);
    expect(restoreLabel(loaded.workspace.setup)?.labelLayout).toBeUndefined();
    expect(storage.values.get(LEGACY_WORKSPACE_KEY)).toBe(legacy);
    expect(storage.writes).toEqual([WORKSPACE_KEY]);
    expect(storage.values.get(WORKSPACE_KEY)).toBe(loaded.revision);
    loadStoredWorkspace(storage);
    expect(storage.writes).toEqual([WORKSPACE_KEY]);
  });
  it('isolates new collections/layouts from a later old-tab edit that strips unknown fields', () => {
    const storage = fakeStorage([[LEGACY_WORKSPACE_KEY, legacy]]);
    const migrated = loadStoredWorkspace(storage);
    const simple = saveLabel({
      ...INITIAL_CONFIGURATION,
      labelLayout: 'simple',
    });
    const current = createCollection(
      { ...migrated.workspace, drafts: [simple] },
      'PLA drawer',
      [simple],
    ).workspace;
    const raw = JSON.stringify(current);
    storage.setItem(WORKSPACE_KEY, raw);
    // Released v0.3 code writes only the old namespace and its known fields.
    storage.setItem(
      LEGACY_WORKSPACE_KEY,
      JSON.stringify({
        version: 1,
        remember: false,
        setup: null,
        favorites: [],
        drafts: [draft],
      }),
    );
    const reloaded = loadStoredWorkspace(storage);
    expect(reloaded.workspace).toEqual(current);
    expect(reloaded.workspace.collections[0].labels[0].labelLayout).toBe(
      'simple',
    );
    expect(storage.values.get(WORKSPACE_KEY)).toBe(raw);
  });
  it('always uses an existing new record, even if legacy is newer or the new record is invalid', () => {
    const current = JSON.stringify({ ...emptyWorkspace(), drafts: [draft] });
    const storage = fakeStorage([
      [WORKSPACE_KEY, current],
      [LEGACY_WORKSPACE_KEY, legacy],
    ]);
    expect(loadStoredWorkspace(storage).revision).toBe(current);
    expect(storage.writes).toEqual([]);
    storage.values.set(WORKSPACE_KEY, 'invalid');
    expect(loadStoredWorkspace(storage).workspace).toEqual(emptyWorkspace());
    expect(storage.writes).toEqual([]);
  });
  it('rechecks the new namespace before migration so an intervening current-tab record wins', () => {
    const newer = JSON.stringify(
      createCollection(emptyWorkspace(), 'Already saved', [draft]).workspace,
    );
    const storage = fakeStorage([[LEGACY_WORKSPACE_KEY, legacy]]);
    let reads = 0;
    const loaded = loadStoredWorkspace({
      getItem(key) {
        if (key === WORKSPACE_KEY && ++reads === 2)
          storage.values.set(WORKSPACE_KEY, newer);
        return storage.getItem(key);
      },
      setItem: storage.setItem,
    });
    expect(loaded.revision).toBe(newer);
    expect(loaded.workspace.collections[0].name).toBe('Already saved');
    expect(storage.writes).toEqual([]);
  });
  it('recovers invalid legacy input safely and preserves recognized optional fields', () => {
    const invalid = fakeStorage([[LEGACY_WORKSPACE_KEY, '{broken']]);
    expect(loadStoredWorkspace(invalid).workspace).toEqual(emptyWorkspace());
    expect(invalid.values.get(LEGACY_WORKSPACE_KEY)).toBe('{broken');
    const simple = saveLabel({
      ...INITIAL_CONFIGURATION,
      labelLayout: 'simple',
    });
    const existing = createCollection(
      { ...emptyWorkspace(), drafts: [simple] },
      'Early collection',
      [simple],
    ).workspace;
    const storage = fakeStorage([
      [LEGACY_WORKSPACE_KEY, JSON.stringify(existing)],
    ]);
    expect(loadStoredWorkspace(storage).workspace).toEqual(existing);
  });
  it('keeps recovered legacy choices in memory when quota or access prevents migration', () => {
    const storage = fakeStorage([[LEGACY_WORKSPACE_KEY, legacy]]);
    const quota = loadStoredWorkspace({
      getItem: storage.getItem,
      setItem() {
        throw new Error('Quota exceeded');
      },
    });
    expect(quota.persistent).toBe(false);
    expect(quota.revision).toBeNull();
    expect(quota.workspace).toEqual(parseWorkspace(legacy));
    expect(storage.values.has(WORKSPACE_KEY)).toBe(false);
    expect(storage.values.get(LEGACY_WORKSPACE_KEY)).toBe(legacy);
    const blocked = loadStoredWorkspace({
      getItem() {
        throw new Error('Access denied');
      },
      setItem() {
        throw new Error('Access denied');
      },
    });
    expect(blocked).toEqual({
      workspace: emptyWorkspace(),
      revision: undefined,
      persistent: false,
    });
    const absent = fakeStorage();
    expect(loadStoredWorkspace(absent)).toEqual({
      workspace: emptyWorkspace(),
      revision: null,
      persistent: true,
    });
    expect(absent.writes).toEqual([]);
  });
});
