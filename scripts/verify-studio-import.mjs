// Optional installed-Studio check. Never launches an interactive session or prints.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import JSZip from 'jszip';

const executable = process.argv[2];
if (!executable)
  throw new Error(
    'Usage: node scripts/verify-studio-import.mjs PATH_TO_BAMBU_STUDIO',
  );
const fixtures = [
  ['drybox', '.tmp/supplied-drybox-text-smoke.3mf'],
  ['petg-p1s', '.tmp/studio-config-verification/petg-p1s.3mf'],
  ['pla-x2d', '.tmp/studio-config-verification/pla-x2d.3mf'],
  ['tough-basic-x2d', '.tmp/studio-config-verification/tough-basic-x2d.3mf'],
];
const run = promisify(execFile);
const results = [];

// Audit actual world coordinates, not just the importer exit code. Studio may
// recenter individual meshes and split them into separate .model resources.
async function worldBounds(zip) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const documents = new Map();
  const attributes = (xml) =>
    Object.fromEntries(
      [...xml.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
  const matrix = (value) => {
    const result = value
      ? value.trim().split(/\s+/).map(Number)
      : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    assert.ok(
      result.length === 12 && result.every(Number.isFinite),
      'Invalid 3MF transform',
    );
    return result;
  };
  async function document(filename) {
    if (!documents.has(filename)) {
      const xml = await zip.file(filename).async('string');
      documents.set(filename, {
        xml,
        objects: new Map(
          [...xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)].map(
            (match) => [attributes(match[1]).id, match[2]],
          ),
        ),
      });
    }
    return documents.get(filename);
  }
  async function visit(filename, id, transforms, ancestors = []) {
    const key = `${filename}:${id}`;
    assert.ok(
      ancestors.length < 20 && !ancestors.includes(key),
      'Cyclic 3MF assembly',
    );
    const object = (await document(filename)).objects.get(id);
    assert.ok(object, `Missing 3MF object ${key}`);
    for (const match of object.matchAll(/<vertex\b([^>]*)\/>/g)) {
      const point = attributes(match[1]);
      let position = [Number(point.x), Number(point.y), Number(point.z)];
      for (const transform of [...transforms].reverse()) {
        const [x, y, z] = position;
        position = [0, 1, 2].map(
          (axis) =>
            x * transform[axis] +
            y * transform[axis + 3] +
            z * transform[axis + 6] +
            transform[axis + 9],
        );
      }
      position.forEach((value, axis) => {
        assert.ok(Number.isFinite(value));
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      });
    }
    for (const match of object.matchAll(/<component\b([^>]*)\/>/g)) {
      const component = attributes(match[1]);
      const target = component['p:path'];
      const childFile = target
        ? target.startsWith('/')
          ? target.slice(1)
          : path.posix.join(path.posix.dirname(filename), target)
        : filename;
      await visit(
        childFile,
        component.objectid,
        [...transforms, matrix(component.transform)],
        [...ancestors, key],
      );
    }
  }
  const main = await document('3D/3dmodel.model');
  const build = main.xml.match(/<build\b[^>]*>([\s\S]*?)<\/build>/)?.[1];
  assert.ok(build, 'Missing 3MF build');
  for (const match of build.matchAll(/<item\b([^>]*)\/>/g)) {
    const item = attributes(match[1]);
    await visit('3D/3dmodel.model', item.objectid, [matrix(item.transform)]);
  }
  assert.ok(min.every(Number.isFinite), 'Empty 3MF build');
  return { min, max };
}

