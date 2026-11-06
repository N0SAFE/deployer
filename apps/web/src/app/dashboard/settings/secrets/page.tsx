'use client'

import { RefreshCw, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
    Alert,
    AlertDescription,
    AlertTitle,
} from '@deployer/ui/components/shadcn/alert'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@deployer/ui/components/shadcn/dialog'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@deployer/ui/components/shadcn/table'

import { PageErrorState, PageHeader } from '@/components/dashboard'
import {
    useRetirePlatformSecret,
    useRotatePlatformSecret,
    useSecretInventory,
    useStoredSecrets,
} from '@/domains/secrets/hooks'
import { useCan } from '@/lib/access/permissions'
import { getErrorMessage } from '@/lib/orpc/typed-errors'

type Status = 'current' | 'stale' | 'missing'

const STATUS_LABEL: Record<Status, string> = {
    current: 'Up to date',
    stale: 'Differs',
    missing: 'None held',
}

const STATUS_VARIANT: Record<Status, 'secondary' | 'destructive' | 'outline'> =
    {
        current: 'secondary',
        stale: 'destructive',
        missing: 'outline',
    }

/**
 * Settings → Secrets.
 *
 * Which node holds which secret, by fingerprint (never the value), what reads it, and which nodes are not on the value most
 * nodes hold. `platform.secret:read` is the capability the API checks, so the page cannot open for someone the API would
 * refuse.
 */
