import type { StudioTransfer } from './studio-handoff';

export type ReadyStudioTransfer = StudioTransfer & { launchUrl: string };
export type StudioPreparationState = {
  transfer: ReadyStudioTransfer | null;
  error: string | null;
};

const DEBOUNCE_MS = 450;
const REFRESH_MARGIN_MS = 60_000;

// Owns background preparation, never native-app navigation. Only a real user
// click on the ready link may launch Studio.
export function createStudioPreparation<Selection>(options: {
  prepare: (
    selection: Selection,
    signal: AbortSignal,
  ) => Promise<ReadyStudioTransfer>;
  revoke: (transfer: ReadyStudioTransfer) => Promise<unknown>;
  onChange: (state: StudioPreparationState) => void;
}) {
  let selected: Selection;
  let revision = 0;
  let stopped = false;
  let running = false;
  let pending = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ready: ReadyStudioTransfer | null = null;
  let handedOff = false;
  let releasing = Promise.resolve();

  function revoke(transfer: ReadyStudioTransfer) {
    const cleanup = options.revoke(transfer).catch(() => undefined);
    releasing = Promise.all([releasing, cleanup]).then(() => undefined);
  }

  function retire() {
    if (ready && !handedOff) revoke(ready);
    ready = null;
    handedOff = false;
  }

  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = true;
      void run();
    }, delay);
  }

  function restart() {
    if (stopped || revision === 0) return;
    revision++;
    pending = false;
    controller?.abort();
    retire();
    options.onChange({ transfer: null, error: null });
    schedule(DEBOUNCE_MS);
  }

  async function run() {
    if (stopped || running || !pending) return;
    running = true;
    pending = false;
    const captured = revision;
    const selection = selected;
    const operation = new AbortController();
    controller = operation;
    const isCurrent = () => !stopped && revision === captured;
    try {
      // Free superseded, unopened slots before staging another file, so rapid
      // edits don't unnecessarily evict a transfer Studio is still fetching.
      await releasing;
      if (!isCurrent()) return;
      const transfer = await options.prepare(selection, operation.signal);
      if (!isCurrent()) {
        revoke(transfer);
        return;
      }
      if (transfer.expiresAt <= Date.now() + 5000) {
        revoke(transfer);
        throw new Error(
          'The local transfer expired. Retry Studio preparation.',
        );
      }
      ready = transfer;
      options.onChange({ transfer, error: null });
      clearTimeout(timer);
      timer = setTimeout(
        restart,
        Math.max(1000, transfer.expiresAt - Date.now() - REFRESH_MARGIN_MS),
      );
    } catch (cause) {
      if (isCurrent())
        options.onChange({
          transfer: null,
          error:
            cause instanceof Error
              ? cause.message
              : 'Studio preparation failed. Retry or download the 3MF.',
        });
    } finally {
      running = false;
      if (controller === operation) controller = null;
      if (pending && !stopped) void run();
    }
  }

  return {
    select(selection: Selection) {
      if (stopped || (revision > 0 && selection === selected)) return;
      selected = selection;
      if (revision === 0) revision = 1;
      restart();
    },
    retry: restart,
    refreshIfNeeded() {
      if (ready && ready.expiresAt - Date.now() <= REFRESH_MARGIN_MS) restart();
    },
    allowOpen(path: string) {
      // Timers can be suspended in a sleeping/background tab. Recheck at the
      // actual click as well, and never navigate to an expired or stale link.
      if (stopped || !ready || ready.path !== path) return false;
      if (ready.expiresAt <= Date.now() + 5000) {
        restart();
        return false;
      }
      handedOff = true;
      return true;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      retire();
    },
  };
}
