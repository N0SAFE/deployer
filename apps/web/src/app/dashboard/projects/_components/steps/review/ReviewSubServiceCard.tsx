'use client'

import {
    ChevronDown,
    ChevronRight,
    Globe,
    Boxes,
    GitBranch,
    Cpu,
    MemoryStick,
    KeyRound,
    Box,
    Lock,
    RotateCw,
} from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@deployer/ui/components/shadcn/badge'
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from '@deployer/ui/components/shadcn/collapsible'

import { describeTls } from './review-helpers'

import type { ReactNode } from 'react'

export interface SubServiceSummary {
    name: string
    image: string
    port?: number
    ports?: number[]
    visibility?: 'private' | 'public'
    tls?: { enabled?: boolean; certSecretRef?: string; httpRedirect?: boolean }
    customDomains?: string[]
    replicas?: number
    restart?: string
    environment?: Record<string, string>
    volumes?: string[]
    dependsOn?: string[]
    healthCheck?: { test?: string[] }
    resources?: { cpus?: number; memory?: string }
    networks?: string[]
}

interface Fact {
    label: string
    value: string
    icon?: ReactNode
}

function factsFor(svc: SubServiceSummary): Fact[] {
    const facts: Fact[] = []
    const port = svc.port ?? svc.ports?.[0]
    if (port)
        facts.push({
            label: 'Port',
            value: String(port),
            icon: <Box className="size-3" />,
        })
    if (svc.visibility)
        facts.push({
            label: 'Visibility',
            value: svc.visibility === 'public' ? 'Public' : 'Private',
            icon: <Globe className="size-3" />,
        })
    if (svc.visibility === 'public')
        facts.push({
            label: 'TLS',
            value: describeTls(svc.tls),
            icon: <Lock className="size-3" />,
        })
    if (svc.customDomains && svc.customDomains.length > 0)
        facts.push({
            label: 'Domains',
            value: svc.customDomains.join(', '),
            icon: <Globe className="size-3" />,
        })
    if (svc.replicas && svc.replicas > 1)
        facts.push({
            label: 'Replicas',
            value: String(svc.replicas),
            icon: <Boxes className="size-3" />,
        })
    if (svc.restart && svc.restart !== 'no')
        facts.push({
            label: 'Restart',
            value: svc.restart,
            icon: <RotateCw className="size-3" />,
        })
    if (svc.environment && Object.keys(svc.environment).length > 0)
        facts.push({
            label: 'Env overrides',
            value: String(Object.keys(svc.environment).length),
            icon: <KeyRound className="size-3" />,
        })
    if (svc.volumes && svc.volumes.length > 0)
        facts.push({
            label: 'Volumes',
            value: String(svc.volumes.length),
            icon: <MemoryStick className="size-3" />,
        })
    if (svc.dependsOn && svc.dependsOn.length > 0)
        facts.push({
            label: 'Depends on',
            value: svc.dependsOn.join(', '),
            icon: <GitBranch className="size-3" />,
        })
    if (svc.healthCheck?.test && svc.healthCheck.test.length > 0)
        facts.push({
            label: 'Health check',
            value: svc.healthCheck.test.join(' '),
            icon: <GitBranch className="size-3" />,
        })
    if (svc.resources?.cpus || svc.resources?.memory)
        facts.push({
            label: 'Limits',
            value: [
                svc.resources.cpus ? `${String(svc.resources.cpus)} CPU` : '',
                svc.resources.memory ?? '',
            ]
                .filter(Boolean)
                .join(' / '),
            icon: <Cpu className="size-3" />,
        })
    return facts
}

/** Collapsible summary of one sub-service that will be deployed. */
export function ReviewSubServiceCard({
    svc,
    index,
}: {
    svc: SubServiceSummary
    index: number
}) {
    const [open, setOpen] = useState(false)
    const facts = factsFor(svc)

    return (
        <div className="bg-background/40 overflow-hidden rounded-lg border">
            <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="hover:bg-muted/30 flex w-full items-center gap-2 px-3 py-2.5 text-left"
                    >
                        {open ? (
                            <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                        ) : (
                            <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                        )}
                        <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-md text-xs">
                            {String(index + 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                                {svc.name || `service-${String(index + 1)}`}
                            </span>
                            {svc.image ? (
                                <code className="text-muted-foreground block truncate font-mono text-xs">
                                    {svc.image}
                                </code>
                            ) : null}
                        </span>
                        {svc.visibility === 'public' && (
                            <Badge
                                variant="outline"
                                className="text-primary shrink-0 text-xs"
                            >
                                public
                            </Badge>
                        )}
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t px-3 py-2">
                    <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                        {facts.map((f) => (
                            <div
                                key={f.label}
                                className="flex items-start gap-1.5 text-xs"
                            >
                                <span className="text-muted-foreground flex shrink-0 items-center gap-1">
                                    {f.icon}
                                    {f.label}
                                </span>
                                <span className="min-w-0 font-medium break-words">
                                    {f.value}
                                </span>
                            </div>
                        ))}
                        {facts.length === 0 && (
                            <p className="text-muted-foreground col-span-full text-xs">
                                No extra configuration.
                            </p>
                        )}
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    )
}
