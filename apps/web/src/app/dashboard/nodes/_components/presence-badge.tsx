import { Badge } from '@deployer/ui/components/shadcn/badge'
import { StatusBadge } from '@/components/dashboard'
import type { NodePresence } from '../_utils/node-presence'

const HINT: Record<NodePresence, string> = {
  'this-node': 'The node serving this dashboard.',
  online: 'Connected to the mesh, or reported in the last 5 minutes.',
  stale: 'Not connected, last reported within the last 24 hours — probably restarting or partitioned.',
  offline: 'Not connected and silent for over 24 hours, or revoked. It is only a row in the registry.',
}

/** Presence as colour + icon + text; the registry `status` is shown separately and never as health. */
export function PresenceBadge({ presence }: { presence: NodePresence }) {
  return (
    <span title={HINT[presence]}>
      {presence === 'this-node' ? (
        <Badge className="gap-1 bg-primary/10 font-normal text-primary">This node</Badge>
      ) : presence === 'online' ? (
        <StatusBadge status="connected">Online</StatusBadge>
      ) : presence === 'stale' ? (
        <StatusBadge status="degraded">Stale</StatusBadge>
      ) : (
        <StatusBadge status="inactive">Offline</StatusBadge>
      )}
    </span>
  )
}
