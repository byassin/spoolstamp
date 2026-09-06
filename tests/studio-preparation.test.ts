import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStudioPreparation,
  type ReadyStudioTransfer,
} from '../lib/studio-preparation';

function transfer(id = 'a'): ReadyStudioTransfer {
  return {
    path: `/api/local-studio/files/${id.repeat(64)}/label.3mf`,
    filename: 'label.3mf',
    expiresAt: Date.now() + 900_000,
    launchUrl: `bambustudio://open?file=${id}`,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const prepare = vi.fn(async (_selection: string, _signal: AbortSignal) =>
    transfer(),
  );
  const revoke = vi.fn(async (_transfer: ReadyStudioTransfer) => undefined);
  const onChange = vi.fn();
  const preparation = createStudioPreparation({ prepare, revoke, onChange });
  cleanups.push(() => preparation.stop());
  const state = () => onChange.mock.lastCall?.[0];
  return { ...preparation, prepare, revoke, onChange, state };
}
let cleanups: Array<() => void>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  cleanups = [];
});
afterEach(() => {
  cleanups.forEach((stop) => stop());
  vi.useRealTimers();
});

describe('automatic Studio preparation', () => {
  it('prepares without a user action and debounces rapid selections to the latest one', async () => {
    const p = setup();
    p.select('PLA / Black');
    await vi.advanceTimersByTimeAsync(300);
    p.select('PETG / Blue');
    await vi.advanceTimersByTimeAsync(449);
    expect(p.prepare).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(p.prepare).toHaveBeenCalledExactlyOnceWith(
      'PETG / Blue',
      expect.any(AbortSignal),
    );
    expect(p.state().transfer).toEqual(transfer());
    expect(p.allowOpen(p.state().transfer.path)).toBe(true);
  });

  it('ignores unchanged selections', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    expect(p.prepare).toHaveBeenCalledTimes(1);
    expect(p.revoke).not.toHaveBeenCalled();
  });

  it('invalidates an old link synchronously and cleans it before staging a replacement', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    const old = p.state().transfer;
    const cleanup = deferred<undefined>();
    p.revoke.mockReturnValueOnce(cleanup.promise);
    p.select('PETG');
    expect(p.state().transfer).toBeNull();
    expect(p.allowOpen(old.path)).toBe(false);
    await vi.advanceTimersByTimeAsync(450);
    expect(p.prepare).toHaveBeenCalledTimes(1);
    cleanup.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.prepare).toHaveBeenCalledTimes(2);
    expect(p.revoke).toHaveBeenCalledExactlyOnceWith(old);
  });

  it('serializes builds, aborts superseded work, and revokes stale results', async () => {
    const p = setup();
    const first = deferred<ReadyStudioTransfer>();
    p.prepare.mockReturnValueOnce(first.promise);
    p.select('first');
    await vi.advanceTimersByTimeAsync(450);
    const signal = p.prepare.mock.calls[0][1];
    p.select('second');
    await vi.advanceTimersByTimeAsync(450);
    p.select('third');
    await vi.advanceTimersByTimeAsync(450);
    expect(signal.aborted).toBe(true);
    expect(p.prepare).toHaveBeenCalledTimes(1);
    const stale = transfer('b');
    first.resolve(stale);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.revoke).toHaveBeenCalledWith(stale);
    expect(p.prepare.mock.calls.map(([selection]) => selection)).toEqual([
      'first',
      'third',
    ]);
    expect(p.state().transfer.path).not.toBe(stale.path);
  });

  it('retains a clicked transfer through selection changes and unmount', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    expect(p.allowOpen(p.state().transfer.path)).toBe(true);
    p.select('PETG');
    p.stop();
    expect(p.revoke).not.toHaveBeenCalled();
  });

  it('revokes an unopened ready transfer on unmount and never permits it afterward', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    const ready = p.state().transfer;
    p.stop();
    expect(p.revoke).toHaveBeenCalledExactlyOnceWith(ready);
    expect(p.allowOpen(ready.path)).toBe(false);
  });

  it('cleans up completion after unmount without publishing state', async () => {
    const p = setup();
    const work = deferred<ReadyStudioTransfer>();
    p.prepare.mockReturnValueOnce(work.promise);
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    p.stop();
    const changeCount = p.onChange.mock.calls.length;
    work.resolve(transfer());
    await vi.advanceTimersByTimeAsync(0);
    expect(p.revoke).toHaveBeenCalledOnce();
    expect(p.onChange).toHaveBeenCalledTimes(changeCount);
  });

  it('refreshes before expiry without opening Studio', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    const originalExpiry = p.state().transfer.expiresAt;
    await vi.advanceTimersByTimeAsync(840_450);
    expect(p.prepare).toHaveBeenCalledTimes(2);
    expect(p.state().transfer.expiresAt).toBeGreaterThan(originalExpiry);
    expect(p.revoke).toHaveBeenCalledOnce();
  });

  it('blocks an expired link even if sleeping suspended the refresh timer', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    const ready = p.state().transfer;
    vi.setSystemTime(ready.expiresAt + 1);
    expect(p.allowOpen(ready.path)).toBe(false);
    expect(p.state().transfer).toBeNull();
    await vi.advanceTimersByTimeAsync(450);
    expect(p.prepare).toHaveBeenCalledTimes(2);
  });

  it('refreshes on focus near expiry but leaves a fresh link alone', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    const ready = p.state().transfer;
    p.refreshIfNeeded();
    expect(p.state().transfer).toEqual(ready);
    vi.setSystemTime(ready.expiresAt - 10_000);
    p.refreshIfNeeded();
    expect(p.state().transfer).toBeNull();
    await vi.advanceTimersByTimeAsync(450);
    expect(p.prepare).toHaveBeenCalledTimes(2);
  });

  it('shows failures without a retry loop and supports explicit recovery', async () => {
    const p = setup();
    p.prepare.mockRejectedValueOnce(new Error('Local transfer unavailable.'));
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    expect(p.state()).toEqual({
      transfer: null,
      error: 'Local transfer unavailable.',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.prepare).toHaveBeenCalledTimes(1);
    p.retry();
    expect(p.state().error).toBeNull();
    await vi.advanceTimersByTimeAsync(450);
    expect(p.state().transfer).not.toBeNull();
  });

  it('rejects a transfer already too close to expiry', async () => {
    const p = setup();
    p.prepare.mockResolvedValueOnce({
      ...transfer(),
      expiresAt: Date.now() + 2000,
    });
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    expect(p.state().transfer).toBeNull();
    expect(p.state().error).toContain('expired');
    expect(p.revoke).toHaveBeenCalledOnce();
  });

  it('continues after a cleanup failure', async () => {
    const p = setup();
    p.select('PLA');
    await vi.advanceTimersByTimeAsync(450);
    p.revoke.mockRejectedValueOnce(new Error('Server stopped'));
    p.select('PETG');
    await vi.advanceTimersByTimeAsync(450);
    expect(p.prepare).toHaveBeenCalledTimes(2);
    expect(p.state().error).toBeNull();
  });
});
