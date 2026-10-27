'use client'

import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'
import { RefreshCw } from 'lucide-react'
import { DockerContainerDetailModalTrigger } from '../../_components/container-detail-modal'
import type { DockerContainer } from '@deployer/contracts-entities'

function errorReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The log stream closed without a reason.'
}

/** Names exactly which container on which node is being read, and how much is buffered. */
export function LogsTargetLine({
  container,
  nodeName,
  lineCount,
  bufferLimit,
  connecting,
}: {
  container: Pick<DockerContainer, 'id' | 'name' | 'status'>
  nodeName: string
  lineCount: number
  bufferLimit: number
  connecting: boolean
}) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {connecting ? 'Connecting to' : 'Streaming'}{' '}
      <DockerContainerDetailModalTrigger id={container.id} className="font-mono text-foreground underline-offset-4 hover:underline">
        {container.name}
      </DockerContainerDetailModalTrigger>{' '}
      <span>({container.status}) on {nodeName}</span>
      {' · '}
      <span className="tabular-nums">{lineCount.toLocaleString('en-US')} lines</span>
      <span className="text-xs"> (keeps the latest {bufferLimit.toLocaleString('en-US')})</span>
    </p>
  )
}

/** Shown while the stream is down. Buffered lines stay on screen underneath. */
export function LogsDisconnectedBanner({ error, onReconnect }: { error: unknown; onReconnect: () => void }) {
  return (
    <Alert variant="destructive" role="status">
      <AlertTitle>Stream disconnected — reconnecting…</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          Lines already received are kept; once the stream is back, missed lines are filled in without duplicates.
          Reason: <span className="font-mono text-xs">{errorReason(error)}</span>
        </p>
        <Button size="sm" variant="outline" onClick={onReconnect}>
          <RefreshCw className="size-3.5" />
          Reconnect now
        </Button>
      </AlertDescription>
    </Alert>
  )
}
