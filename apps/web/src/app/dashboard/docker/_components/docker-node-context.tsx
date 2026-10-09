'use client'

import { Button } from '@repo/ui/components/shadcn/button'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { useFleetServers } from '@/domains/fleet/hooks'
import { useNodeScope } from '@/domains/node/node-context'
import { ScopeLabel } from '@/components/dashboard'
import { shortId } from '../_utils/format'

/**
 * The Docker engine this section talks to is always the engine of the node that
 * hosts the API you are connected to (the docker contracts take no node id).
 * These helpers make that explicit on every page and warn when the header's node
 * scope points somewhere else, instead of silently showing the wrong node's data.
 */
export function useDockerNode(): {
  nodeId: string | undefined
  nodeName: string
  selectedNodeId: string | null
  scopeMismatch: boolean
  selectLocalNode: () => void
} {
  const { nodeId: selectedNodeId, localNodeId, setNodeId } = useNodeScope()
  const { data } = useFleetServers()
  const server = (data?.items ?? []).find((item) => item.nodeId === localNodeId)
  const nodeName = server?.displayName ?? (localNodeId ? `this node (${shortId(localNodeId, 8)})` : 'this node')
  return {
    nodeId: localNodeId,
    nodeName,
    selectedNodeId,
    scopeMismatch: selectedNodeId !== null && localNodeId !== undefined && selectedNodeId !== localNodeId,
    selectLocalNode: () => { setNodeId(localNodeId ?? null) },
  }
}

/** "Node · <name>" chip for page headers. */
export function DockerNodeBadge() {
  const { nodeName } = useDockerNode()
  return <ScopeLabel scope="node" nodeName={nodeName} />
}

/** Shown when the header's node picker selects a node other than the one Docker reads from. */
export function DockerScopeNotice() {
  const { scopeMismatch, nodeName, selectLocalNode } = useDockerNode()
  if (!scopeMismatch) return null
  return (
    <Alert role="status">
      <AlertTitle>The node picker is on a different node</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          Node engine always shows the Docker engine of {nodeName}, the node serving this dashboard. It
          cannot yet browse another node&apos;s containers, so what you see below is not the node selected in the header.
        </p>
        <Button size="sm" variant="outline" onClick={selectLocalNode}>Switch scope to {nodeName}</Button>
      </AlertDescription>
    </Alert>
  )
}
