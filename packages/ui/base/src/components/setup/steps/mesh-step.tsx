'use client'

/**
 * The wizard's mesh card: this node's swarm state, plus the two things an
 * operator can do about it — join a swarm with an invite, or mint one.
 *
 * ── WHY IT ASKS THE NODE DOOR, NOT THE PLATFORM ─────────────────────────────
 * The mesh agent is the only mesh owner on this node and it answers locally, so
 * this works BEFORE the platform exists. That is the point: a bare node can
 * join a running swarm during onboarding instead of waiting for an API that
 * only starts afterwards.
 *
 * Nothing here polls. Status is read when the section opens, and again only
 * when the operator refreshes or a join succeeds.
 */

import { Check, Copy, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import type { SetupMeshJoinResult } from '@deployer/contracts-entities'
import type { SetupWizardApi } from '@deployer/ui/components/setup/types'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'
import { cn } from '@deployer/ui/lib/utils'

/** The three mesh calls, once the host has them (see `SetupWizardApi`). */
export interface MeshStepApi {
    useMeshStatus: NonNullable<SetupWizardApi['useMeshStatus']>
    joinMesh: NonNullable<SetupWizardApi['joinMesh']>
    issueMeshToken: NonNullable<SetupWizardApi['issueMeshToken']>
}

interface Props {
    api: MeshStepApi
}

export function MeshStep({ api }: Props) {
    const { data: status, refetch } = api.useMeshStatus()
    const [token, setToken] = useState('')
    const [joinResult, setJoinResult] = useState<SetupMeshJoinResult | null>(
        null
    )
    const [joining, setJoining] = useState(false)
    const [invite, setInvite] = useState<string | null>(null)
    const [issuing, setIssuing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const swarm = status?.swarm ?? null

    async function handleJoin() {
        if (token.trim() === '') return
        setJoining(true)
        setError(null)
        setJoinResult(null)
        try {
            const result = await api.joinMesh({ token: token.trim() })
            setJoinResult(result)
            if (result.joined) {
                setToken('')
                refetch?.()
            }
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : 'The mesh agent could not be reached.'
            )
        } finally {
            setJoining(false)
        }
    }

    async function handleIssue() {
        setIssuing(true)
        setError(null)
        try {
            const result = await api.issueMeshToken({})
            setInvite(result.token)
            if (result.token === null)
                setError(
                    "This node's mesh agent is not answering, so no invite was issued."
                )
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : 'The mesh agent could not be reached.'
            )
        } finally {
            setIssuing(false)
        }
    }

    async function handleCopy(value: string) {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }

    return (
        <div className="border-border bg-background/40 flex flex-col gap-4 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h3 className="text-foreground text-sm font-semibold">
                        Mesh network
                    </h3>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                        This node&apos;s agent owns the mesh here. Join a
                        running swarm now — the platform does not need to exist
                        yet.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Refresh mesh status"
                        onClick={() => refetch?.()}
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {status === undefined ? (
                <p className="text-muted-foreground text-xs">
                    Reading mesh state…
                </p>
            ) : !status.available ? (
                <p className="text-muted-foreground text-xs">
                    No mesh agent answered on this node. It runs standalone;
                    start the agent to join a swarm.
                </p>
            ) : (
                <div className="flex flex-col gap-2 text-xs">
                    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                        <dt className="text-muted-foreground">Agent</dt>
                        <dd className="text-foreground font-mono break-all">
                            {status.agentId ?? 'unknown'}
                        </dd>
                        <dt className="text-muted-foreground">Interface</dt>
                        <dd
                            className={cn(
                                'font-medium',
                                status.interfaceUp
                                    ? 'text-status-live'
                                    : 'text-status-pending'
                            )}
                        >
                            {status.interfaceUp ? 'up' : 'down'}
                        </dd>
                        <dt className="text-muted-foreground">Mesh address</dt>
                        <dd className="text-foreground font-mono">
                            {status.meshAddress ?? '—'}
                        </dd>
                        {status.nodeId ? (
                            <>
                                <dt className="text-muted-foreground">
                                    Platform node
                                </dt>
                                <dd className="text-foreground font-mono break-all">
                                    {status.nodeId}
                                </dd>
                            </>
                        ) : null}
                    </dl>

                    {swarm === null ? (
                        <p className="text-muted-foreground">
                            Not in a swarm — no peers configured. Join one below
                            with an invite from another node.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-muted-foreground">
                                Swarm of {swarm.nodes} node
                                {swarm.nodes === 1 ? '' : 's'}
                            </span>
                            <ul className="flex flex-col gap-1">
                                {swarm.peers.map((peer) => (
                                    <li
                                        key={peer.nodeId}
                                        className="flex items-center gap-2"
                                    >
                                        <span
                                            aria-hidden="true"
                                            title={
                                                peer.handshake
                                                    ? 'WireGuard handshake completed'
                                                    : 'No handshake yet'
                                            }
                                            className={cn(
                                                'h-2 w-2 shrink-0 rounded-full',
                                                peer.handshake
                                                    ? 'bg-status-live'
                                                    : 'bg-status-pending'
                                            )}
                                        />
                                        <span className="text-foreground font-mono break-all">
                                            {peer.nodeId}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {peer.meshAddress ?? 'no address'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <div className="border-border/60 flex flex-col gap-2 border-t pt-3">
                <label
                    htmlFor="mesh-invite"
                    className="text-foreground text-xs font-medium"
                >
                    Join a swarm
                </label>
                <div className="flex gap-2">
                    <Input
                        id="mesh-invite"
                        value={token}
                        onChange={(event) => {
                            setToken(event.target.value)
                        }}
                        placeholder="Invite token from another node"
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono text-xs"
                    />
                    <Button
                        type="button"
                        size="sm"
                        disabled={joining || token.trim() === ''}
                        onClick={() => void handleJoin()}
                    >
                        {joining ? 'Joining…' : 'Join'}
                    </Button>
                </div>

                {joinResult?.joined ? (
                    <p className="text-status-live text-xs">
                        Joined — {joinResult.agents.length} agent
                        {joinResult.agents.length === 1 ? '' : 's'} learned.
                    </p>
                ) : null}
                {joinResult?.reason ? (
                    <p className="text-status-danger text-xs">
                        {joinResult.reason}
                    </p>
                ) : null}
            </div>

            <div className="border-border/60 flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground text-xs font-medium">
                        Invite another node
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={issuing}
                        onClick={() => void handleIssue()}
                    >
                        {issuing ? 'Issuing…' : 'Create an invite'}
                    </Button>
                </div>

                {invite !== null ? (
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <code className="border-border bg-muted/40 text-foreground flex-1 overflow-x-auto rounded-md border px-2 py-1.5 font-mono text-[11px]">
                                {invite}
                            </code>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Copy invite token"
                                onClick={() => void handleCopy(invite)}
                            >
                                {copied ? (
                                    <Check className="h-3.5 w-3.5" />
                                ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                )}
                            </Button>
                        </div>
                        <p className="text-muted-foreground text-[11px]">
                            Shown once — single use, and it expires on the
                            agent&apos;s default schedule.
                        </p>
                    </div>
                ) : null}
            </div>

            {error ? (
                <p className="text-status-danger text-xs">{error}</p>
            ) : null}
        </div>
    )
}

function StatusBadge({
    status,
}: {
    status: ReturnType<MeshStepApi['useMeshStatus']>['data']
}) {
    if (status === undefined) return <Badge variant="secondary">Checking</Badge>
    if (!status.available) return <Badge variant="warning">No agent</Badge>
    if (status.swarm !== null)
        return <Badge variant="success">Swarm · {status.swarm.nodes}</Badge>
    return <Badge variant="secondary">Standalone</Badge>
}
