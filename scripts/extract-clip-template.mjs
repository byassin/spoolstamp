import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// File-specific adapter: close the original pocket mouth without remeshing
// the spring, clip opening, filament eye, or the remaining label body.
const EXPECTED_SHA256 =
  'e328ce1fa4e135e1e94348b78fdb448b088f8c0e5a10880d57329ff05bf6d47f';
const sourcePath = process.argv[2];
if (!sourcePath)
  throw new Error('Usage: node scripts/extract-clip-template.mjs SOURCE.stl');
const source = await readFile(sourcePath);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (
  digest(source) !== EXPECTED_SHA256 ||
  source.length !== 210884 ||
  source.readUInt32LE(80) !== 4216
) {
  throw new Error(
    'Not the inspected clip STL. Inspect another file before adapting it.',
  );
}
const pointBytes = (face, corner) =>
  source.subarray(
    84 + face * 50 + 12 + corner * 12,
    84 + face * 50 + 24 + corner * 12,
  );
const removedDegenerateFaces = [2796, 3943];
const vertices = [],
  triangles = [],
  retainedBytes = [],
  indexByBytes = new Map();
function append(bytes) {
  const key = bytes.toString('hex');
  let index = indexByBytes.get(key);
  if (index === undefined) {
    index = vertices.length / 3;
    indexByBytes.set(key, index);
    for (let axis = 0; axis < 3; axis++)
      vertices.push(bytes.readFloatLE(axis * 4));
  }
  triangles.push(index);
}
for (let face = 0; face < 4206; face++) {
  if (removedDegenerateFaces.includes(face)) continue;
  for (let corner = 0; corner < 3; corner++) {
    const bytes = pointBytes(face, corner);
    retainedBytes.push(bytes);
    append(bytes);
  }
}
// A, B, C, D surround the existing pocket mouth; viewed from -Y, A-B-C
// and A-C-D point outward and share the exact original boundary vertices.
const mouth = [
  pointBytes(4210, 0),
  pointBytes(4213, 2),
  pointBytes(4215, 2),
  pointBytes(4208, 0),
];
for (const corner of [0, 1, 2, 0, 2, 3]) append(mouth[corner]);
const edges = new Map();
for (let i = 0; i < triangles.length; i += 3) {
  const face = triangles.slice(i, i + 3);
  for (let j = 0; j < 3; j++) {
    const from = face[j],
      to = face[(j + 1) % 3];
    const key = [Math.min(from, to), Math.max(from, to)].join(',');
    const uses = edges.get(key) ?? [];
    uses.push(from < to ? 1 : -1);
    edges.set(key, uses);
  }
}
if (
  [...edges.values()].some((uses) => uses.length !== 2 || uses[0] === uses[1])
)
  throw new Error('Adapted clip is not an oriented closed mesh.');
const header = Buffer.alloc(16);
header.write('FLLCLIP1');
header.writeUInt32LE(vertices.length / 3, 8);
header.writeUInt32LE(triangles.length / 3, 12);
const geometry = Buffer.alloc((vertices.length + triangles.length) * 4);
vertices.forEach((v, i) => geometry.writeFloatLE(v, i * 4));
triangles.forEach((v, i) =>
  geometry.writeUInt32LE(v, (vertices.length + i) * 4),
);
const asset = Buffer.concat([header, geometry]);
const bounds = {
  min: [0, 1, 2].map((a) =>
    Math.min(...vertices.filter((_, i) => i % 3 === a)),
  ),
  max: [0, 1, 2].map((a) =>
    Math.max(...vertices.filter((_, i) => i % 3 === a)),
  ),
};
const manifest = {
  schemaVersion: 1,
  sourceFilename: path.basename(sourcePath),
  sourceSha256: EXPECTED_SHA256,
  sourceTriangleCount: 4216,
  retainedTriangleCount: 4204,
  removedPocketTriangleCount: 10,
  removedDegenerateFaces,
  addedFaceTriangleCount: 2,
  triangleCount: triangles.length / 3,
  vertexCount: vertices.length / 3,
  bounds,
  retainedTriangleCoordinatesSha256: digest(Buffer.concat(retainedBytes)),
  assetSha256: digest(asset),
  operation:
    'Replace the ten recessed-pocket triangles with two triangles across the original mouth. Omit two zero-area source triangles. Preserve all other source triangle coordinates and winding.',
  faceNormal: [0, -1, 0],
  textFaceY: Math.min(...mouth.map((bytes) => bytes.readFloatLE(4))),
  faceFlatnessTolerance: 0.001,
  textArea: { minX: 13.1, maxX: 49.6, minZ: 1.2, maxZ: 13.8 },
};
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
await writeFile(path.join(project, 'assets', 'clip-label.mesh'), asset);
await writeFile(
  path.join(project, 'data', 'clip-label.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(JSON.stringify(manifest, null, 2));
