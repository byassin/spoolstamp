import templateUrl from '../assets/supplied-drybox.mesh?url';
import manifest from '@/data/supplied-drybox.json';
import type { LabelMesh } from '@/lib/generate-3mf';
import { relieveHingeBearings } from '@/lib/hinge-clearance';

export const SUPPLIED_DRYBOX = manifest;
let templatePromise: Promise<LabelMesh[]> | undefined;

/** Decode the source coordinates without rounding, welding, or remeshing. */
export function decodeSuppliedDryBox(buffer: ArrayBuffer): LabelMesh[] {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  if (
    buffer.byteLength < 12 ||
    decoder.decode(new Uint8Array(buffer, 0, 8)) !== 'FLLMESH1'
  ) {
    throw new Error('Invalid dry-box template');
  }
  let offset = 8;
  const uint = () => {
    if (offset + 4 > view.byteLength)
      throw new Error('Incomplete dry-box template');
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const count = uint();
  if (count !== manifest.parts.length)
    throw new Error('Unexpected template part count');
  const parts: LabelMesh[] = [];
  for (let partIndex = 0; partIndex < count; partIndex++) {
    const nameLength = uint();
    const vertexCount = uint();
    const triangleCount = uint();
    const expected = manifest.parts[partIndex];
    if (
      vertexCount !== expected.vertexCount ||
      triangleCount !== expected.triangleCount ||
      nameLength > 100
    ) {
      throw new Error('Unexpected template geometry');
    }
    const name = decoder.decode(new Uint8Array(buffer, offset, nameLength));
    offset += nameLength;
    if (
      name !== expected.name ||
      offset + vertexCount * 12 + triangleCount * 12 > view.byteLength
    ) {
      throw new Error('Incomplete template part');
    }
    const vertices = Array.from({ length: vertexCount * 3 }, () => {
      const value = view.getFloat32(offset, true);
      offset += 4;
      if (!Number.isFinite(value))
        throw new Error('Invalid template coordinate');
      return value;
    });
    const triangles = Array.from({ length: triangleCount * 3 }, () => {
      const index = uint();
      if (index >= vertexCount) throw new Error('Invalid template triangle');
      return index;
    });
    parts.push({
      name,
      materialRole: 'structure',
      color: '#D9E0DBFF',
      vertices,
      triangles,
      preserveSourceCoordinates: true,
    });
  }
  if (offset !== buffer.byteLength) throw new Error('Unexpected template data');
  return parts;
}

export function setSuppliedDryBoxBuffer(source: ArrayBuffer | null) {
  templatePromise = source
    ? Promise.resolve(decodeSuppliedDryBox(source).map(relieveHingeBearings))
    : undefined;
}

export async function buildSuppliedDryBoxMeshes(color: string) {
  if (!templatePromise) {
    templatePromise = fetch(templateUrl)
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Unable to load the dry-box template');
        return decodeSuppliedDryBox(await response.arrayBuffer()).map(
          relieveHingeBearings,
        );
      })
      .catch((error: unknown) => {
        templatePromise = undefined;
        throw error;
      });
  }
  const normalized = /^#[0-9A-F]{8}$/i.test(color) ? color : `${color}FF`;
  return (await templatePromise).map((part) => ({
    ...part,
    color: normalized.toUpperCase(),
  }));
}
