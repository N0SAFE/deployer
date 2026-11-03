'use client'

import { Check, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'

import { PageErrorState, PageHeader } from '@/components/dashboard'
import { useDecideApproval, usePendingApprovals } from '@/domains/approvals/hooks'
import { useCan } from '@/lib/access/permissions'
import { getErrorMessage } from '@/lib/orpc/typed-errors'

/**
 * Settings → Approvals (`SEC-072`).
 *
 * A request is consent for ONE exact action: the digest shown here is what the guard checks, so approving it cannot be
 * replayed for a different resource. Deciding needs `approval:approve` and a fresh passkey proof; the API refuses your
 * own requests, so a self-approval never reaches this page.
 */
export default function SettingsApprovalsPage() {
  const canRead = useCan('approval:read')
  const canApprove = useCan('approval:approve')
  const query = usePendingApprovals({ enabled: canRead })
  const decide = useDecideApproval()
  const rows = query.data?.data ?? []

  if (!canRead) {
    return (
      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>Not for this account</AlertTitle>
        <AlertDescription>
          Seeing approval requests needs the <code>approval:read</code> capability.
        </AlertDescription>
      </Alert>
    )
  }

  const act = (id: string, decision: 'approve' | 'deny') => {
    decide.mutate(
      { params: { id }, body: { decision } },
      {
        onSuccess: () => {
          toast.success(decision === 'approve' ? 'Approved' : 'Denied')
          void query.refetch()
        },
        onError: (error) => {
          toast.error(getErrorMessage(error))
        },
      },
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Approvals"
        description="Actions somebody could not do alone, waiting for a second person. An approval is bound to the exact action shown; it is single-use and expires on its own."
        badge={<Badge variant="secondary">{rows.length} pending</Badge>}
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh approvals"
          >
            <RefreshCw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      {query.isError ? (
        <PageErrorState
          title="Could not read the approval queue"
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Pending</CardTitle>
            <CardDescription>
              {canApprove
                ? 'Approving asks for a passkey tap within five minutes. Denying needs none.'
                : 'You can see the queue, but deciding needs approval:approve.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading ? (
              Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Nothing is waiting.</p>
            ) : (
              rows.map((request) => (
                <div key={request.id} className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono">{request.permission}</span>
                      <span className="text-muted-foreground text-xs">
                        asked by {request.requesterName ?? request.requesterId}
                      </span>
                      <Badge variant="outline">
                        {request.approvals} of {request.requiredApprovals}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        expires {new Date(String(request.expiresAt)).toLocaleString()}
                      </span>
                    </p>
                    <p className="text-sm">{request.reason}</p>
                    <p className="text-muted-foreground truncate font-mono text-xs" title={request.actionHash}>
                      {request.actionHash}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canApprove || decide.isPending}
                      onClick={() => { act(request.id, 'deny') }}
                    >
                      <X className="size-4" />
                      Deny
                    </Button>
                    <Button
                      size="sm"
                      disabled={!canApprove || decide.isPending}
                      onClick={() => { act(request.id, 'approve') }}
                    >
                      <Check className="size-4" />
                      Approve
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
