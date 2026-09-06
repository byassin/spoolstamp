import { expect, it } from 'vitest';
import { loadManifoldRuntime } from '../lib/manifold-cad';
import {
  auditTextStrokes,
  strengthenTextStrokes,
} from '../lib/text-printability';
import { addVectorTextLine } from '../lib/vector-text';

it('detects lost thin strokes and retains printable strokes', async () => {
  const runtime = await loadManifoldRuntime();
  const thin = runtime.CrossSection.square([0.2, 5]);
  const thick = runtime.CrossSection.square([0.9, 5]);
  try {
    expect(auditTextStrokes(thin, 0.45).passes).toBe(false);
    expect(auditTextStrokes(thick, 0.45).passes).toBe(true);
    const improved = strengthenTextStrokes(thin, 0.45);
    expect(improved.expansion).toBeGreaterThan(0);
    expect(improved.audit.passes).toBe(true);
    improved.section.delete();
  } finally {
    thin.delete();
    thick.delete();
  }
});

it('rejects undersized lettering and preserves all counters at the supported size', async () => {
  await expect(
    addVectorTextLine(
      { vertices: [], triangles: [] },
      'HEX: #A8A8AA',
      30,
      12,
      3.18,
      54,
      2,
      0.82,
      0.45,
    ),
  ).rejects.toThrow('too small');
  const target = { vertices: [] as number[], triangles: [] as number[] };
  const placement = await addVectorTextLine(
    target,
    'HEX: #A8A8AA',
    30,
    12,
    3.18,
    54,
    4.3,
    0.82,
    0.45,
  );
  expect(placement?.strokeAudit?.passes).toBe(true);
  expect(placement?.strokeAudit?.components).toBe(12);
  expect(placement?.strokeAudit?.retainedComponents).toBe(12);
  expect(placement?.strokeAudit?.counters).toBe(9);
  expect(placement?.strokeAudit?.retainedCounters).toBe(9);
});