export default function SettingsSecretsPage() {
    const canRead = useCan('platform.secret:read')
    const canRotate = useCan('platform.secret:rotate')
    const canRetire = useCan('platform.secret:retire')
    const query = useSecretInventory({ enabled: canRead })
    const rotate = useRotatePlatformSecret()
    const retire = useRetirePlatformSecret()
    // What the operator is about to do, held until they confirm: both acts change what the whole fleet accepts.
    const [confirming, setConfirming] = useState<
        { kind: 'rotate' } | { kind: 'retire'; generation: number } | null
    >(null)
    // Read only while a retirement is being confirmed: it counts every encrypted column in the database.
    const stored = useStoredSecrets({
        enabled: canRetire && confirming?.kind === 'retire',
    })
    /** How many stored values are still sealed under a key generation (zero when it is not in the count at all). */
    const rowsUnder = (generation: number): number => {
        const totals: Partial<Record<string, number>> | undefined =
            stored.data?.totals
        return totals?.[`column:${String(generation)}`] ?? 0
    }

    if (!canRead) {
        return (
            <Alert>
                <ShieldAlert className="size-4" />
                <AlertTitle>Not for this account</AlertTitle>
                <AlertDescription>
                    Seeing where the platform&apos;s secrets are held needs the{' '}
                    <code>platform.secret:read</code> capability.
                </AlertDescription>
            </Alert>
        )
    }

    if (query.isError) {
        return (
            <PageErrorState
                title="Could not list the secrets"
                message={getErrorMessage(query.error)}
                onRetry={() => void query.refetch()}
            />
        )
    }

    const inventory = query.data
    const behind =
        inventory?.adoption.flatMap((entry) =>
            entry.nodes.filter((node) => node.status !== 'current')
        ).length ?? 0

    const confirm = async () => {
        if (confirming === null) return
        try {
            if (confirming.kind === 'rotate') {
                const result = await rotate.mutateAsync({})
                toast.success(
                    `Generation ${String(result.generation)} is current. Nodes take it in on their next round.`
                )
            } else {
                const result = await retire.mutateAsync({
                    generation: confirming.generation,
                })
                toast.success(
                    `Generation ${String(confirming.generation)} retired on ${String(result.reached.length + 1)} node(s)${
                        result.unreachable.length === 0
                            ? ''
                            : `; not reached: ${result.unreachable.join(', ')}`
                    }`
                )
            }
            setConfirming(null)
        } catch (error) {
            toast.error(getErrorMessage(error))
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Settings"
                title="Secrets"
                description="Where each secret is held across the fleet, by fingerprint. A value is never shown here. Each node generates its secrets on first boot and receives the fleet's when it joins."
                actions={
                    canRotate ? (
                        <Button
                            variant="outline"
                            onClick={() => {
                                setConfirming({ kind: 'rotate' })
                            }}
                        >
                            <RefreshCw className="mr-2 size-4" />
                            Rotate platform secret
                        </Button>
                    ) : undefined
                }
                badge={
                    inventory === undefined ? undefined : (
                        <Badge variant={behind === 0 ? 'secondary' : 'destructive'}>
                            {behind === 0
                                ? 'All nodes agree'
                                : `${String(behind)} to check`}
                        </Badge>
                    )
                }
            />

            {inventory === undefined ? (
                <Skeleton className="h-48 w-full" />
            ) : (
                inventory.adoption.map((entry) => {
                    const described = inventory.nodes
                        .flatMap((node) => node.secrets)
                        .find((secret) => secret.id === entry.id)
                    return (
                        <Card key={entry.id}>
                            <CardHeader>
                                <CardTitle className="capitalize">
                                    {entry.id} secret
                                    {entry.currentGeneration === null
                                        ? ''
                                        : ` · generation ${String(entry.currentGeneration)}`}
                                </CardTitle>
                                <CardDescription>
                                    {described?.purpose}
                                    {described !== undefined &&
                                    described.consumers.length > 0
                                        ? ` Read by: ${described.consumers.join(', ')}.`
                                        : ''}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {entry.id === 'platform' && canRetire
                                    ? (() => {
                                          const earlier = [
                                              ...new Set(
                                                  inventory.nodes.flatMap(
                                                      (node) =>
                                                          node.secrets
                                                              .filter(
                                                                  (secret) =>
                                                                      secret.id ===
                                                                      'platform'
                                                              )
                                                              .flatMap(
                                                                  (secret) =>
                                                                      secret.earlierGenerations
                                                              )
                                                  )
                                              ),
                                          ].sort((a, b) => b - a)
                                          return earlier.length === 0 ? null : (
                                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                                  <span className="text-muted-foreground">
                                                      Still accepted:
                                                  </span>
                                                  {earlier.map((generation) => (
                                                      <Button
                                                          key={generation}
                                                          size="sm"
                                                          variant="outline"
                                                          onClick={() => {
                                                              setConfirming({
                                                                  kind: 'retire',
                                                                  generation,
                                                              })
                                                          }}
                                                      >
                                                          Retire generation{' '}
                                                          {generation}
                                                      </Button>
                                                  ))}
                                              </div>
                                          )
                                      })()
                                    : null}
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Node</TableHead>
                                            <TableHead>Generation</TableHead>
                                            <TableHead>Fingerprint</TableHead>
                                            <TableHead>Adopted</TableHead>
                                            <TableHead>State</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {entry.nodes.map((node) => (
                                            <TableRow key={node.nodeId}>
                                                <TableCell className="font-mono text-xs">
                                                    {node.nodeId}
                                                </TableCell>
                                                <TableCell>
                                                    {node.generation ?? '—'}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    {node.fingerprint ?? '—'}
                                                </TableCell>
                                                <TableCell>
                                                    {node.adoptedAt === null
                                                        ? '—'
                                                        : new Date(
                                                              node.adoptedAt
                                                          ).toLocaleString()}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={
                                                            STATUS_VARIANT[
                                                                node.status
                                                            ]
                                                        }
                                                    >
                                                        {
                                                            STATUS_LABEL[
                                                                node.status
                                                            ]
                                                        }
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {inventory.nodes
                                            .filter((node) => !node.reachable)
                                            .map((node) => (
                                                <TableRow key={node.nodeId}>
                                                    <TableCell className="font-mono text-xs">
                                                        {node.nodeId}
                                                    </TableCell>
                                                    <TableCell colSpan={3}>
                                                        Did not answer
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline">
                                                            Unreachable
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )
                })
            )}

            <Dialog
                open={confirming !== null}
                onOpenChange={(open) => {
                    if (!open) setConfirming(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {confirming?.kind === 'retire'
                                ? `Retire generation ${String(confirming.generation)}?`
                                : 'Rotate the platform secret?'}
                        </DialogTitle>
                        {confirming?.kind === 'retire' ? (
                            <p className="text-sm">
                                {stored.isPending
                                    ? 'Counting the stored values…'
                                    : stored.isError
                                      ? 'The stored values could not be counted, so this cannot be retired now.'
                                      : (() => {
                                            const left = rowsUnder(
                                                confirming.generation
                                            )
                                            return left === 0
                                                ? `No stored value is sealed under generation ${String(confirming.generation)}.`
                                                : `${String(left)} stored value(s) are still sealed under generation ${String(confirming.generation)}. Rewrite them first: reseal-secrets --to-current --apply.`
                                        })()}
                            </p>
                        ) : null}
                        <DialogDescription>
                            {confirming?.kind === 'retire'
                                ? 'Values sealed under this generation, and sessions and claims signed with it, stop being accepted on every node. Do this only once every node holds the current generation and the stored credentials have been resealed. A passkey verification in the last five minutes is required (Settings → Account).'
                                : 'A new generation becomes current and every node takes it in on its next round. The current one stays accepted, so nothing is cut off. Better Auth picks it up at its next restart. A passkey verification in the last five minutes is required (Settings → Account).'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setConfirming(null)
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant={
                                confirming?.kind === 'retire'
                                    ? 'destructive'
                                    : 'default'
                            }
                            disabled={
                                rotate.isPending ||
                                retire.isPending ||
                                (confirming?.kind === 'retire' &&
                                    (stored.isPending ||
                                        stored.isError ||
                                        rowsUnder(confirming.generation) > 0))
                            }
                            onClick={() => void confirm()}
                        >
                            {confirming?.kind === 'retire'
                                ? 'Retire'
                                : 'Rotate'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
