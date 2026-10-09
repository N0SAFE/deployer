import { StatusBadge } from '@/components/dashboard'
import type { IntegrationStatus } from '../_lib/provider-status'

/** Badge + one sentence of evidence, so a status is never colour-only or unexplained. */
export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  return (
    <StatusBadge status={status.status} title={status.detail} className="normal-case">
      {status.label}
    </StatusBadge>
  )
}
