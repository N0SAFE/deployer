import type { DockerContainer } from '@deployer/contracts-entities'
import { Badge } from '@deployer/ui/components/shadcn/badge'

type Variant = 'default' | 'secondary' | 'destructive' | 'outline'

const STATUS_VARIANT: Record<DockerContainer['status'], Variant> = {
  running: 'default',
  paused: 'secondary',
  restarting: 'secondary',
  created: 'outline',
  exited: 'destructive',
  dead: 'destructive',
  unknown: 'outline',
}

/** Container state as text plus colour, with the health check appended when there is one. */
export function ContainerStatusBadges({ status, health }: { status: DockerContainer['status']; health: DockerContainer['health'] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={STATUS_VARIANT[status]} className="capitalize">{status}</Badge>
      {health !== 'none' ? (
        <Badge variant={health === 'unhealthy' ? 'destructive' : 'outline'} className="capitalize">{health}</Badge>
      ) : null}
    </span>
  )
}
