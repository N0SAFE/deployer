'use client'

import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'

import { useCreateMeshJoinToken } from '@/domains/mesh/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'

/** Adds a node: issue a token here, redeem it on the new node. Nothing is configured on the new node beforehand. */
export function JoinTokenCard() {
  const issue = useCreateMeshJoinToken()

  const run = async () => {
    try {
      await issue.mutateAsync({ ttlMs: 60 * 60 * 1000 })
    } catch (error) {
      toast.error(`Unable to issue a join token: ${isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a node</CardTitle>
        <CardDescription>
          Issue a token and redeem it on the new node. It carries the swarm&apos;s credential, so it is shown once and valid for an hour.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" variant="outline" disabled={issue.isPending} onClick={() => { void run() }}>
          {issue.isPending ? 'Issuing…' : 'Issue a join token'}
        </Button>
        {issue.data ? (
          <div className="space-y-1 rounded border p-2 text-xs">
            <p className="break-all font-mono">{issue.data.token}</p>
            <p className="text-muted-foreground">Expires {new Date(issue.data.expiresAt).toLocaleString()}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
