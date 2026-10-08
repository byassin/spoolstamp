import type { AmsInventory } from './ams';

/** Browser-safe contract. No provider tokens, codes, email, or raw telemetry. */
export type HostedCloudPrinter = {
  serial: string;
  name: string;
  model: string;
  online: boolean;
};
export type HostedCloudState = {
  csrf: string;
  authenticated: boolean;
  codeRequested: boolean;
  expiresAt: number;
  printers: HostedCloudPrinter[];
  selectedSerial: string | null;
  pending: boolean;
  refreshAfter: number;
  inventory: AmsInventory;
};
