#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const REPOSITORY = 'bambulab/BambuStudio';
const REQUESTED_REF = process.env.BAMBU_STUDIO_REF || 'master';
const OUTPUT_DIR = path.resolve('data');
const WITH_STORE = process.argv.includes('--with-store');
const REFRESH_HANDLES = process.argv.includes('--refresh-handles');
const STORE_API = 'https://na-store-api.bambulab.com';
const STORE_SITE = 'https://us.store.bambulab.com';
const USER_AGENT =
  'Filament-Label-Lab-Catalog-Sync/0.1 (+https://github.com/byassin/bambu-filament-label-generator)';

async function fetchText(url, init = {}, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...init.headers },
      });
      if (!response.ok) {
        if (response.status === 429 && attempt < attempts - 1) {
          const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
          await new Promise((resolve) =>
            setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : 10_000 * (attempt + 1)),
          );
          continue;
        }
        throw new Error(`${response.status} ${response.statusText} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function fetchJson(url, init) {
  return JSON.parse(await fetchText(url, init));
}

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/\bfor\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function number(value) {
  const parsed = Number.parseFloat(String(first(value) ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  const resolved = first(value);
  return resolved == null || resolved === '' ? null : String(resolved);
}

function rgbaToHex(value) {
  const hex = String(value || '').toUpperCase();
  if (!/^#[0-9A-F]{8}$/.test(hex)) return null;
  return hex;
}

function colorType(value) {
  if (value === '渐变色') return 'gradient';
  if (value === '多拼色') return 'multi';
  return 'single';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function mapLimit(items, limit, mapper) {
  const output = Array.from({ length: items.length });
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function resolveCommit() {
  if (/^[0-9a-f]{40}$/i.test(REQUESTED_REF)) return REQUESTED_REF.toLowerCase();
  const commit = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/commits/${encodeURIComponent(REQUESTED_REF)}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  return commit.sha;
}

async function syncProfiles(commit) {
  const rawRoot = `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/resources/profiles`;
  const indexUrl = `${rawRoot}/BBL.json`;
  const colorUrl = `${rawRoot}/BBL/filament/filaments_color_codes.json`;
  const [indexText, colorsText] = await Promise.all([fetchText(indexUrl), fetchText(colorUrl)]);
  const index = JSON.parse(indexText);
  const colors = JSON.parse(colorsText);
  const colorRows = Array.isArray(colors) ? colors : colors.data;
  if (!Array.isArray(colorRows)) throw new Error('Unexpected Bambu color-table shape.');
  const entries = new Map(index.filament_list.map((entry) => [entry.name, entry]));
  const baseEntries = index.filament_list.filter((entry) => /^Bambu .+ @base$/i.test(entry.name));
  const profileCache = new Map();

  async function loadProfile(name, stack = []) {
    if (profileCache.has(name)) return profileCache.get(name);
    if (stack.includes(name)) throw new Error(`Profile inheritance cycle: ${[...stack, name].join(' -> ')}`);
    const entry = entries.get(name);
    if (!entry) return {};
    const profile = await fetchJson(`${rawRoot}/BBL/${encodePath(entry.sub_path)}`);
    const parentName = text(profile.inherits);
    const parent = parentName ? await loadProfile(parentName, [...stack, name]) : {};
    const resolved = { ...parent, ...profile };
    profileCache.set(name, resolved);
    return resolved;
  }

  function profileForType(type) {
    const exact = `Bambu ${type} @base`;
    if (entries.has(exact)) return exact;
    const target = normalize(`Bambu ${type}`);
    return baseEntries.find((entry) => normalize(entry.name.replace(/\s*@base$/i, '')) === target)?.name ?? null;
  }

  const types = [...new Set(colorRows.map((item) => item.fila_type).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const profileNames = new Map(types.map((type) => [type, profileForType(type)]));
  await mapLimit(
    [...new Set([...profileNames.values()].filter(Boolean))],
    8,
    (name) => loadProfile(name),
  );

  const catalog = colorRows
    .map((item) => {
      const profileName = profileNames.get(item.fila_type) || null;
      const profile = profileName ? profileCache.get(profileName) || {} : {};
      const colorValues = Array.isArray(item.fila_color)
        ? item.fila_color
        : String(item.fila_color || '').split(/\s+/).filter(Boolean);
      const rgba = colorValues.map(rgbaToHex).filter(Boolean);
      const transparent = rgba.some((value) => value === '#00000000');
      return {
        id: item.fila_color_code,
        product: item.fila_type,
        material: text(profile.filament_type) || item.fila_type,
        colorName: item.fila_color_name?.en || item.fila_color_code,
        colorCode: item.fila_color_code,
        colors: rgba,
        colorType: colorType(item.fila_color_type),
        transparent,
        amsId: item.fila_id,
        colorVariantId: item.color_code,
        specs: {
          profile: profileName,
          density: number(profile.filament_density),
          nozzleTemperature: number(profile.nozzle_temperature),
          nozzleTemperatureInitialLayer: number(profile.nozzle_temperature_initial_layer),
          hotPlateTemperature: number(profile.hot_plate_temp),
          coolPlateTemperature: number(profile.cool_plate_temp),
          texturedPlateTemperature: number(profile.textured_plate_temp),
          vitrificationTemperature: number(profile.temperature_vitrification),
          maxVolumetricSpeed: number(profile.filament_max_volumetric_speed),
          flowRatio: number(profile.filament_flow_ratio),
          requiredNozzleHrc: number(profile.required_nozzle_HRC),
          amsDryingTemperature: number(profile.filament_dev_ams_drying_temperature),
          amsDryingTime: number(profile.filament_dev_ams_drying_time),
          amsDryingLimitations: text(profile.filament_dev_ams_drying_ams_limitations),
          chamberDryingBedTemperature: number(profile.filament_dev_chamber_drying_bed_temperature),
          dryingCoolingTemperature: number(profile.filament_dev_drying_cooling_temperature),
          dryingSofteningTemperature: number(profile.filament_dev_drying_softening_temperature),
        },
      };
    })
    .sort((a, b) => a.product.localeCompare(b.product) || a.colorName.localeCompare(b.colorName));

  return {
    catalog,
    machines: index.machine_model_list.map((machine) => ({
      id: normalize(machine.name),
      name: machine.name.replace(/^Bambu Lab\s+/i, ''),
      fullName: machine.name,
      profilePath: machine.sub_path,
    })),
    source: {
      repository: `https://github.com/${REPOSITORY}`,
      commit,
      profileIndex: indexUrl,
      colorTable: colorUrl,
      profileVersion: index.version,
      colorTableSha256: sha256(colorsText),
      license: 'AGPL-3.0-only',
      licenseUrl: `https://github.com/${REPOSITORY}/blob/${commit}/LICENSE`,
    },
    unmatchedProfileTypes: types.filter((type) => !profileNames.get(type)),
  };
}

