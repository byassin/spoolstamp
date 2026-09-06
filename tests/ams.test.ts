import { describe, expect, it } from 'vitest';
import {
  parseAmsSnapshot,
  parsePrinterInfo,
  AMS_FRESH_MS,
  type AmsInventory,
} from '../lib/ams';
import {
  freshInventory,
  matchAmsSlot,
  textSpoolCandidates,
} from '../lib/ams-matching';
import { FILAMENTS, PRINTERS } from '../lib/catalog';

const cyan = FILAMENTS.find(
  (row) => row.product === 'PLA Tough+' && row.colorName === 'Cyan',
)!;
export function amsReport() {
  return {
    print: {
      command: 'push_status',
      msg: 0,
      ams: {
        ams_exist_bits: '3',
        tray_exist_bits: '17',
        tray_reading_bits: '0',
        ams: [
          {
            id: '0',
            info: '1',
            tray: [
              {
                id: '0',
                tray_type: 'PLA',
                tray_info_idx: 'GFA10',
                tray_color: '009BD8FF',
                remain: 77,
              },
              {
                id: '1',
                tray_type: 'PLA',
                tray_info_idx: 'GFA00',
                tray_color: '000000FF',
                remain: -1,
              },
              {
                id: '2',
                tray_type: 'PLA',
                tray_info_idx: 'GFA10',
                tray_color: '808080FF',
              },
              {
                id: '3',
                tray_type: 'PLA',
                tray_info_idx: 'GFA00',
                tray_color: 'FFFFFFFF',
              },
            ],
          },
          {
            id: '1',
            info: '3',
            tray: [
              {
                id: '0',
                tray_type: 'PETG',
                tray_info_idx: 'GFG02',
                tray_color: '000000FF',
              },
            ],
          },
        ],
      },
    },
  };
}
function inventory(): AmsInventory {
  return {
    available: true,
    connected: true,
    updatedAt: Date.now(),
    stale: false,
    slots: parseAmsSnapshot(amsReport())!,
    printerName: 'Bambu Lab X2D',
    firmware: null,
    message: '',
  };
}
describe('AMS telemetry and catalog matching', () => {
  it('finds loaded white text for a black body', () => {
    const current = inventory();
    current.slots[3].present = true;
    const black = FILAMENTS.find(
      (row) => row.product === 'PLA Basic' && row.colorName === 'Black',
    )!;
    expect(
      textSpoolCandidates(black, current, 'Bambu Lab X2D').map(
        (item) => item.slot.label,
      ),
    ).toEqual(['A4']);
  });
  it('does not discard invalid palette entries and then claim a solid-color match', () => {
    const report = amsReport();
    Object.assign(report.print.ams.ams[0].tray[0], {
      cols: ['009BD8FF', 'invalid'],
    });
    expect(matchAmsSlot(parseAmsSnapshot(report)![0])).toEqual([]);
  });
  it('handles multiple units, cached empty slots, remaining estimates and independent text profiles', () => {
    const current = inventory();
    expect(current.slots.map((slot) => slot.label)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
    ]);
    expect(current.slots[3].present).toBe(false);
    expect(current.slots[0].remaining).toBe(77);
    expect(current.slots[1].remaining).toBe(null);
    expect(matchAmsSlot(current.slots[0])).toEqual([cyan]);
    expect(matchAmsSlot(current.slots[3])).toEqual([]);
    const text = textSpoolCandidates(cyan, current, 'Bambu Lab X2D');
    expect(text.map((item) => [item.slot.label, item.product])).toEqual([
      ['A2', 'PLA Basic'],
    ]);
  });
  it.each(['1', '2', '3'])(
    'uses reported layout type %s without a hard-coded printer model',
    (info) => {
      const report = amsReport();
      report.print.ams.ams[0].info = info;
      expect(parseAmsSnapshot(report)?.[1].present).toBe(true);
    },
  );
  it('handles HT and mixed Lite presence bits without assuming four slots per unit', () => {
    const report = {
      print: {
        ams: {
          ams_exist_bits: '1010',
          tray_exist_bits: '1010000',
          ams: [
            { id: '128', info: '2004', tray: [{ id: '0', tray_type: 'PLA' }] },
            { id: '200', info: '5', tray: [{ id: '0', tray_type: 'PLA' }] },
          ],
        },
      },
    };
    const result = parseAmsSnapshot(report)!;
    expect(result.map((slot) => slot.present)).toEqual([true, true]);
    expect(result[0].label).toBe('HT 1');
  });
  it('does not guess presence for unknown layouts or absent presence bits', () => {
    const report = amsReport();
    report.print.ams.ams[0].info = 'f';
    expect(parseAmsSnapshot(report)![0].present).toBeNull();
    expect(
      parseAmsSnapshot({
        print: {
          ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA' }] }] },
        },
      })![0].present,
    ).toBeNull();
  });
  it('rejects deltas and malformed arrays rather than merging identity', () => {
    const report = amsReport();
    report.print.msg = 1;
    expect(parseAmsSnapshot(report)).toBeNull();
    expect(
      parseAmsSnapshot({
        print: {
          ams: { ams: [{ id: '0', tray: [{ id: '0' }, { id: '0' }] }] },
        },
      }),
    ).toBeNull();
    expect(
      parseAmsSnapshot({ print: { ams: { ams: Array(100).fill({}) } } }),
    ).toBeNull();
    expect(parseAmsSnapshot({ print: { ams: { ams: [] } } })).toEqual([]);
  });
  it('pauses matching while RFID is reading or metadata is cleared', () => {
    const report = amsReport();
    report.print.ams.tray_reading_bits = '1';
    expect(matchAmsSlot(parseAmsSnapshot(report)![0])).toEqual([]);
    report.print.ams.tray_reading_bits = '0';
    report.print.ams.ams[0].tray[0].tray_type = '';
    expect(matchAmsSlot(parseAmsSnapshot(report)![0])).toEqual([]);
  });
  it('does not guess a SKU from a nearest color or unknown product ID', () => {
    const slot = inventory().slots[0];
    expect(
      matchAmsSlot({ ...slot, color: '#009BD7FF', colors: ['#009BD7FF'] }),
    ).toEqual([]);
    expect(matchAmsSlot({ ...slot, productId: 'custom-profile' })).toEqual([]);
  });
  it('requires opaque solid exact black/white and same base material for text', () => {
    const current = inventory();
    for (const override of [
      { color: '#00000000', colors: ['#00000000'] },
      { color: '#808080FF', colors: ['#808080FF'] },
      { colors: ['#000000FF', '#FFFFFFFF'] },
      { material: 'PETG' },
      { reading: true },
      { present: false },
      { productId: 'custom' },
    ]) {
      expect(
        textSpoolCandidates(
          cyan,
          { ...current, slots: [{ ...current.slots[1], ...override }] },
          'Bambu Lab X2D',
        ),
      ).toEqual([]);
    }
  });
  it('pauses suggestions for stale, future-dated or disconnected data', () => {
    const current = inventory();
    expect(freshInventory(current)).toBe(true);
    for (const override of [
      { stale: true },
      { connected: false },
      { updatedAt: null },
      { updatedAt: Date.now() - AMS_FRESH_MS },
      { updatedAt: Date.now() + 10000 },
    ]) {
      expect(freshInventory({ ...current, ...override })).toBe(false);
      expect(
        textSpoolCandidates(cyan, { ...current, ...override }, 'Bambu Lab X2D'),
      ).toEqual([]);
    }
  });
  it('resolves profiles across catalog printers rather than only X2D', () => {
    for (const printer of PRINTERS) {
      const matches = textSpoolCandidates(cyan, inventory(), printer.fullName);
      for (const match of matches) expect(match.product).toBe('PLA Basic');
    }
    expect(textSpoolCandidates(cyan, inventory(), 'Unknown')).toEqual([]);
  });
  it('only exposes model/firmware from device info, not serials or RFID IDs', () => {
    expect(
      parsePrinterInfo({
        info: {
          module: [
            {
              name: 'ota',
              product_name: 'Bambu Lab X2D',
              sw_ver: '01.02.00.00',
              sn: 'private',
            },
          ],
        },
      }),
    ).toEqual({ printerName: 'Bambu Lab X2D', firmware: '01.02.00.00' });
    const report = amsReport();
    Object.assign(report.print.ams.ams[0].tray[0], {
      tag_uid: 'private',
      tray_uuid: 'private',
      arbitrary: 'private',
    });
    expect(JSON.stringify(parseAmsSnapshot(report))).not.toContain('private');
  });
});
