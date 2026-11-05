import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, APP_VERSION_LABEL } from '../lib/app-version';
import pkg from '../package.json';
import lock from '../package-lock.json';
import { connectionStatus, formatReadWait } from '../lib/ams-freshness';
import { captureLabelChoices } from '../lib/ams-label-choices';
import { AmsConnectionStatus } from '../components/ams-connection-status';
import { AmsLabelChoices } from '../components/ams-label-choices';
import type { HostedCloudState } from '../lib/cloud-ams';
import { FILAMENTS } from '../lib/catalog';

const now = 100_000;
const state = (): HostedCloudState => ({
  csrf: 'a'.repeat(64),
  authenticated: true,
  codeRequested: false,
  expiresAt: now + 60_000,
  printers: [
    { serial: 'test-only', name: 'Test printer', model: 'X2D', online: true },
  ],
  selectedSerial: 'test-only',
  pending: false,
  refreshAfter: now + 300_000,
  inventory: {
    available: true,
    connected: true,
    printerName: 'Bambu Lab X2D',
    firmware: null,
    updatedAt: now - 8_000,
    stale: false,
    message: 'Fresh cloud snapshot.',
    slots: [],
  },
});
describe('concise AMS status and reusable catalog choices', () => {
  it('prioritizes printer selection and reading over an old/empty snapshot', () => {
    const value = state();
    expect(connectionStatus(value, '', now).kind).toBe('select');
    value.pending = true;
    value.inventory.updatedAt = null;
    expect(connectionStatus(value, 'test-only', now).kind).toBe('reading');
    expect(connectionStatus(value, 'test-only', now).detail).not.toContain(
      'No current',
    );
  });
  it('separates a fresh snapshot from reusable choices and respects the exact freshness limit', () => {
    const value = state();
    expect(connectionStatus(value, 'test-only', now)).toMatchObject({
      kind: 'fresh',
      title: 'Spools ready',
    });
    value.inventory.updatedAt = now - 45_000;
    expect(connectionStatus(value, 'test-only', now)).toMatchObject({
      kind: 'expired',
    });
    expect(connectionStatus(value, 'test-only', now).detail).not.toContain(
      'below',
    );
    expect(connectionStatus(value, 'test-only', now, true).title).toBe(
      'Label choices ready',
    );
    value.inventory.updatedAt = null;
    value.selectedSerial = null;
    expect(connectionStatus(value, 'test-only', now).kind).toBe('ready');
    expect(formatReadWait(287)).toBe('4:47');
    expect(formatReadWait(0)).toBe('0:00');
  });
  it('renders a single block status with no adjacent inline outputs', () => {
    for (const pending of [false, true]) {
      const value = state();
      value.pending = pending;
      const markup = renderToStaticMarkup(
        createElement(AmsConnectionStatus, {
          state: value,
          printer: 'test-only',
          now,
        }),
      );
      expect(markup).toContain('class="ams-connection-status"');
      expect(markup.match(/<output>/g)).toHaveLength(1);
      expect(markup).not.toContain('Sign in to read');
    }
  });
  it('captures only exact catalog matches while fresh, without printer or slot data', () => {
    const value = state();
    value.inventory.slots = [
      {
        key: '0:0',
        unit: '0',
        slot: '0',
        label: 'A1',
        present: true,
        reading: false,
        material: 'PLA',
        productId: 'GFA00',
        color: '#000000FF',
        colors: ['#000000FF'],
        remaining: 28,
      },
    ];
    const choices = captureLabelChoices(value.inventory, now);
    expect(choices.map((row) => row.colorName)).toEqual(['Black']);
    expect(JSON.stringify(choices)).not.toMatch(
      /remaining|test-only|"slot"|"unit"|updatedAt/,
    );
    expect(captureLabelChoices({ ...value.inventory, stale: true })).toEqual(
      [],
    );
    expect(
      captureLabelChoices({
        ...value.inventory,
        updatedAt: Date.now() - 45_000,
      }),
    ).toEqual([]);
    expect(
      captureLabelChoices({
        ...value.inventory,
        updatedAt: Date.now(),
        slots: [{ ...value.inventory.slots[0], productId: 'UNKNOWN' }],
      }),
    ).toEqual([]);
  });
  it('offers reusable labels without a live snapshot, cooldown or remaining-percentage claims', () => {
    const markup = renderToStaticMarkup(
      createElement(AmsLabelChoices, {
        choices: [FILAMENTS[0]],
        onSelect() {},
      }),
    );
    expect(markup).toContain('Labels from your last read');
    expect(markup).toContain('Use label');
    expect(markup).toContain('not live inventory');
    expect(markup).not.toMatch(/ disabled[=> ]|remaining|Refresh in/);
  });
});
describe('release version', () => {
  it('uses the package version consistently without a manually maintained UI version', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(lock.version).toBe(APP_VERSION);
    expect(lock.packages[''].version).toBe(APP_VERSION);
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION}`);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
