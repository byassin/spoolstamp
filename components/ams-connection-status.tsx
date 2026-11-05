import type { HostedCloudState } from '@/lib/cloud-ams';
import { connectionStatus } from '@/lib/ams-freshness';

export function AmsConnectionStatus({
  state,
  printer,
  now,
  hasLabelChoices = false,
}: {
  state: HostedCloudState;
  printer: string;
  now: number;
  hasLabelChoices?: boolean;
}) {
  const status = connectionStatus(state, printer, now, hasLabelChoices);
  return (
    <div className="ams-connection-status" data-state={status.kind}>
      <output>{status.title}</output>
      <p>{status.detail}</p>
    </div>
  );
}
