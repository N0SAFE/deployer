import { StatusBadge } from '@/components/dashboard'
import type { ContainerRow } from '../_models/container-list.model'

/** Container state (text + colour + icon) with its health check when one is configured. */
export function ContainerStatusCell({ row }: { row: Pick<ContainerRow, 'status' | 'health'> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={row.status} />
      {row.health !== 'none' ? (
        <StatusBadge status={row.health} showDot={false} title={`Health check: ${row.health}`}>
          {row.health === 'starting' ? 'Health check starting' : `Health check ${row.health}`}
        </StatusBadge>
      ) : null}
    </div>
  )
}
