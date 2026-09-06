'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DESIGNS, PRINTERS, DEFAULT_PRINTER } from '@/lib/catalog';
import {
  isLoopbackUrl,
  prepareStudioTransfer,
  revokeStudioTransfer,
  studioLaunchUrl,
  studioPlatform,
  STUDIO_TRANSFER_PATH,
} from '@/lib/studio-handoff';
import {
  createStudioPreparation,
  type StudioPreparationState,
} from '@/lib/studio-preparation';
import {
  INITIAL_CONFIGURATION,
  resolveConfiguration,
  sameConfiguration,
  type BuilderConfiguration,
} from '@/lib/builder-configuration';

export function useLabelBuilder() {
  const [configuration, setConfiguration] = useState(INITIAL_CONFIGURATION);
  const current = useRef(configuration);
  const activeOperation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [busyAction, setBusyAction] = useState<'download' | null>(null);
  const [localStudio, setLocalStudio] = useState(false);
  const studio = useRef<ReturnType<
    typeof createStudioPreparation<BuilderConfiguration>
  > | null>(null);
  const [studioState, setStudioState] = useState<StudioPreparationState>({
    transfer: null,
    error: null,
  });
  const [download, setDownload] = useState<{ filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    if (
      isLoopbackUrl(window.location.origin) &&
      studioPlatform(navigator.userAgent)
    ) {
      void fetch(STUDIO_TRANSFER_PATH, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      })
        .then(async (response) => {
          const capability: unknown = response.ok
            ? await response.json()
            : null;
          if (!controller.signal.aborted)
            setLocalStudio(
              !!capability &&
                typeof capability === 'object' &&
                'available' in capability &&
                capability.available === true,
            );
        })
        .catch(() => undefined)
        .finally(() => clearTimeout(timer));
    }
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      controller.abort();
      activeOperation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!localStudio) return;
    const origin = window.location.origin;
    const platform = studioPlatform(navigator.userAgent);
    if (!platform) return;
    const preparation = createStudioPreparation<BuilderConfiguration>({
      async prepare(selected, signal) {
        const { generate3mf } = await import('@/lib/generate-3mf');
        signal.throwIfAborted();
        const printer =
          PRINTERS.find((item) => item.id === selected.printerId) ??
          DEFAULT_PRINTER;
        const result = await generate3mf({
          filament: selected.filament,
          design: selected.design,
          printer: printer.fullName,
          textFilamentProduct: selected.textFilamentProduct,
        });
        signal.throwIfAborted();
        const transfer = await prepareStudioTransfer(
          result.blob,
          result.filename,
          origin,
          AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
        );
        return {
          ...transfer,
          launchUrl: studioLaunchUrl(transfer, origin, platform),
        };
      },
      revoke: (transfer) => revokeStudioTransfer(transfer, origin),
      onChange: setStudioState,
    });
    studio.current = preparation;
    preparation.select(current.current);
    const refresh = () => preparation.refreshIfNeeded();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      preparation.stop();
      studio.current = null;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [localStudio]);
  const updateConfiguration = useCallback(
    (next: Partial<BuilderConfiguration>) => {
      const merged = { ...current.current, ...next };
      if (
        next.filament &&
        next.filament.material !== current.current.filament.material &&
        !('textFilamentProduct' in next)
      )
        merged.textFilamentProduct = undefined;
      if (sameConfiguration(current.current, merged)) return;
      current.current = merged;
      setConfiguration(current.current);
      activeOperation.current?.abort();
      studio.current?.select(merged);
      setDownload(null);
      setError(null);
    },
    [],
  );
  const generateAndDownload = useCallback(async () => {
    if (activeOperation.current)
      throw new Error('A model is already being prepared.');
    const controller = new AbortController();
    activeOperation.current = controller;
    const selected = current.current;
    const isCurrent = () =>
      mounted.current &&
      selected === current.current &&
      !controller.signal.aborted;
    setBusyAction('download');
    setError(null);
    setDownload(null);
    try {
      const { generate3mf, downloadBlob } = await import('@/lib/generate-3mf');
      const printer =
        PRINTERS.find((item) => item.id === selected.printerId) ??
        DEFAULT_PRINTER;
      const result = await generate3mf({
        filament: selected.filament,
        design: selected.design,
        printer: printer.fullName,
        textFilamentProduct: selected.textFilamentProduct,
      });
      if (!isCurrent()) {
        throw new Error(
          'The label changed while preparing the file. Try again with your latest selection.',
        );
      }
      downloadBlob(result.blob, result.filename);
      setDownload({ filename: result.filename });
      return {
        filename: result.filename,
        parts: result.parts,
        triangles: result.triangles,
      };
    } catch (cause) {
      if (isCurrent())
        setError(
          cause instanceof Error
            ? cause.message
            : 'The model could not be prepared. Please try again.',
        );
      throw cause;
    } finally {
      if (activeOperation.current === controller)
        activeOperation.current = null;
      if (mounted.current) setBusyAction(null);
    }
  }, []);
  const retryStudio = useCallback(() => studio.current?.retry(), []);
  const allowStudioOpen = useCallback(
    (path: string) => studio.current?.allowOpen(path) ?? false,
    [],
  );

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: 'configure_filament_label',
          title: 'Configure filament label',
          description:
            'Select filament type and color, printer, and design in the visible label builder.',
          inputSchema: {
            type: 'object',
            properties: {
              filamentProduct: {
                type: 'string',
                description: 'Exact filament type, such as PLA Basic.',
              },
              filamentColorCode: {
                type: 'string',
                description: 'Five-digit Bambu filament color code.',
              },
              printerId: {
                type: 'string',
                description: 'Printer id from the builder.',
              },
              textFilamentProduct: {
                type: 'string',
                description:
                  'Actual black or white text spool product, such as PLA Basic. Must match the body material family.',
              },
              design: { type: 'string', enum: DESIGNS.map((item) => item.id) },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input: unknown) {
            const selected = resolveConfiguration(input, current.current);
            flushSync(() => updateConfiguration(selected));
            const printer = PRINTERS.find(
              (item) => item.id === selected.printerId,
            )!;
            return {
              filamentProduct: selected.filament.product,
              filamentColorCode: selected.filament.colorCode,
              filament: `${selected.filament.product} · ${selected.filament.colorName}`,
              printerId: printer.id,
              printer: printer.fullName,
              design: selected.design,
              textFilamentProduct: selected.textFilamentProduct,
            };
          },
        },
        { signal: lifecycle.signal },
      );
      if (lifecycle.signal.aborted) return;
      await context.registerTool(
        {
          name: 'download_configured_label_3mf',
          title: 'Download configured label 3MF',
          description:
            'Generate and download the currently configured model 3MF.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: generateAndDownload,
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch((cause: unknown) => {
      if (!lifecycle.signal.aborted)
        console.warn('Agent controls unavailable.', cause);
    });
    return () => lifecycle.abort();
  }, [generateAndDownload, updateConfiguration]);
  return {
    ...configuration,
    generating: busyAction !== null,
    busyAction,
    localStudio,
    studioTransfer: studioState.transfer,
    studioError: studioState.error,
    download,
    error,
    updateConfiguration,
    generateAndDownload,
    retryStudio,
    allowStudioOpen,
  };
}
