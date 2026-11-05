'use client'

import {
    Cloud,
    Globe,
    Network,
    RefreshCw,
    Settings2,
    Trash2,
} from 'lucide-react'

import { Button, buttonVariants } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent } from '@deployer/ui/components/shadcn/card'

import { cn } from '@/lib/utils'
import { AuthDashboardAdminProvidersDnsCloudflareProviderId } from '@/routes'

import { IntegrationStatusBadge } from '../../../_components/status-line'
import { deriveDnsAppStatus } from '../../../_lib/provider-status'

import type { CloudflareAccount } from './types'

/** Result of the last manual "Test connection" for an account, kept until the next one. */
export interface TestResult {
    ok: boolean
    message: string
}

export function CloudflareAccountCard({
    account,
    usedByEdge,
    testing,
    testResult,
    onTest,
    onConfigure,
    onRemove,
}: {
    account: CloudflareAccount
    usedByEdge: boolean
    testing: boolean
    testResult?: TestResult
    onTest: () => void
    onConfigure: () => void
    onRemove: () => void
}) {
    const status = deriveDnsAppStatus(account)
    const checkedAt = account.state?.checkedAt
    return (
        <Card className={cn(!account.isActive && 'opacity-80')}>
            <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start gap-3">
                    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                        <Cloud
                            className="text-muted-foreground size-5"
                            aria-hidden
                        />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold">
                                {account.name}
                            </h3>
                            <IntegrationStatusBadge status={status} />
                            {usedByEdge ? (
                                <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium">
                                    <Network className="size-3" aria-hidden />{' '}
                                    Runs the public edge
                                </span>
                            ) : null}
                        </div>
                        <p className="text-muted-foreground text-sm">
                            {status.detail}
                        </p>
                        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-sm">
                            <span className="inline-flex items-center gap-1">
                                <Globe className="size-3.5" aria-hidden />
                                DNS{' '}
                                {account.features.dnsManagement ? 'on' : 'off'}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <Network className="size-3.5" aria-hidden />
                                Tunnels{' '}
                                {account.features.tunnelManagement
                                    ? 'on'
                                    : 'off'}
                            </span>
                            {checkedAt ? (
                                <span
                                    title={new Date(checkedAt).toLocaleString()}
                                >
                                    Checked{' '}
                                    {new Date(checkedAt).toLocaleTimeString()}
                                </span>
                            ) : null}
                        </p>
                    </div>
                </div>

                {testResult ? (
                    <p
                        role="status"
                        className={cn(
                            'rounded-md border px-3 py-2 text-sm',
                            testResult.ok
                                ? 'border-status-live/40 bg-status-live/10'
                                : 'border-destructive/40 bg-destructive/10 text-destructive'
                        )}
                    >
                        {testResult.ok
                            ? 'Connection OK. '
                            : 'Connection failed. '}
                        {testResult.message}
                    </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                    <AuthDashboardAdminProvidersDnsCloudflareProviderId.Link
                        providerId={account.id}
                        className={buttonVariants({
                            size: 'sm',
                            variant:
                                status.cta === 'fix' ? 'outline' : 'default',
                        })}
                    >
                        DNS records and tunnels
                    </AuthDashboardAdminProvidersDnsCloudflareProviderId.Link>
                    <Button
                        size="sm"
                        variant={status.cta === 'fix' ? 'default' : 'outline'}
                        onClick={onTest}
                        disabled={testing}
                    >
                        <RefreshCw
                            className={cn(
                                'mr-1.5 size-3.5',
                                testing &&
                                    'animate-spin motion-reduce:animate-none'
                            )}
                        />
                        {testing ? 'Testing…' : 'Test connection'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={onConfigure}>
                        <Settings2 className="mr-1.5 size-3.5" />
                        Settings
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive ml-auto"
                        onClick={onRemove}
                        aria-label={`Remove Cloudflare account ${account.name}`}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
