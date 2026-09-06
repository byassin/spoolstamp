import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the hook's export/cleanup callbacks without a browser or WebGL.
// State setters are inert here; these tests concern the transfer side effects.
const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  prepare: vi.fn(),
  revoke: vi.fn(),
  local: true,
}));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [
    initial === false ? harness.local : initial,
    vi.fn(),
  ],
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) =>
    harness.effects.push(effect),
}));
vi.mock('../lib/studio-handoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/studio-handoff')>()),
  prepareStudioTransfer: harness.prepare,
  revokeStudioTransfer: harness.revoke,
}));
vi.mock('../lib/generate-3mf', () => ({
  generate3mf: vi.fn(async () => ({
    blob: new Blob(['model']),
    filename: 'label.3mf',
    parts: 2,
    triangles: 12,
  })),
  downloadBlob: vi.fn(),
}));
import { useLabelBuilder } from '../hooks/use-label-builder';
import { generate3mf, downloadBlob } from '../lib/generate-3mf';

const transfer = {
  path: `/api/local-studio/files/${'a'.repeat(64)}/label.3mf`,
  filename: 'label.3mf',
  expiresAt: Date.now() + 900_000,
};
let cleanups: Array<() => void>;
beforeEach(() => {
  harness.effects.length = 0;
  cleanups = [];
  harness.local = true;
  vi.useFakeTimers();
  vi.mocked(generate3mf).mockClear();
  vi.mocked(downloadBlob).mockClear();
  harness.prepare.mockReset().mockResolvedValue(transfer);
  harness.revoke.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost:3000' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' });
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ available: true })),
  );
});
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function TestBuilder() {
  const builder = useLabelBuilder();
  for (const effect of harness.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  return builder;
}

async function prepareAutomatically() {
  await vi.advanceTimersByTimeAsync(450);
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
}

describe('builder automatic Studio handoff wiring', () => {
  it('automatically prepares the configured model and preserves a clicked link on unmount', async () => {
    const builder = TestBuilder();
    await prepareAutomatically();
    expect(harness.prepare).toHaveBeenCalledOnce();
    expect(vi.mocked(generate3mf).mock.calls[0][0]).toMatchObject({
      filament: builder.filament,
      design: builder.design,
    });
    expect(builder.allowStudioOpen(transfer.path)).toBe(true);
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    expect(harness.revoke).not.toHaveBeenCalled();
  });
  it('does not revoke a clicked transfer when another label or export is selected', async () => {
    const builder = TestBuilder();
    await prepareAutomatically();
    expect(builder.allowStudioOpen(transfer.path)).toBe(true);
    builder.updateConfiguration({ design: 'clip-label' });
    await builder.generateAndDownload();
    expect(harness.revoke).not.toHaveBeenCalled();
  });
  it('still revokes a stale transfer that was never exposed to Studio', async () => {
    const builder = TestBuilder();
    let complete!: (value: typeof transfer) => void;
    harness.prepare.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await prepareAutomatically();
    expect(harness.prepare).toHaveBeenCalled();
    builder.updateConfiguration({ design: 'clip-label' });
    complete(transfer);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.revoke).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining(transfer),
      'http://localhost:3000',
    );
  });
  it('allows downloading while the background upload is pending', async () => {
    harness.prepare.mockImplementation(() => new Promise(() => undefined));
    const builder = TestBuilder();
    await prepareAutomatically();
    await builder.generateAndDownload();
    expect(downloadBlob).toHaveBeenCalledOnce();
  });
  it('does not auto-stage without the local capability', async () => {
    harness.local = false;
    const builder = TestBuilder();
    await prepareAutomatically();
    expect(harness.prepare).not.toHaveBeenCalled();
    expect(generate3mf).not.toHaveBeenCalled();
    await builder.generateAndDownload();
    expect(downloadBlob).toHaveBeenCalledOnce();
  });
});
