import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This adapter is deliberately specific to the supplied file. It selects whole
// mechanical components, never clips the card or rebuilds the hinge from dimensions.
const EXPECTED_SHA256 =
  '970ba1c28f13db9db89dcbfefedcdcfae9cab449b170773c2fba380536c89398';
// Inspected source-only defects: each pair is the same microscopic triangle
// twice with opposite winding. Both faces must go; dropping only one opens a hole.
const opposingFacePairs = [
  [81195, 88420],
  [117689, 124097],
  [117691, 124699],
];
const excludedFaces = new Set(opposingFacePairs.flat());
const parts = [
  { name: 'label-card', firstTriangle: 0, triangleCount: 52578 },
  { name: 'side-entry-mount', firstTriangle: 52578, triangleCount: 108304 },
  { name: 'hinge-link-left', firstTriangle: 193682, triangleCount: 32800 },
  { name: 'hinge-link-right', firstTriangle: 160882, triangleCount: 32800 },
];
const sourcePath = process.argv[2];
if (!sourcePath)
  throw new Error('Usage: node scripts/extract-drybox-template.mjs SOURCE.stl');
const source = await readFile(sourcePath);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (digest(source) !== EXPECTED_SHA256)
  throw new Error(
    'This is not the inspected source STL. Inspect component boundaries before adapting another file.',
  );
if (source.readUInt32LE(80) !== 245138 || source.length !== 12256984)
  throw new Error('Unexpected STL layout');
const faceVertices = (face) =>
  Array.from({ length: 3 }, (_, corner) => {
    const offset = 84 + face * 50 + 12 + corner * 12;
    return source.subarray(offset, offset + 12).toString('hex');
  });
for (const [first, second] of opposingFacePairs) {
  const a = faceVertices(first);
  const b = faceVertices(second);
  if (
    new Set(a).size !== 3 ||
    ![0, 1, 2].some((start) =>
      a.every((vertex, index) => vertex === b[(start - index + 3) % 3]),
    )
  )
    throw new Error(
      `Source repair pair ${first}/${second} is not exactly opposed`,
    );
}

const header = Buffer.alloc(12);
header.write('FLLMESH1', 0, 'ascii');
header.writeUInt32LE(parts.length, 8);
const chunks = [header];
const manifestParts = [];
let removedFaces = 0;
for (const part of parts) {
  const vertices = [];
  const indices = [];
  const vertexIndex = new Map();
  const triangleBytes = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (
    let face = part.firstTriangle;
    face < part.firstTriangle + part.triangleCount;
    face++
  ) {
    if (excludedFaces.has(face)) {
      removedFaces++;
      continue;
    }
    for (let corner = 0; corner < 3; corner++) {
      const offset = 84 + face * 50 + 12 + corner * 12;
      const bytes = source.subarray(offset, offset + 12);
      triangleBytes.push(bytes);
      const key = bytes.toString('hex');
      let index = vertexIndex.get(key);
      if (index === undefined) {
        index = vertices.length / 3;
        vertexIndex.set(key, index);
        for (let axis = 0; axis < 3; axis++) {
          const value = bytes.readFloatLE(axis * 4);
          if (!Number.isFinite(value))
            throw new Error('Non-finite source vertex');
          vertices.push(value);
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      indices.push(index);
    }
  }
  const name = Buffer.from(part.name, 'utf8');
  const partHeader = Buffer.alloc(12);
  partHeader.writeUInt32LE(name.length, 0);
  partHeader.writeUInt32LE(vertices.length / 3, 4);
  partHeader.writeUInt32LE(indices.length / 3, 8);
  const vertexBytes = Buffer.alloc(vertices.length * 4);
  vertices.forEach((value, index) =>
    vertexBytes.writeFloatLE(value, index * 4),
  );
  const indexBytes = Buffer.alloc(indices.length * 4);
  indices.forEach((value, index) => indexBytes.writeUInt32LE(value, index * 4));
  chunks.push(partHeader, name, vertexBytes, indexBytes);
  manifestParts.push({
    ...part,
    sourceTriangleCount: part.triangleCount,
    triangleCount: indices.length / 3,
    vertexCount: vertices.length / 3,
    bounds: { min, max },
    triangleCoordinatesSha256: digest(Buffer.concat(triangleBytes)),
  });
}
if (removedFaces !== 6)
  throw new Error('Expected exactly six source repair faces');
const mesh = Buffer.concat(chunks);
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
await mkdir(path.join(project, 'assets'), { recursive: true });
await writeFile(path.join(project, 'assets', 'supplied-drybox.mesh'), mesh);
const manifest = {
  schemaVersion: 1,
  sourceFilename: path.basename(sourcePath),
  sourceSha256: EXPECTED_SHA256,
  sourceTriangleCount: 245138,
  retainedTriangleCount: 226476,
  removedZeroThicknessTriangleCount: removedFaces,
  removedOpposingFacePairs: opposingFacePairs,
  removedLetteringTriangleCount: 18656,
  removedLetteringComponents: 66,
  assetSha256: digest(mesh),
  operation:
    'Retain the four original mechanical components with exact Float32 coordinates and winding of all retained triangles. Remove the separate lettering and three microscopic zero-thickness opposing face pairs from the source hook (six faces, zero net volume). No scaling, remeshing, Boolean operations, or hinge dimension changes.',
  textFaceZ: 3.2000732421875,
  parts: manifestParts,
};
await writeFile(
  path.join(project, 'data', 'supplied-drybox.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      retainedTriangles: manifest.retainedTriangleCount,
      removedTextTriangles: manifest.removedLetteringTriangleCount,
      assetBytes: mesh.length,
      sourceSha256: manifest.sourceSha256,
    },
    null,
    2,
  ),
);
