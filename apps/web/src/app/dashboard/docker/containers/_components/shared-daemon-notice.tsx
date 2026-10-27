'use client'

import { useMemo } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { TriangleAlert } from 'lucide-react'
import { useDockerContainerGroupedList } from '@/domains/docker/hooks'
import { DockerCopyableId } from '../../_components/docker-copy-button'
import { shortId } from '../../_utils/format'
import type { ContainerListQuery } from '../_models/container-list.model'

const BASE_QUERY = { limit: 100, offset: 0 } as const

/**
 * Warns when several nodes report the same Docker engine (the grouped endpoint detects
 * it), because the same container may then be listed once per node.
 */
export function SharedDaemonNotice({ ownership }: { ownership: ContainerListQuery['ownership'] }) {
  const input = useMemo(() => ({
    query: ownership === 'all'
      ? BASE_QUERY
      : { ...BASE_QUERY, filter: { managedBy: { operator: 'eq' as const, value: ownership } } },
  }), [ownership])
  const diagnostics = useDockerContainerGroupedList(input).data?.diagnostics
  if (!diagnostics?.hasSharedDaemonAcrossNodes) return null

  return (
    <Alert role="status" className="rounded-none border-x-0 border-t-0">
      <TriangleAlert />
      <AlertTitle>Several nodes share one Docker engine</AlertTitle>
      <AlertDescription className="space-y-1">
        <p>Containers on a shared engine can appear once per node. Engine / nodes:</p>
        <ul className="space-y-1">
          {diagnostics.sharedDaemonGroups.map((group) => (
            <li key={group.daemonId} className="flex flex-wrap items-center gap-1">
              <DockerCopyableId value={group.daemonId} short={shortId(group.daemonId, 8)} label="engine ID" />
              <span aria-hidden>→</span>
              {group.nodeIds.map((nodeId) => (
                <DockerCopyableId key={nodeId} value={nodeId} short={shortId(nodeId, 8)} label="node ID" />
              ))}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
