'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { EmptyState } from '@/components/dashboard'
import { useFleetAdmissionRequests, useResolveFleetAdmissionRequest, type useFleetServers } from '@/domains/fleet/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { formatDateTime } from '@/lib/format/date'
import { ConfirmDialog } from '../../_components/confirm-dialog'
import { formatMemory } from './capacity-format'

type FleetServer = NonNullable<ReturnType<typeof useFleetServers>['data']>['items'][number]
type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

/**
 * Nodes asking to join the capacity pool. Approving one grants an allocation;
 * rejecting is confirmed first because the node has to ask again.
 */
export function AdmissionsPanel({ servers }: { servers: readonly FleetServer[] }) {
  const [status, setStatus] = useState<RequestStatus>('pending')
  const [reviewerNote, setReviewerNote] = useState('')
  const [placementNodeId, setPlacementNodeId] = useState('')
  const [pendingRejection, setPendingRejection] = useState<string | null>(null)
  const { data, isLoading } = useFleetAdmissionRequests({ status })
  const resolve = useResolveFleetAdmissionRequest()
  const requests = data?.items ?? []

  const decide = async (requestId: string, decision: 'approved' | 'rejected') => {
    try {
      await resolve.mutateAsync({
        requestId,
        decision,
        reviewerNote: reviewerNote.trim() === '' ? null : reviewerNote.trim(),
        decisionServerNodeId: placementNodeId === '' ? null : placementNodeId,
      })
      toast.success(`Admission request ${decision}`)
      setPendingRejection(null)
    } catch (error) {
      toast.error(`Failed to resolve admission request: ${isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Admission requests</CardTitle>
        <CardDescription>
          Requests from nodes asking to join this cluster&apos;s capacity pool. Approving one grants it an allocation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="admission-status" className="text-xs text-muted-foreground">Show requests</Label>
            <select
              id="admission-status"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => { setStatus(event.target.value as RequestStatus) }}
            >
              <option value="pending">Awaiting a decision</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="admission-node" className="text-xs text-muted-foreground">Place on node (optional)</Label>
            <select
              id="admission-node"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={placementNodeId}
              onChange={(event) => { setPlacementNodeId(event.target.value) }}
            >
              <option value="">Let the platform choose</option>
              {servers.map((server) => (
                <option key={server.nodeId} value={server.nodeId}>{server.displayName ?? server.nodeId.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="admission-note" className="text-xs text-muted-foreground">Reviewer note (optional)</Label>
            <Input id="admission-note" className="h-10" value={reviewerNote} onChange={(e) => { setReviewerNote(e.target.value) }} />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading requests…</p>
        ) : requests.length === 0 ? (
          status === 'pending' ? (
            <EmptyState compact icon={CheckCircle2} title="Nothing awaiting approval" description="New admission requests appear here for review." />
          ) : (
            <EmptyState
              compact
              icon={CheckCircle2}
              title={`No ${status} requests`}
              action={{ label: 'Show requests awaiting a decision', onClick: () => { setStatus('pending') } }}
            />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Node scope</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="tabular-nums">
                    {request.requestedCpuMillicores}m · {formatMemory(request.requestedMemoryMb)} · {request.requestedServices} svc
                  </TableCell>
                  <TableCell className="font-mono text-xs">{request.requestedServerNodeId ?? 'any node'}</TableCell>
                  <TableCell>
                    <Badge variant={request.status === 'pending' ? 'default' : request.status === 'approved' ? 'secondary' : 'destructive'}>
                      {request.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(request.createdAt)}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    {request.status === 'pending' ? (
                      <>
                        <Button type="button" size="sm" disabled={resolve.isPending} onClick={() => { void decide(request.id, 'approved') }}>
                          Approve
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={resolve.isPending} onClick={() => { setPendingRejection(request.id) }}>
                          Reject
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Resolved</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingRejection !== null}
        onOpenChange={(open) => { if (!open) setPendingRejection(null) }}
        title="Reject this admission request?"
        description="The node will not be admitted to the capacity pool and has to request again to be reconsidered."
        confirmLabel="Reject request"
        pending={resolve.isPending}
        onConfirm={() => { if (pendingRejection) void decide(pendingRejection, 'rejected') }}
      />
    </Card>
  )
}