function parseColorCode(value) {
  return String(value || '').match(/\((\d{5})\)/)?.[1] ?? null;
}

async function discoverStoreHandles() {
  const sitemap = await fetchText(`${STORE_SITE}/sitemap_products_1.xml`);
  const handles = [...sitemap.matchAll(/<loc>https:\/\/[^<]+\/products\/([^<?<]+)[^<]*<\/loc>/g)]
    .map((match) => decodeURIComponent(match[1]))
    .filter((value, index, all) => all.indexOf(value) === index);
  const discoveryErrors = [];
  const products = await mapLimit(handles, 2, async (handle, index) => {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const payload = await fetchJson(`${STORE_API}/mall-goods/product/queryById?seoCode=${encodeURIComponent(handle)}`, {
        headers: { Referer: `${STORE_SITE}/` },
      });
      return payload?.data?.isFilament ? handle : null;
    } catch (error) {
      discoveryErrors.push({ handle, message: error.message });
      process.stderr.write(`Store discovery warning for ${handle}: ${error.message}\n`);
      return null;
    }
  });
  if (discoveryErrors.length) {
    throw new Error(
      `Store handle refresh aborted after ${discoveryErrors.length} request failures; the last good cache was preserved.`,
    );
  }
  return products.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function loadStoreHandles() {
  const file = path.join(OUTPUT_DIR, 'store-handles.json');
  if (REFRESH_HANDLES) {
    const handles = await discoverStoreHandles();
    await writeFile(file, `${JSON.stringify(handles, null, 2)}\n`);
    return handles;
  }
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error('Store handles are missing. Run with --with-store --refresh-handles once.');
  }
}

