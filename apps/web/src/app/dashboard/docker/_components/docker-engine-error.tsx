'use client'

import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { RefreshCw } from 'lucide-react'
import { AuthDashboardNodes } from '@/routes'
import { useDockerNode } from './docker-node-context'

function reason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'The request failed without a message.'
}

/**
 * Error state for a Docker query: names the node, shows the reason, offers retry
 * and a link to Nodes where reachability is diagnosed.
 */
export function DockerEngineError({ what, error, onRetry, isRetrying = false }: {
  what: string
  error: unknown
  onRetry?: () => void
  isRetrying?: boolean
}) {
  const { nodeName } = useDockerNode()
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load {what} from {nodeName}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          The Docker engine on this node may be stopped or unreachable. Reason: <span className="font-mono text-xs">{reason(error)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={isRetrying}>
              <RefreshCw className="size-3.5" />
              {isRetrying ? 'Retrying…' : 'Retry'}
            </Button>
          ) : null}
          <AuthDashboardNodes.Link className="text-sm font-medium underline">Check this node in Nodes</AuthDashboardNodes.Link>
        </div>
      </AlertDescription>
    </Alert>
  )
}
