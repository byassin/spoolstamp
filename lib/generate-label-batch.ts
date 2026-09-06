import JSZip from 'jszip';
import type { Filament, DesignId } from './catalog';

export const MAX_BATCH_LABELS = 8;
export type BatchLabel = { filament: Filament; textFilamentProduct?: string };
export async function generateLabelBatch(options: {
  labels: BatchLabel[];
  printer: string;
  design: DesignId;
  isCurrent(): boolean;
  onProgress(done: number, total: number): void;
}) {
  if (!options.labels.length || options.labels.length > MAX_BATCH_LABELS)
    throw new Error(`Select between 1 and ${MAX_BATCH_LABELS} labels.`);
  const { generate3mf } = await import('./generate-3mf');
  const zip = new JSZip();
  for (const [index, label] of options.labels.entries()) {
    if (!options.isCurrent())
      throw new Error(
        'AMS inventory or selection changed. Review the spools and try again.',
      );
    const result = await generate3mf({
      ...label,
      printer: options.printer,
      design: options.design,
    });
    if (!options.isCurrent())
      throw new Error(
        'AMS inventory or selection changed. Review the spools and try again.',
      );
    zip.file(
      `${index + 1}-${result.filename}`,
      await result.blob.arrayBuffer(),
    );
    options.onProgress(index + 1, options.labels.length);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  if (!options.isCurrent())
    throw new Error(
      'AMS inventory or selection changed. Review the spools and try again.',
    );
  return blob;
}
