import { describe, expect, it, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_FILAMENT } from '../lib/catalog';
import {
  generateLabelBatch,
  MAX_BATCH_LABELS,
} from '../lib/generate-label-batch';
const generate = vi.hoisted(() =>
  vi.fn(async (_options: unknown) => ({
    filename: 'label.3mf',
    blob: new Blob(['3mf fixture']),
  })),
);
vi.mock('../lib/generate-3mf', () => ({ generate3mf: generate }));
beforeEach(() => generate.mockClear());
const options = () => ({
  labels: [{ filament: DEFAULT_FILAMENT, textFilamentProduct: 'PLA Basic' }],
  printer: 'Bambu Lab X2D',
  design: 'drybox-tab' as const,
  isCurrent: () => true,
  onProgress: vi.fn(),
});
describe('AMS batch export', () => {
  it('exports separate numbered projects through the normal generator', async () => {
    const settings = options();
    settings.labels.push(settings.labels[0]);
    const blob = await generateLabelBatch(settings);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['1-label.3mf', '2-label.3mf']);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        filament: DEFAULT_FILAMENT,
        textFilamentProduct: 'PLA Basic',
        printer: settings.printer,
        design: settings.design,
      }),
    );
    expect(settings.onProgress).toHaveBeenLastCalledWith(2, 2);
  });
  it('bounds batch size and refuses stale selection before generating', async () => {
    await expect(
      generateLabelBatch({ ...options(), labels: [] }),
    ).rejects.toThrow('Select between');
    await expect(
      generateLabelBatch({
        ...options(),
        labels: Array(MAX_BATCH_LABELS + 1).fill(options().labels[0]),
      }),
    ).rejects.toThrow('Select between');
    await expect(
      generateLabelBatch({ ...options(), isCurrent: () => false }),
    ).rejects.toThrow('changed');
    expect(generate).not.toHaveBeenCalled();
  });
  it('discards output when the inventory changes during generation', async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(
      generateLabelBatch({ ...options(), isCurrent }),
    ).rejects.toThrow('changed');
  });
});
