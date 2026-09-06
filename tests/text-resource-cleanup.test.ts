import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrossSection } from 'manifold-3d';
import * as cad from '@/lib/manifold-cad';
import { appendOpenTypePathGeometry } from '@/lib/vector-text';
import {
  auditTextStrokes,
  strengthenTextStrokes,
} from '@/lib/text-printability';

afterEach(() => vi.restoreAllMocks());

describe('text geometry resource ownership', () => {
  it.each(['scale', 'position', 'simplify', 'extrude', 'translate', 'copy'])(
    'releases every acquired resource after %s fails',
    async (failure) => {
      const resources: { delete: ReturnType<typeof vi.fn> }[] = [];
      function check(stage: string) {
        if (stage === failure) throw new Error(`Failed ${stage}`);
      }
      class Section {
        delete = vi.fn();
        constructor() {
          resources.push(this);
        }
        scale() {
          check('scale');
          return new Section();
        }
        translate() {
          check('position');
          return new Section();
        }
        simplify() {
          check('simplify');
          return new Section();
        }
      }
      class Solid {
        delete = vi.fn();
        constructor() {
          resources.push(this);
        }
        static extrude() {
          check('extrude');
          return new Solid();
        }
        translate() {
          check('translate');
          return new Solid();
        }
        getMesh() {
          check('copy');
          return { vertProperties: [], triVerts: [], numProp: 3 };
        }
      }
      vi.spyOn(cad, 'loadManifoldRuntime').mockResolvedValue({
        CrossSection: Section,
        Manifold: Solid,
      } as unknown as Awaited<ReturnType<typeof cad.loadManifoldRuntime>>);

      await expect(
        appendOpenTypePathGeometry(
          { vertices: [], triangles: [] },
          [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 10, y: 0 },
            { type: 'L', x: 0, y: 10 },
            { type: 'Z' },
          ],
          0,
          0,
          0,
          20,
          10,
          0.8,
          undefined,
          { contourTolerance: 0.0001 },
        ),
      ).rejects.toThrow(`Failed ${failure}`);
      expect(resources.length).toBeGreaterThan(0);
      for (const resource of resources)
        expect(resource.delete).toHaveBeenCalledTimes(1);
    },
  );

  it('releases both current and unvisited audit components after an offset fails', () => {
    const core = {
      delete: vi.fn(),
      offset: () => {
        throw new Error('offset failed');
      },
    };
    const first = { delete: vi.fn(), offset: () => core };
    const second = { delete: vi.fn() };
    const section = { decompose: () => [first, second], delete: vi.fn() };
    expect(() =>
      auditTextStrokes(section as unknown as CrossSection, 0.45),
    ).toThrow('offset failed');
    for (const resource of [core, first, second])
      expect(resource.delete).toHaveBeenCalledTimes(1);
    expect(section.delete).not.toHaveBeenCalled();
  });

  it('releases an outline offset when simplification fails', () => {
    const part = { delete: vi.fn() };
    const offset = {
      delete: vi.fn(),
      simplify: () => {
        throw new Error('simplify failed');
      },
    };
    const section = {
      decompose: () => [part],
      numContour: () => 1,
      offset: () => offset,
      delete: vi.fn(),
    };
    expect(() =>
      strengthenTextStrokes(section as unknown as CrossSection, 0.45),
    ).toThrow('simplify failed');
    for (const resource of [part, offset])
      expect(resource.delete).toHaveBeenCalledTimes(1);
    expect(section.delete).not.toHaveBeenCalled();
  });
});
