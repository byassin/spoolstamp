'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuilderConfiguration } from '@/lib/builder-configuration';
import {
  WORKSPACE_KEY,
  MAX_SAVED_ITEMS,
  emptyWorkspace,
  parseWorkspace,
  restoreLabel,
  saveLabel,
  draftKey,
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
  const persist = useCallback((next: SavedWorkspace) => {
    const safe = parseWorkspace(JSON.stringify(next));
    current.current = safe;
    setWorkspace(safe);
    try {
      window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(safe));
      setNotice('');
    } catch {
      setNotice(
        'Browser storage is unavailable. Your favorites and drafts will only last for this visit.',
      );
    }
  }, []);
  useEffect(() => {
    // Read browser storage after hydration; cleanup fences Strict Mode/unmount.
    const timer = setTimeout(() => {
      let saved = emptyWorkspace();
      try {
        saved = parseWorkspace(window.localStorage.getItem(WORKSPACE_KEY));
      } catch {
        setNotice(
          'Browser storage is unavailable. Your favorites and drafts will only last for this visit.',
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
    if (!ready || !workspace.remember) return;
    const setup = saveLabel(configuration);
    if (draftKey(setup) !== JSON.stringify(current.current.setup))
      persist({ ...current.current, setup });
  }, [configuration, ready, workspace.remember, persist]);
  const saveDraft = useCallback(
    (value: BuilderConfiguration) => {
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
      persist({ ...previous, drafts: [...previous.drafts, row] });
      return true;
    },
    [persist],
  );
  return {
    workspace,
    notice,
    ready,
    saveDraft,
    remember(enabled: boolean) {
      persist({
        ...current.current,
        remember: enabled,
        setup: enabled ? saveLabel(configuration) : null,
      });
    },
    favorite(id: string) {
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
      persist({
        ...current.current,
        drafts: current.current.drafts.filter((row) => draftKey(row) !== key),
      });
    },
  };
}
