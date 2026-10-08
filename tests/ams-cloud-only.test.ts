import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AmsPanel } from '../components/ams-panel';
import { CloudAmsConnection } from '../components/cloud-ams-connection';
import { FILAMENTS, PRINTERS } from '../lib/catalog';

describe('cloud-only AMS feature', () => {
  it('removes LAN registration and legacy credential-reading modules', () => {
    const config = readFileSync(
      new URL('../vite.config.ts', import.meta.url),
      'utf8',
    );
    expect(config).not.toMatch(/localAms|local-ams/);
    for (const path of [
      'scripts/local-ams.ts',
      'scripts/ams-network.ts',
      'scripts/ams-pairing-store.ts',
      'lib/ams-client.ts',
    ])
      expect(existsSync(new URL('../' + path, import.meta.url))).toBe(false);
  });
  it('keeps manual fallback without local pairing or saved-printer controls', () => {
    const markup = renderToStaticMarkup(
      createElement(AmsPanel, {
        filament: FILAMENTS[0],
        printerName: PRINTERS[0].fullName,
        design: 'drybox-tab',
        autoText: false,
        onAutoTextChange() {},
        onSelect() {},
      }),
    );
    expect(markup).toContain('choose filament manually');
    expect(markup).not.toMatch(
      /Printer IP|LAN access code|Reconnect saved|Remember this printer|certificate|Forget saved/,
    );
  });
  it('offers only explicit cloud connection, not a LAN switch', () => {
    const markup = renderToStaticMarkup(
      createElement(CloudAmsConnection, {
        origin: 'https://ams.spoolstamp.bourhan.org',
        onInventory() {},
      }),
    );
    expect(markup).toContain('Connect Bambu Cloud');
    expect(markup).not.toMatch(
      /LAN connection|Printer IP|LAN access code|Remember this printer/,
    );
  });
  it('keeps consent concise and privacy details provider-neutral', () => {
    const source = readFileSync(
      new URL('../components/cloud-ams-connection.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'I agree to let Spoolstamp use my Bambu sign-in to read my AMS.',
    );
    expect(source).toContain('<summary>Privacy details</summary>');
    expect(source).toContain('temporarily encrypted on our server');
    expect(source).toContain('Verification codes aren’t stored');
    expect(source).toContain('remain for days until cleanup');
    expect(source).toContain('Sign-in expires after 30 minutes');
    expect(source).toContain('disabled={busy || !consent || !state}');
    expect(source).not.toMatch(/AWS|unofficial/i);
    expect(source).not.toContain('restarting the backend also signs you out');
  });
});
