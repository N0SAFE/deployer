'use client'

import { Waypoints } from 'lucide-react'

import type { NodeAgentReplica } from '@deployer/contracts-entities'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'

import { EmptyState } from '@/components/dashboard'

/** The replicas the directory holds: which service runs where, how loaded it is, and how many resources it announces. */
export function ReplicasCard({
    replicas,
    loading,
}: {
    replicas: readonly NodeAgentReplica[]
    loading: boolean
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Replicas</CardTitle>
                <CardDescription>
                    What the services of the swarm announce to their agents.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-24 w-full" />
                ) : replicas.length === 0 ? (
                    <EmptyState
                        compact
                        icon={Waypoints}
                        title="No replicas yet"
                        description="Replicas appear once a service on a node with an agent announces itself."
                    />
                ) : (
                    <div className="space-y-2">
                        {replicas.map((replica) => (
                            <div
                                key={replica.replicaId}
                                className="space-y-1 rounded border p-3"
                            >
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold">
                                        {replica.service}
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        load {(replica.load * 100).toFixed(0)}%
                                    </p>
                                </div>
                                <p className="text-muted-foreground font-mono text-xs break-all">
                                    {replica.replicaId} ·{' '}
                                    {replica.nodeId.slice(0, 13)}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                    {replica.keys.length} announced resource
                                    {replica.keys.length === 1 ? '' : 's'}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
