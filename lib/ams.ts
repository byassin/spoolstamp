/** Public, sanitized inventory contract. Never contains access codes or tag UUIDs. */
export const AMS_PATH = '/__local/ams';
export const AMS_HEADER = 'X-AMS-Request';
export const AMS_FRESH_MS = 45_000;
export const AMS_INITIAL_WAIT_MS = 60_000;
export type AmsDiagnostics = {
  requestsSent: number;
  messagesReceived: number;
  retainedMessages: number;
  invalidMessages: number;
  reportsReceived: number;
  incompleteAmsReports: number;
  fullSnapshots: number;
};
export const emptyAmsDiagnostics = (): AmsDiagnostics => ({
  requestsSent: 0,
  messagesReceived: 0,
  retainedMessages: 0,
  invalidMessages: 0,
  reportsReceived: 0,
  incompleteAmsReports: 0,
  fullSnapshots: 0,
});
export type AmsSlot = {
  key: string;
  unit: string;
  slot: string;
  label: string;
  present: boolean | null;
  reading: boolean;
  material: string;
  productId: string;
  color: string | null;
  colors: string[];
  remaining: number | null;
};
export type AmsInventory = {
  available: boolean;
  connected: boolean;
  printerName: string | null;
  firmware: string | null;
  updatedAt: number | null;
  stale: boolean;
  slots: AmsSlot[];
  message: string;
  diagnostics?: AmsDiagnostics;
};
export type AmsProbe = {
  token: string;
  fingerprint: string;
  expiresAt: number;
};

export const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const shortString = (value: unknown) =>
  typeof value === 'string' && value.length <= 100 ? value : '';
const index = (value: unknown) =>
  typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : -1;
const bits = (value: unknown) =>
  typeof value === 'string' && /^[\da-f]{1,16}$/i.test(value)
    ? BigInt(`0x${value}`)
    : null;
const bit = (mask: bigint | null, at: number) =>
  mask === null || at < 0 || at > 63
    ? null
    : !!(mask & (BigInt(1) << BigInt(at)));
const rgba = (value: unknown) =>
  typeof value === 'string' && /^[\da-f]{8}$/i.test(value)
    ? `#${value.toUpperCase()}`
    : null;

/** Full snapshots only: never merge cached spool identity into a replacement spool. */
export function parseAmsSnapshot(report: unknown): AmsSlot[] | null {
  const print = object(object(report)?.print);
  const ams = object(print?.ams);
  if (
    !ams ||
    print?.msg === 1 ||
    !Array.isArray(ams.ams) ||
    ams.ams.length > 16
  )
    return null;
  const presentMask = bits(ams.tray_exist_bits);
  const unitMask = bits(ams.ams_exist_bits);
  const readingMask = bits(ams.tray_reading_bits);
  const slots: AmsSlot[] = [];
  const keys = new Set<string>();
  for (const rawUnit of ams.ams) {
    const unit = object(rawUnit);
    const unitId = index(unit?.id);
    if (
      !unit ||
      unitId < 0 ||
      !Array.isArray(unit.tray) ||
      unit.tray.length > 8
    )
      return null;
    // Official DevAms::GetTrayId / ParseAmsInfo: legacy, AMS Lite, AMS 2 Pro,
    // AMS HT, mixed Lite. Unknown types retain unknown presence, never guess.
    const info = bits(unit.info);
    const type =
      info === null && unit.info === undefined
        ? 1
        : Number((info ?? BigInt(0)) & BigInt(15));
    const ordinary = [1, 2, 3].includes(type) && unitId < 4;
    const ht = type === 4 && unitId >= 128 && unitId < 136;
    const mixed = type === 5;
    const unitBit = ordinary ? unitId : ht ? 4 + unitId - 128 : mixed ? 12 : -1;
    const exists = bit(unitMask, unitBit);
    for (const rawTray of unit.tray) {
      const tray = object(rawTray);
      const slotId = index(tray?.id);
      if (!tray || slotId < 0) return null;
      const flat =
        ordinary && slotId < 4
          ? unitId * 4 + slotId
          : ht && slotId === 0
            ? 16 + unitId - 128
            : mixed && slotId < 4
              ? 24 + slotId
              : -1;
      const key = `${unitId}:${slotId}`;
      if (keys.has(key)) return null;
      keys.add(key);
      const color = rgba(tray.tray_color);
      const palette =
        Array.isArray(tray.cols) && tray.cols.length <= 8
          ? tray.cols.map(rgba)
          : null;
      const colors =
        tray.cols === undefined || (palette && !palette.length)
          ? color
            ? [color]
            : []
          : palette && palette.every((item): item is string => item !== null)
            ? palette
            : [];
      slots.push({
        key,
        unit: String(unitId),
        slot: String(slotId),
        label: ordinary
          ? `${String.fromCharCode(65 + unitId)}${slotId + 1}`
          : ht
            ? `HT ${unitId - 127}`
            : `Unit ${unitId} · ${slotId + 1}`,
        present: exists === false ? false : bit(presentMask, flat),
        reading:
          bit(readingMask, flat) === true ||
          (typeof tray.state === 'number' && (tray.state & 0x14) !== 0),
        material: shortString(tray.tray_type),
        productId: shortString(tray.tray_info_idx),
        color,
        colors,
        remaining:
          typeof tray.remain === 'number' &&
          tray.remain >= 0 &&
          tray.remain <= 100
            ? tray.remain
            : null,
      });
    }
  }
  return slots;
}

export function parsePrinterInfo(report: unknown) {
  const info = object(object(report)?.info);
  if (!Array.isArray(info?.module)) return null;
  const ota = info.module.map(object).find((item) => item?.name === 'ota');
  if (!ota) return null;
  return {
    printerName: shortString(ota.product_name) || null,
    firmware: shortString(ota.sw_ver) || null,
  };
}
