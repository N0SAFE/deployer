'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Unplug } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { EmptyState } from '@/components/dashboard'
import { useDisconnectMeshPeer, type useMeshSseState } from '@/domains/mesh/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { ConfirmDialog } from '../../_components/confirm-dialog'

type MeshState = NonNullable<ReturnType<typeof useMeshSseState>['state']>

export function SessionsCard({ sessions, loading }: { sessions: MeshState['sessions']; loading: boolean }) {
  const disconnectPeer = useDisconnectMeshPeer()
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)

  const disconnect = async () => {
    if (!pendingSessionId) return
    try {
      await disconnectPeer.mutateAsync({
        params: { sessionId: pendingSessionId },
        body: { allowReconnect: false, reason: 'manual-instance-unlink' },
      })
      toast.success('Peer session disconnect requested')
      setPendingSessionId(null)
    } catch (error) {
      toast.error(`Failed to disconnect peer: ${isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown mesh disconnect error'}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Linked instances (sessions)</CardTitle>
        <CardDescription>Transport sessions backing each instance link. Disconnecting one unlinks that instance.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : sessions.length === 0 ? (
          <EmptyState compact icon={Unplug} title="No sessions yet" description="Sessions appear once an instance is linked." />
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.sessionId} className="space-y-2 rounded border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{session.peerNodeId ? session.peerNodeId.slice(0, 8) : 'pending'} · {session.state}</p>
                    <p className="break-all font-mono text-xs text-muted-foreground">{session.endpointUrl}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2" disabled={disconnectPeer.isPending} onClick={() => { setPendingSessionId(session.sessionId) }}>
                    <Unplug className="size-3.5" />
                    Disconnect
                  </Button>
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground">session: {session.sessionId}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingSessionId !== null}
        onOpenChange={(open) => { if (!open) setPendingSessionId(null) }}
        title="Disconnect this instance?"
        description="The session is closed and will not reconnect automatically. Link the instance again to restore it."
        confirmLabel="Disconnect"
        pending={disconnectPeer.isPending}
        onConfirm={() => { void disconnect() }}
      />
    </Card>
  )
}