for (const [name, input] of fixtures) {
  const output = path.resolve('.tmp/studio-config-verification', name);
  await mkdir(output, { recursive: true });
  await run(
    executable,
    [
      '--debug',
      '2',
      '--export-3mf',
      'verified.3mf',
      '--outputdir',
      output,
      path.resolve(input),
    ],
    {
      windowsHide: true,
      timeout: 30_000,
    },
  );
  const status = JSON.parse(
    await readFile(path.join(output, 'result.json'), 'utf8'),
  );
  assert.equal(status.return_code, 0);
  const before = await JSZip.loadAsync(await readFile(input));
  const after = await JSZip.loadAsync(
    await readFile(path.join(output, 'verified.3mf')),
  );
  const original = JSON.parse(
    await before.file('Metadata/project_settings.config').async('string'),
  );
  const imported = JSON.parse(
    await after.file('Metadata/project_settings.config').async('string'),
  );
  const placement = JSON.parse(
    await before.file('Metadata/filament-label-lab.json').async('string'),
  ).buildPlatePlacement;
  const actualBounds = await worldBounds(after);
  for (const side of ['min', 'max'])
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Math.abs(actualBounds[side][axis] - placement.bounds[side][axis]) <
          0.001,
        `${name}: native placement ${side}/${axis} changed`,
      );
  assert.ok(Math.abs(actualBounds.min[2]) < 0.001, `${name}: not on bed`);
  const bed = original.printable_area.map((point) =>
    point.trim().split('x').map(Number),
  );
  for (let axis = 0; axis < 2; axis++) {
    assert.ok(
      actualBounds.min[axis] >=
        Math.min(...bed.map((point) => point[axis])) + 10 - 0.001,
      `${name}: near bed edge`,
    );
    assert.ok(
      actualBounds.max[axis] <=
        Math.max(...bed.map((point) => point[axis])) - 10 + 0.001,
      `${name}: near bed edge`,
    );
  }
  if (original.bed_exclude_area.length) {
    const excluded = original.bed_exclude_area.map((point) =>
      point.split('x').map(Number),
    );
    assert.ok(
      [0, 1].some(
        (axis) =>
          actualBounds.max[axis] <=
            Math.min(...excluded.map((point) => point[axis])) - 10 + 0.001 ||
          actualBounds.min[axis] >=
            Math.max(...excluded.map((point) => point[axis])) + 10 - 0.001,
      ),
      `${name}: too close to exclusion area`,
    );
  }
  for (const key of [
    'printer_model',
    'printer_settings_id',
    'print_settings_id',
    'filament_settings_id',
    'filament_colour',
    'filament_type',
    'filament_ids',
    'filament_diameter',
    'nozzle_diameter',
    'extruder_type',
    'flush_volumes_matrix',
    'flush_volumes_vector',
    'flush_multiplier',
    'flush_multiplier_fast',
  ])
    assert.deepEqual(imported[key], original[key], `${name}: ${key}`);
  const settings = await after
    .file('Metadata/model_settings.config')
    .async('string');
  const originalSettings = await before
    .file('Metadata/model_settings.config')
    .async('string');
  const faceCounts = (xml) =>
    [...xml.matchAll(/<mesh_stat face_count="(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
  assert.deepEqual(
    faceCounts(settings),
    faceCounts(originalSettings),
    `${name}: face counts changed`,
  );
  for (const stat of settings.matchAll(/<mesh_stat\b[^>]+/g))
    for (const field of [
      'edges_fixed',
      'degenerate_facets',
      'facets_removed',
      'facets_reversed',
      'backwards_edges',
    ])
      assert.ok(
        stat[0].includes(`${field}="0"`),
        `${name}: native repair in ${field}`,
      );
  const roles = (xml) =>
    [...xml.matchAll(/<part\b[^>]*>([\s\S]*?)<\/part>/g)].map(
      (match) => match[1].match(/<metadata key="extruder" value="(\d+)"/)?.[1],
    );
  assert.deepEqual(
    roles(settings),
    roles(originalSettings),
    `${name}: body/text assignments changed`,
  );
  results.push({
    name,
    status: 'passed',
    printer: imported.printer_settings_id,
    filaments: imported.filament_settings_id,
    colors: imported.filament_colour,
    faceCounts: faceCounts(settings),
    repairs: 0,
    worldBounds: actualBounds,
  });
}
await writeFile(
  '.tmp/studio-config-verification/verification.json',
  JSON.stringify(
    {
      scope:
        'Native import/re-export, world placement and assignments; not desktop UI, slicing, AMS mapping, or physical printing.',
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(results, null, 2));
