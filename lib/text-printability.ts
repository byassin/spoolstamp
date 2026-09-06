import type { CrossSection } from 'manifold-3d';

export const TEXT_PRINT_SPEC = {
  nozzleDiameter: 0.4,
  lineWidth: 0.45,
  minimumAreaRecovery: 0.98,
  maximumOutlineExpansion: 0.15,
  relief: 0.8,
  attachmentOverlap: 0.02,
  layerHeight: 0.2,
} as const;

export type TextStrokeAudit = {
  lineWidth: number;
  components: number;
  counters: number;
  retainedComponents: number;
  retainedCounters: number;
  minimumComponentAreaRecovery: number;
  passes: boolean;
};

/**
 * A round extrusion of width w needs a center path with radius w/2 inside the
 * lettering. Morphological opening tests each connected glyph element, not its
 * bounding box: punctuation cannot disappear behind a large line's total area.
 * This is a geometric screening test; the actual slicer path is checked too.
 */
export function auditTextStrokes(
  section: CrossSection,
  lineWidth: number,
): TextStrokeAudit {
  const components = section.decompose();
  let retainedComponents = 0;
  let retainedCounters = 0;
  let minimumComponentAreaRecovery = 1;
  try {
    for (const component of components) {
      let core: CrossSection | undefined;
      let opened: CrossSection | undefined;
      let openedComponents: CrossSection[] = [];
      try {
        core = component.offset(-lineWidth / 2, 'Round', 2, 32);
        opened = core.offset(lineWidth / 2, 'Round', 2, 32);
        openedComponents = opened.decompose();
        retainedComponents += openedComponents.length;
        retainedCounters += opened.numContour() - openedComponents.length;
        minimumComponentAreaRecovery = Math.min(
          minimumComponentAreaRecovery,
          opened.area() / component.area(),
        );
      } finally {
        openedComponents.forEach((value) => value.delete());
        opened?.delete();
        core?.delete();
      }
    }
  } finally {
    components.forEach((component) => component.delete());
  }
  const counters = section.numContour() - components.length;
  return {
    lineWidth,
    components: components.length,
    counters,
    retainedComponents,
    retainedCounters,
    minimumComponentAreaRecovery,
    passes:
      components.length > 0 &&
      retainedComponents === components.length &&
      retainedCounters === counters &&
      minimumComponentAreaRecovery >= TEXT_PRINT_SPEC.minimumAreaRecovery,
  };
}

export function strengthenTextStrokes(
  section: CrossSection,
  lineWidth: number,
) {
  const initialParts = section.decompose();
  const componentCount = initialParts.length;
  initialParts.forEach((part) => part.delete());
  const contourCount = section.numContour();
  for (let step = 0; step <= 6; step++) {
    const expansion = step * 0.025;
    const offset = section.offset(expansion, 'Round', 2, 32);
    let candidate: CrossSection | undefined;
    try {
      candidate = offset.simplify(0.00001);
      const parts = candidate.decompose();
      let sameTopology: boolean;
      try {
        sameTopology =
          parts.length === componentCount &&
          candidate.numContour() === contourCount;
      } finally {
        parts.forEach((part) => part.delete());
      }
      const audit = auditTextStrokes(candidate, lineWidth);
      if (sameTopology && audit.passes) {
        const result = { section: candidate, expansion, audit };
        candidate = undefined; // Transfer ownership to the caller.
        return result;
      }
    } finally {
      candidate?.delete();
      offset.delete();
    }
  }
  throw new Error(
    'This text is too small for a 0.4 mm nozzle. Use fewer characters or more space.',
  );
}
