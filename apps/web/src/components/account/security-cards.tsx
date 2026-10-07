'use client'

/**
 * Security surfaces shared by the profile page and the account page.
 *
 * Both pages need the same three answers — "what can get into this account?",
 * "how is it protected?", "what is connected to it?" — so the cards live here
 * and each page composes the subset it owns. Rendering them twice would mean
 * two places to fix every label.
 *
 * Every card reads through `@/domains/account/hooks`, so none of them touches
 * Better Auth's transport directly.
 */

import * as React from 'react'
import {
    AlertTriangle,
    Bot,
    Check,
    Copy,
    Fingerprint,
    KeyRound,
    Link2,
    Loader2,
    MonitorSmartphone,
    Plus,
    RefreshCw,
    Server,
    ShieldCheck,
    ShieldOff,
    Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@repo/ui/components/shadcn/table'
import {
    addPasskey,
    createApiKey,
    deletePasskey,
    describeUserAgent,
    isExpired,
    relativeTime,
    revokeApiKey,
    revokeOtherSessions,
    revokeSession,
    useActiveSessions,
    useAgentHosts,
    useAgents,
    useApiKeys,
    useLinkedAccounts,
    usePasskeys,
} from '@/domains/account/hooks'

/** Shown when a plugin endpoint fails, with the server's own explanation. */
function ResourceError({ title, message }: { title: string; message: string }) {
    return (
        <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
        </Alert>
    )
}

/** Row of skeleton bars sized like the list it stands in for. */
function ListSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <div className="space-y-2">
            {Array.from({ length: rows }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

/**
 * Passkeys enrolled on this account.
 *
 * Carries an explicit warning when empty, because the consequence is not
 * obvious from the list: Agent Auth requires WebAuthn for mutating
 * capabilities, so an account with no passkey cannot approve an agent's write
 * request.
 */
export function PasskeysCard() {
    const { data, error, isLoading, reload } = usePasskeys()
    const [busy, setBusy] = React.useState<string | null>(null)
    const [adding, setAdding] = React.useState(false)

    const passkeys = data ?? []

    const handleAdd = async () => {
        setAdding(true)
        try {
            await addPasskey()
            toast.success('Passkey registered')
            await reload()
        } catch (err) {
            // A cancelled WebAuthn prompt is the common case here and is not an
            // error worth shouting about — the browser already told the user.
            const message = err instanceof Error ? err.message : 'Registration failed'
            if (!/cancel|abort/i.test(message)) {
                toast.error('Could not register passkey', { description: message })
            }
        } finally {
            setAdding(false)
        }
    }

    const handleDelete = async (id: string, name: string | null | undefined) => {
        setBusy(id)
        try {
            await deletePasskey(id)
            toast.success(`Removed ${name ?? 'passkey'}`)
            await reload()
        } catch (err) {
            toast.error('Could not remove passkey', {
                description: err instanceof Error ? err.message : undefined,
            })
        } finally {
            setBusy(null)
        }
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Fingerprint className="size-5" />
                            Passkeys
                        </CardTitle>
                        <CardDescription>
                            Sign in without a password using your device biometrics.
                        </CardDescription>
                    </div>
                    <Button size="sm" onClick={() => void handleAdd()} disabled={adding}>
                        {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        <span className="ml-2">Add passkey</span>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {isLoading && <ListSkeleton rows={2} />}

                {error && !isLoading && (
                    <ResourceError title="Could not load passkeys" message={error} />
                )}

                {!isLoading && !error && passkeys.length === 0 && (
                    <Alert>
                        <AlertTriangle className="size-4" />
                        <AlertTitle>No passkeys yet</AlertTitle>
                        <AlertDescription>
                            Agents cannot perform write actions on your behalf until at
                            least one passkey exists — those approvals require a
                            hardware-backed confirmation.
                        </AlertDescription>
                    </Alert>
                )}

                {passkeys.length > 0 && (
                    <div className="overflow-hidden rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Synced</TableHead>
                                    <TableHead>Added</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {passkeys.map((pk) => (
                                    <TableRow key={pk.id}>
                                        <TableCell className="font-medium">
                                            {pk.name ?? 'Unnamed'}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">
                                                {pk.deviceType ?? 'unknown'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {pk.backedUp ? (
                                                <Badge variant="secondary">synced</Badge>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">
                                                    this device
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {relativeTime(pk.createdAt, '—')}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={busy === pk.id}
                                                aria-label={`Remove ${pk.name ?? 'passkey'}`}
                                                onClick={() => void handleDelete(pk.id, pk.name)}
                                            >
                                                {busy === pk.id ? (
                                                    <Loader2 className="size-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="size-4" />
                                                )}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

// ---------------------------------------------------------------------------
// Active sessions
// ---------------------------------------------------------------------------

/** Every device that can reach this account, with per-device revocation. */
export function ActiveSessionsCard() {
    const { data, error, isLoading, reload } = useActiveSessions()
    const [busy, setBusy] = React.useState<string | null>(null)
    const [revokingOthers, setRevokingOthers] = React.useState(false)

    const sessions = data ?? []

    const handleRevoke = async (token: string) => {
        setBusy(token)
        try {
            await revokeSession(token)
            toast.success('Device signed out')
            await reload()
        } catch (err) {
            toast.error('Could not sign that device out', {
                description: err instanceof Error ? err.message : undefined,
            })
        } finally {
            setBusy(null)
        }
    }

    const handleRevokeOthers = async () => {
        setRevokingOthers(true)
        try {
            await revokeOtherSessions()
            toast.success('Signed out everywhere else')
            await reload()
        } catch (err) {
            toast.error('Could not sign out other devices', {
                description: err instanceof Error ? err.message : undefined,
            })
        } finally {
            setRevokingOthers(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <MonitorSmartphone className="size-5" />
                            Devices with access
                        </CardTitle>
                        <CardDescription>
                            Every browser and device holding a session for this account.
                        </CardDescription>
                    </div>
                    {sessions.length > 1 && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={revokingOthers}
                            onClick={() => void handleRevokeOthers()}
                        >
                            {revokingOthers && <Loader2 className="size-4 animate-spin" />}
                            <span className="ml-2">Sign out everywhere else</span>
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {isLoading && <ListSkeleton rows={2} />}

                {error && !isLoading && (
                    <ResourceError title="Could not load devices" message={error} />
                )}

                {!isLoading && !error && sessions.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                        No session information available.
                    </p>
                )}

                {sessions.length > 0 && (
                    <div className="overflow-hidden rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Device</TableHead>
                                    <TableHead>IP</TableHead>
                                    <TableHead>Signed in</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sessions.map((s) => (
                                    <TableRow key={s.id}>
                                        <TableCell className="font-medium">
                                            {describeUserAgent(s.userAgent)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {s.ipAddress ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {relativeTime(s.createdAt, '—')}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {isExpired(s.expiresAt) ? (
                                                <Badge variant="secondary">expired</Badge>
                                            ) : (
                                                relativeTime(s.expiresAt, '—')
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={busy === s.token}
                                                aria-label="Sign out this device"
                                                onClick={() => void handleRevoke(s.token)}
                                            >
                                                {busy === s.token ? (
                                                    <Loader2 className="size-4 animate-spin" />
                                                ) : (
                                                    <ShieldOff className="size-4" />
                                                )}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/**
 * API keys owned by this account.
 *
 * The raw key is shown exactly once, immediately after creation, because the
 * API never returns it again. The copy action lives next to it for that reason.
 */
export function ApiKeysCard() {
    const { data, error, isLoading, reload } = useApiKeys()
    const [name, setName] = React.useState('')
    const [creating, setCreating] = React.useState(false)
    const [busy, setBusy] = React.useState<string | null>(null)
    const [freshKey, setFreshKey] = React.useState<string | null>(null)

    const keys = data ?? []

    const handleCreate = async () => {
        const trimmed = name.trim()
        if (!trimmed) {
            toast.error('Give the key a name so you can identify it later')
            return
        }

        setCreating(true)
        try {
            const { key, error: createError } = await createApiKey({
                name: trimmed,
                // 90 days: long enough for CI, short enough to expire on its own.
                expiresIn: 90 * 24 * 60 * 60,
            })
            if (createError || !key) {
                toast.error('Could not create key', { description: createError ?? undefined })
                return
            }
            setFreshKey(key)
            setName('')
            await reload()
        } finally {
            setCreating(false)
        }
    }

    const handleRevoke = async (id: string, keyName: string | null) => {
        setBusy(id)
        try {
            await revokeApiKey(id)
            toast.success(`Revoked ${keyName ?? 'key'}`)
            await reload()
        } catch (err) {
            toast.error('Could not revoke key', {
                description: err instanceof Error ? err.message : undefined,
            })
        } finally {
            setBusy(null)
        }
    }

    const copyKey = async () => {
        if (!freshKey) return
        try {
            await navigator.clipboard.writeText(freshKey)
            toast.success('Key copied')
        } catch {
            toast.error('Could not copy — select the text manually')
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <KeyRound className="size-5" />
                    API keys
                </CardTitle>
                <CardDescription>
                    Credentials for the CLI, scripts and CI. Keys expire after 90 days.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {freshKey && (
                    <Alert>
                        <Check className="size-4" />
                        <AlertTitle>Copy this key now — it will not be shown again</AlertTitle>
                        <AlertDescription className="space-y-2">
                            <div className="flex items-center gap-2">
                                <code className="bg-muted flex-1 overflow-x-auto rounded px-2 py-1 font-mono text-xs">
                                    {freshKey}
                                </code>
                                <Button size="sm" variant="outline" onClick={() => void copyKey()}>
                                    <Copy className="size-4" />
                                </Button>
                            </div>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setFreshKey(null)}
                            >
                                Done
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}

                <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[200px] flex-1 space-y-1">
                        <Label htmlFor="api-key-name">New key name</Label>
                        <Input
                            id="api-key-name"
                            value={name}
                            placeholder="ci-deploy"
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleCreate()
                            }}
                        />
                    </div>
                    <Button onClick={() => void handleCreate()} disabled={creating}>
                        {creating ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Plus className="size-4" />
                        )}
                        <span className="ml-2">Create key</span>
                    </Button>
                </div>

                {isLoading && <ListSkeleton rows={2} />}

                {error && !isLoading && (
                    <ResourceError title="Could not load API keys" message={error} />
                )}

                {!isLoading && !error && keys.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                        No API keys yet.
                    </p>
                )}

                {keys.length > 0 && (
                    <div className="overflow-hidden rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Preview</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead>Last used</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {keys.map((k) => (
                                    <TableRow key={k.id}>
                                        <TableCell className="font-medium">
                                            {k.name ?? '—'}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {k.start ? `${k.start}…` : '—'}
                                        </TableCell>
                                        <TableCell>
                                            {k.enabled ? (
                                                <Badge>active</Badge>
                                            ) : (
                                                <Badge variant="secondary">disabled</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {!k.expiresAt ? (
                                                <span className="text-muted-foreground">
                                                    never
                                                </span>
                                            ) : isExpired(k.expiresAt) ? (
                                                <Badge variant="destructive">expired</Badge>
                                            ) : (
                                                relativeTime(k.expiresAt)
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {relativeTime(k.lastRequest)}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={!k.enabled || busy === k.id}
                                                aria-label={`Revoke ${k.name ?? 'key'}`}
                                                onClick={() => void handleRevoke(k.id, k.name)}
                                            >
                                                {busy === k.id ? (
                                                    <Loader2 className="size-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="size-4" />
                                                )}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

// ---------------------------------------------------------------------------
// Connected accounts
// ---------------------------------------------------------------------------

/**
 * External identities linked to this account.
 *
 * This is the "connections" view: which OAuth providers can get in. A
 * password-only account has none, which is itself worth showing — it makes the
 * difference between "no connections" and "not loaded" visible.
 */
export function ConnectedAccountsCard() {
    const { data, error, isLoading } = useLinkedAccounts()

    const accounts = data ?? []

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Link2 className="size-5" />
                    Connected accounts
                </CardTitle>
                <CardDescription>
                    Identity providers linked to this account.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {isLoading && <ListSkeleton rows={2} />}

                {error && !isLoading && (
                    <ResourceError title="Could not load connections" message={error} />
                )}

                {!isLoading && !error && accounts.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                        No external accounts linked. You sign in with a password.
                    </p>
                )}

                {accounts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {accounts.map((a) => (
                            <Badge key={a.id} variant="outline" className="gap-1 py-1">
                                <Link2 className="size-3" />
                                {a.providerId}
                            </Badge>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

// ---------------------------------------------------------------------------
// Agent connections
// ---------------------------------------------------------------------------

/**
 * AI agents authorised to act for this account, and the hosts that run them.
 *
 * This is the most consequential "connection" on the platform: an agent holds
 * capability grants and acts without a browser session. Showing mode and status
 * is what makes the difference between "an agent can read my fleet" and "an
 * agent can deploy" visible.
 */
export function AgentConnectionsCard() {
    const agents = useAgents()
    const hosts = useAgentHosts()

    const agentList = agents.data ?? []
    const hostList = hosts.data ?? []

    // A deployment without agent auth configured returns an error here. That is
    // not a failure of this page, so it is stated as configuration, not as a
    // problem the user can fix.
    const notConfigured = Boolean(agents.error || hosts.error)

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Bot className="size-5" />
                    AI agents
                </CardTitle>
                <CardDescription>
                    Agents acting on your behalf, under capability grants you approve.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {notConfigured ? (
                    <p className="text-muted-foreground text-sm">
                        Agent access is not enabled on this deployment.
                    </p>
                ) : (
                    <>
                        {(agents.isLoading || hosts.isLoading) && <ListSkeleton rows={2} />}

                        {!agents.isLoading && agentList.length === 0 && (
                            <p className="text-muted-foreground text-sm">
                                No agents have been authorised yet.
                            </p>
                        )}

                        {agentList.length > 0 && (
                            <div className="overflow-hidden rounded-lg border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Agent</TableHead>
                                            <TableHead>Mode</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Last used</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {agentList.map((a) => (
                                            <TableRow key={a.id}>
                                                <TableCell className="font-medium">
                                                    {a.name}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{a.mode}</Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={
                                                            a.status === 'active'
                                                                ? 'default'
                                                                : 'secondary'
                                                        }
                                                    >
                                                        {a.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    {relativeTime(a.lastUsedAt)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        {hostList.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium">
                                    Hosts{' '}
                                    <span className="text-muted-foreground font-normal">
                                        ({hostList.length})
                                    </span>
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {hostList.map((h) => (
                                        <Badge key={h.id} variant="outline" className="gap-1 py-1">
                                            <Server className="size-3" />
                                            {h.name ?? h.id}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )
}

// ---------------------------------------------------------------------------
// Two-factor status (summary only — the controls live in the devtools panel)
// ---------------------------------------------------------------------------

/** Read-only two-factor status, so the profile states the account's posture. */
export function SecurityPostureCard({ enabled }: { enabled: boolean }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    {enabled ? (
                        <ShieldCheck className="size-5" />
                    ) : (
                        <ShieldOff className="size-5" />
                    )}
                    Two-factor authentication
                </CardTitle>
                <CardDescription>
                    A second factor on an account that controls production infrastructure.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
                {enabled ? (
                    <Badge>enabled</Badge>
                ) : (
                    <>
                        <Badge variant="secondary">disabled</Badge>
                        <span className="text-muted-foreground text-sm">
                            Enrol from the Security panel in the developer tools.
                        </span>
                    </>
                )}
                <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => window.location.reload()}
                >
                    <RefreshCw className="size-4" />
                    <span className="ml-2">Refresh</span>
                </Button>
            </CardContent>
        </Card>
    )
}