async function syncStore() {
  const handles = await loadStoreHandles();
  const products = await mapLimit(handles, 1, async (handle, index) => {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 900));
    const payload = await fetchJson(`${STORE_API}/mall-goods/product/queryById?seoCode=${encodeURIComponent(handle)}`, {
      headers: { Referer: `${STORE_SITE}/` },
    });
    return payload?.data || null;
  });
  const byColorCode = {};
  for (const product of products.filter(Boolean)) {
    for (const sku of product.productSkuList || []) {
      const properties = Object.fromEntries(
        (sku.productSkuPropertyList || []).map((property) => [property.propertyKey, property.propertyValue]),
      );
      const colorValue = properties.Color || properties.color || '';
      const code = parseColorCode(colorValue);
      if (!code) continue;
      const variant = {
        skuId: String(sku.id),
        spoolType: properties.Type || properties.type || null,
        size: properties.Size || properties.size || null,
        priceUsd: number(sku.price),
        discountUsd: number(sku.discountPrice),
        soldOut: Boolean(sku.isSoldOut),
        maximum: number(sku.maximum),
      };
      const existing = byColorCode[code] || {
        product: product.name,
        handle: product.seoCode,
        url: `${STORE_SITE}/products/${product.seoCode}`,
        variants: [],
      };
      existing.variants.push(variant);
      byColorCode[code] = existing;
    }
  }
  return {
    region: 'US',
    syncedAt: new Date().toISOString(),
    endpoint: `${STORE_API}/mall-goods/product/queryById`,
    handles: handles.length,
    byColorCode,
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const commit = await resolveCommit();
  const profiles = await syncProfiles(commit);
  const store = WITH_STORE ? await syncStore() : null;
  const catalog = profiles.catalog.map((item) => ({
    ...item,
    ...(store?.byColorCode[item.colorCode] ? { store: store.byColorCode[item.colorCode] } : {}),
  }));
  const generatedAt = new Date().toISOString();
  const payload = { schemaVersion: 1, generatedAt, source: profiles.source, catalog };
  const machines = { schemaVersion: 1, generatedAt, source: profiles.source, machines: profiles.machines };
  await Promise.all([
    writeFile(path.join(OUTPUT_DIR, 'bambu-catalog.json'), `${JSON.stringify(payload, null, 2)}\n`),
    writeFile(path.join(OUTPUT_DIR, 'bambu-machines.json'), `${JSON.stringify(machines, null, 2)}\n`),
    writeFile(
      path.join(OUTPUT_DIR, 'sync-report.json'),
      `${JSON.stringify(
        {
          generatedAt,
          source: profiles.source,
          catalogRows: catalog.length,
          machineModels: profiles.machines.length,
          unmatchedProfileTypes: profiles.unmatchedProfileTypes,
          store: store
            ? { region: store.region, handles: store.handles, matchedColors: Object.keys(store.byColorCode).length }
            : null,
        },
        null,
        2,
      )}\n`,
    ),
  ]);
  process.stdout.write(
    `Wrote ${catalog.length} filament colors and ${profiles.machines.length} printer models from BambuStudio ${commit.slice(0, 12)}${
      store ? `; store matched ${Object.keys(store.byColorCode).length} colors` : ''
    }.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
