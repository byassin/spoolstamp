import { MAX_BATCH_LABELS } from './generate-label-batch';

export type BatchQuantity<T> = { label: T; copies: number };

export function batchQuantityTotal(
  rows: readonly { copies: number }[],
): number {
  let total = 0;
  for (const row of rows) {
    if (
      !Number.isInteger(row.copies) ||
      row.copies < 1 ||
      row.copies > MAX_BATCH_LABELS
    )
      throw new Error(
        `Choose between 1 and ${MAX_BATCH_LABELS} copies for each label.`,
      );
    total += row.copies;
    if (total > MAX_BATCH_LABELS)
      throw new Error(
        `A batch can contain at most ${MAX_BATCH_LABELS} labels including copies.`,
      );
  }
  return total;
}

/** Expand copies before preparing a plan. No source labels or arrays are changed. */
export function expandBatchQuantities<T>(
  rows: readonly BatchQuantity<T>[],
): T[] {
  const total = batchQuantityTotal(rows);
  if (!total) throw new Error('Select at least one label.');
  return rows.flatMap(({ label, copies }) =>
    Array.from({ length: copies }, () => label),
  );
}
