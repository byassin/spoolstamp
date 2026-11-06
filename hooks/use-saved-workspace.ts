'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuilderConfiguration } from '@/lib/builder-configuration';
import {
  WORKSPACE_KEY,
  MAX_SAVED_ITEMS,
  emptyWorkspace,
  parseWorkspace,
  loadStoredWorkspace,
  restoreLabel,
  saveLabel,
  draftKey,
  mergeWorkspaceBackup,
  workspaceRevisionChanged,
  WORKSPACE_CHANGED_NOTICE,
  createCollection as createSavedCollection,
  renameCollection as renameSavedCollection,
  removeCollection as removeSavedCollection,
  addCollectionLabels as addSavedCollectionLabels,
  removeCollectionLabel as removeSavedCollectionLabel,
  type SavedWorkspace,
} from '@/lib/saved-workspace';

export function useSavedWorkspace(
  configuration: BuilderConfiguration,
  onRestore: (value: BuilderConfiguration) => void,
) {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const current = useRef(workspace);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const storageRevision = useRef<string | null | undefined>(undefined);
  const configurationKey = draftKey(saveLabel(configuration));
  const previousConfiguration = useRef(configurationKey);
  const loadLatest = useCallback((raw: string | null, message: string) => {
    const latest = parseWorkspace(raw);
    storageRevision.current = raw;
    current.current = latest;
    setWorkspace(latest);
    setNotice(message);
  }, []);
  const ensureLatest = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_KEY);
      if (workspaceRevisionChanged(storageRevision.current, raw)) {
        loadLatest(raw, WORKSPACE_CHANGED_NOTICE);
        return false;
      }
    } catch {
      // Restricted browser storage still permits an in-memory workspace.
    }
    return true;
  }, [loadLatest]);
  const persist = useCallback(
    (next: SavedWorkspace) => {
      if (!ensureLatest()) return false;
      const safe = parseWorkspace(JSON.stringify(next));
      const raw = JSON.stringify(safe);
      try {
        window.localStorage.setItem(WORKSPACE_KEY, raw);
        storageRevision.current = raw;
        setNotice('');
      } catch {
        setNotice(
          'Browser storage is unavailable. Your saved choices will only last for this visit.',
        );
      }
      current.current = safe;
      setWorkspace(safe);
      return true;
    },
    [ensureLatest],
  );
  useEffect(() => {
    // Read browser storage after hydration; cleanup fences Strict Mode/unmount.
    const timer = setTimeout(() => {
      let saved = emptyWorkspace();
      try {
        const loaded = loadStoredWorkspace(window.localStorage);
        storageRevision.current = loaded.revision;
        saved = loaded.workspace;
        if (!loaded.persistent)
          setNotice(
            'Browser storage is unavailable. Your saved choices will only last for this visit.',
          );
      } catch {
        setNotice(
          'Browser storage is unavailable. Your saved choices will only last for this visit.',
        );
      }
      current.current = saved;
      setWorkspace(saved);
      const restored = saved.remember && restoreLabel(saved.setup);
      if (restored) onRestore(restored);
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [onRestore]);
  useEffect(() => {
    if (!ready) return;
    function changed(event: StorageEvent) {
      if (event.key !== WORKSPACE_KEY && event.key !== null) return;
      try {
        const raw = window.localStorage.getItem(WORKSPACE_KEY);
        if (workspaceRevisionChanged(storageRevision.current, raw))
          loadLatest(raw, 'Saved workspace updated from another tab.');
      } catch {
        setNotice(
          'Browser storage is unavailable. Your saved choices will only last for this visit.',
        );
      }
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [ready, loadLatest]);
  useEffect(() => {
    if (!ready) return;
    // An external record update must not re-save this tab's older setup.
    if (configurationKey === previousConfiguration.current) return;
    previousConfiguration.current = configurationKey;
    if (!workspace.remember) return;
    const setup = saveLabel(configuration);
    if (
      !current.current.setup ||
      draftKey(setup) !== draftKey(current.current.setup)
    )
      persist({ ...current.current, setup });
  }, [configuration, configurationKey, ready, workspace.remember, persist]);
  const saveDraft = useCallback(
    (value: BuilderConfiguration) => {
      if (!ensureLatest()) return false;
      const row = saveLabel(value);
      const previous = current.current;
      if (previous.drafts.some((item) => draftKey(item) === draftKey(row)))
        return true;
      if (previous.drafts.length >= MAX_SAVED_ITEMS) {
        setNotice(
          `You can save ${MAX_SAVED_ITEMS} drafts. Remove one to make room.`,
        );
        return false;
      }
      return persist({ ...previous, drafts: [...previous.drafts, row] });
    },
    [persist, ensureLatest],
  );
  const updateCollection = useCallback(
    (change: (value: SavedWorkspace) => SavedWorkspace) => {
      if (!ready || !ensureLatest()) return false;
      try {
        return persist(change(current.current));
      } catch (cause) {
        setNotice(
          cause instanceof Error
            ? cause.message
            : 'Could not update this collection. Try again.',
        );
        return false;
      }
    },
    [ready, ensureLatest, persist],
  );
  return {
    workspace,
    notice,
    ready,
    saveDraft,
    createCollection(name: string, values: BuilderConfiguration[] = []) {
      if (!ready || !ensureLatest()) return null;
      try {
        const result = createSavedCollection(
          current.current,
          name,
          values.map(saveLabel),
        );
        return persist(result.workspace) ? result.collection.id : null;
      } catch (cause) {
        setNotice(
          cause instanceof Error
            ? cause.message
            : 'Could not create this collection. Try again.',
        );
        return null;
      }
    },
    renameCollection(id: string, name: string) {
      return updateCollection((value) =>
        renameSavedCollection(value, id, name),
      );
    },
    removeCollection(id: string) {
      return updateCollection((value) => removeSavedCollection(value, id));
    },
    addCollectionLabels(id: string, values: BuilderConfiguration[]) {
      return updateCollection((value) =>
        addSavedCollectionLabels(value, id, values.map(saveLabel)),
      );
    },
    removeCollectionLabel(id: string, key: string) {
      return updateCollection((value) =>
        removeSavedCollectionLabel(value, id, key),
      );
    },
    importBackup(raw: string) {
      if (!ready)
        throw new Error(
          'Your saved workspace is still loading. Try again in a moment.',
        );
      if (!ensureLatest()) throw new Error(WORKSPACE_CHANGED_NOTICE);
      const result = mergeWorkspaceBackup(current.current, raw);
      if (!persist(result.workspace)) throw new Error(WORKSPACE_CHANGED_NOTICE);
      return result;
    },
    remember(enabled: boolean) {
      if (!ensureLatest()) return;
      persist({
        ...current.current,
        remember: enabled,
        setup: enabled ? saveLabel(configuration) : null,
      });
    },
    favorite(id: string) {
      if (!ensureLatest()) return;
      const previous = current.current;
      const already = previous.favorites.includes(id);
      if (!already && previous.favorites.length >= MAX_SAVED_ITEMS) {
        setNotice(
          `You can save ${MAX_SAVED_ITEMS} favorites. Remove one to make room.`,
        );
        return;
      }
      persist({
        ...previous,
        favorites: already
          ? previous.favorites.filter((item) => item !== id)
          : [...previous.favorites, id],
      });
    },
    removeDraft(key: string) {
      if (!ensureLatest()) return;
      persist({
        ...current.current,
        drafts: current.current.drafts.filter((row) => draftKey(row) !== key),
      });
    },
  };
}
