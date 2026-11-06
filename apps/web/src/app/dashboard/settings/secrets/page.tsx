'use client'

import { ShieldAlert } from 'lucide-react'

import {
    Alert,
    AlertDescription,
    AlertTitle,
} from '@deployer/ui/components/shadcn/alert'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
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
import { useSecretInventory } from '@/domains/secrets/hooks'
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
    const query = useSecretInventory({ enabled: canRead })

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

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Settings"
                title="Secrets"
                description="Where each secret is held across the fleet, by fingerprint. A value is never shown here. Each node generates its secrets on first boot and receives the fleet's when it joins."
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
                                </CardTitle>
                                <CardDescription>
                                    {described?.purpose}
                                    {described !== undefined &&
                                    described.consumers.length > 0
                                        ? ` Read by: ${described.consumers.join(', ')}.`
                                        : ''}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Node</TableHead>
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
                                                    <TableCell colSpan={2}>
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
        </div>
    )
}
