import type {
  CrossSection as CrossSectionInstance,
  Manifold as ManifoldInstance,
  ManifoldToplevel,
} from 'manifold-3d';

export type TriangleMeshTarget = {
  vertices: number[];
  triangles: number[];
};

let runtimePromise: Promise<ManifoldToplevel> | undefined;

/**
 * Loads the robust Manifold WASM kernel once. Keeping this behind a dynamic
 * import leaves the initial interface bundle light and avoids initializing CAD
 * machinery until a preview or download is requested.
 */
export function loadManifoldRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('manifold-3d')
      .then(async ({ default: createModule }) => {
        const runtime = await createModule();
        runtime.setup();
        return runtime;
      })
      .catch((error: unknown) => {
        runtimePromise = undefined;
        throw error;
      });
  }
  return runtimePromise;
}

export function copyManifoldMesh(
  target: TriangleMeshTarget,
  solid: ManifoldInstance,
) {
  const source = solid.getMesh();
  const offset = target.vertices.length / 3;
  for (
    let index = 0;
    index < source.vertProperties.length;
    index += source.numProp
  ) {
    target.vertices.push(
      source.vertProperties[index],
      source.vertProperties[index + 1],
      source.vertProperties[index + 2],
    );
  }
  for (const index of source.triVerts) target.triangles.push(index + offset);
}

export function deleteCrossSections(...values: CrossSectionInstance[]) {
  values.forEach((value) => value.delete());
}

export function deleteManifolds(...values: ManifoldInstance[]) {
  values.forEach((value) => value.delete());
}
