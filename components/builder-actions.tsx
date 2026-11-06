'use client';
import { useEffect, useState } from 'react';
import { Undo2, Redo2, RotateCcw, Share2 } from 'lucide-react';
import { Button } from './ui/button';
import type { BuilderConfiguration } from '@/lib/builder-configuration';
import { configurationFromLink, labelLink } from '@/lib/label-link';

export function BuilderActions({
  configuration,
  ready,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReset,
  onSelect,
}: {
  configuration: BuilderConfiguration;
  ready: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onSelect: (value: BuilderConfiguration) => void;
}) {
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  useEffect(() => {
    if (!ready) return;
    const load = () => {
      try {
        const selected = configurationFromLink(window.location.hash);
        if (selected) {
          onSelect(selected);
          setMessage('Shared label loaded.');
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not load the label link.',
        );
      }
    };
    const timer = setTimeout(load, 0);
    window.addEventListener('hashchange', load);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('hashchange', load);
    };
  }, [ready, onSelect]);
  async function share() {
    const link = labelLink(configuration, window.location.href);
    try {
      await navigator.clipboard.writeText(link);
      setFallback(link);
      setMessage('Link copied. Catalog choices only.');
    } catch {
      setFallback(link);
      setMessage('Copy this catalog-only label link.');
    }
  }
  return (
    <div className="builder-actions" aria-label="Label editing tools">
      <div className="builder-actions-buttons">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo label change"
          title="Undo"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Redo label change"
          title="Redo"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw size={14} /> Reset
        </Button>
        <Button variant="outline" size="sm" onClick={() => void share()}>
          <Share2 size={14} /> Share label
        </Button>
      </div>
      {message && <output className="field-note">{message}</output>}
      {fallback && (
        <input
          aria-label="Shareable label link"
          readOnly
          value={fallback}
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  );
}
