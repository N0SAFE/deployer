'use client'

import {
    AlertCircle,
    CheckCircle2,
    Download,
    Loader2,
    XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import { Badge } from '@deployer/ui/components/shadcn/badge'

export interface DockerPullLayerRow {
    id: string
    digest: string
    instruction: string
    size: string
    status: 'waiting' | 'downloading' | 'extracting' | 'done'
    progress: number
}

export interface DockerPullTimelineRow {
    at: string
    type: string
    message: string
}

interface DockerImagePullProgressPanelProps {
    image: string
    pullStatus: 'idle' | 'queued' | 'pulling' | 'complete' | 'error'
    pullProgress: number
    pullErrorMessage: string | null
    pullRuntimeEventCount: number
    pullLayers: DockerPullLayerRow[]
    pullTimelineRows: DockerPullTimelineRow[]
    toClock: (iso: string) => string
}

export function DockerImagePullProgressPanel({
    image,
    pullStatus,
    pullProgress,
    pullErrorMessage,
    pullRuntimeEventCount,
    pullLayers,
    pullTimelineRows,
    toClock,
}: DockerImagePullProgressPanelProps) {
    const layerViewportRef = useRef<HTMLDivElement | null>(null)
    const activityViewportRef = useRef<HTMLDivElement | null>(null)

    const completedLayers = useMemo(
        () => pullLayers.filter((layer) => layer.status === 'done').length,
        [pullLayers]
    )
    const totalLayers = pullLayers.length
    const statusMessage = pullTimelineRows.at(-1)?.message ?? ''

    useEffect(() => {
        if (!layerViewportRef.current) {
            return
        }

        layerViewportRef.current.scrollTop =
            layerViewportRef.current.scrollHeight
    }, [pullLayers])

    useEffect(() => {
        if (!activityViewportRef.current) {
            return
        }

        activityViewportRef.current.scrollTop =
            activityViewportRef.current.scrollHeight
    }, [pullTimelineRows])

    function layerTone(status: DockerPullLayerRow['status']): string {
        if (status === 'done') {
            return 'text-emerald-500'
        }

        if (status === 'extracting') {
            return 'text-sky-400'
        }

        if (status === 'downloading') {
            return 'text-indigo-400'
        }

        return 'text-zinc-400'
    }

    function shouldSpin(status: DockerPullLayerRow['status']): boolean {
        return status === 'downloading' || status === 'extracting'
    }

    const statusNode =
        pullStatus === 'pulling' ? (
            <>
                <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
                <span className="text-sm text-sky-600 dark:text-sky-400">
                    Pulling…
                </span>
            </>
        ) : pullStatus === 'complete' ? (
            <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                    Complete
                </span>
            </>
        ) : pullStatus === 'error' ? (
            <>
                <XCircle className="text-destructive h-4 w-4" />
                <span className="text-destructive text-sm">Failed</span>
            </>
        ) : pullStatus === 'queued' ? (
            <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                <span className="text-sm text-amber-600 dark:text-amber-400">
                    Queued on server…
                </span>
            </>
        ) : (
            <>
                <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                <span className="text-muted-foreground text-sm">
                    Initializing…
                </span>
            </>
        )

    return (
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1.15fr_.85fr]">
            <div className="from-background to-muted/20 flex min-h-0 flex-col overflow-hidden rounded-xl border bg-linear-to-b">
                <div className="shrink-0 space-y-3 border-b p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <Download className="h-4 w-4" />
                        <span className="truncate font-mono text-[12px]">
                            {image || 'No image selected yet'}
                        </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-2">
                            {statusNode}
                        </div>
                        {totalLayers > 0 ? (
                            <Badge variant="secondary" className="text-xs">
                                {completedLayers}/{totalLayers}
                            </Badge>
                        ) : null}
                    </div>

                    <div className="space-y-1">
                        <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                            <span>Overall progress</span>
                            <span>{pullProgress}%</span>
                        </div>
                        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                            <div
                                className="h-full bg-linear-to-r from-sky-500 via-indigo-500 to-violet-500 transition-all duration-300"
                                style={{ width: `${String(pullProgress)}%` }}
                            />
                        </div>
                    </div>

                    {statusMessage ? (
                        <p className="text-muted-foreground truncate text-xs">
                            {statusMessage}
                        </p>
                    ) : null}

                    {pullErrorMessage ? (
                        <div className="border-destructive/40 bg-destructive/10 text-destructive inline-flex items-start gap-2 rounded-md border p-2 text-xs">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="break-all">
                                {pullErrorMessage}
                            </span>
                        </div>
                    ) : null}
                </div>

                <div
                    ref={layerViewportRef}
                    className="min-h-0 flex-1 overflow-auto p-2"
                >
                    {pullLayers.length > 0 ? (
                        <div className="space-y-1">
                            {pullLayers.map((layer) => {
                                const icon =
                                    layer.status === 'done'
                                        ? CheckCircle2
                                        : layer.status === 'waiting'
                                          ? Loader2
                                          : Loader2

                                return (
                                    <div
                                        key={layer.id}
                                        className="bg-background/80 rounded-md border p-2"
                                    >
                                        <div className="flex items-center gap-2">
                                            {icon === CheckCircle2 ? (
                                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                            ) : (
                                                <Loader2
                                                    className={`h-3.5 w-3.5 shrink-0 ${layerTone(layer.status)} ${shouldSpin(layer.status) ? 'animate-spin' : ''}`}
                                                />
                                            )}
                                            <code className="w-20 shrink-0 font-mono text-xs">
                                                {layer.digest.slice(0, 12)}
                                            </code>
                                            <span
                                                className={`min-w-0 truncate text-xs ${layerTone(layer.status)}`}
                                            >
                                                {layer.status}
                                            </span>
                                            <span className="text-muted-foreground ml-auto text-xs">
                                                {layer.progress}%
                                            </span>
                                        </div>

                                        {layer.status === 'downloading' ||
                                        layer.status === 'extracting' ? (
                                            <div className="bg-muted mt-1.5 h-1 overflow-hidden rounded-full">
                                                <div
                                                    className={`h-full transition-all duration-200 ${layer.status === 'extracting' ? 'bg-amber-500' : 'bg-sky-500'}`}
                                                    style={{
                                                        width: `${String(layer.progress)}%`,
                                                    }}
                                                />
                                            </div>
                                        ) : null}

                                        <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-xs">
                                            <span className="truncate">
                                                {layer.instruction}
                                            </span>
                                            <span className="shrink-0">
                                                {layer.size}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <p className="text-muted-foreground py-6 text-center text-xs">
                            Waiting for layers…
                        </p>
                    )}
                </div>
            </div>

            <div className="bg-background flex min-h-0 flex-col overflow-hidden rounded-xl border">
                <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
                    <p className="text-xs font-medium">Pull activity</p>
                    <Badge variant="outline" className="text-xs">
                        {pullRuntimeEventCount} pull lines
                    </Badge>
                </div>
                <div
                    ref={activityViewportRef}
                    className="min-h-0 flex-1 space-y-1 overflow-auto bg-black/85 p-2"
                >
                    {pullTimelineRows.length > 0 ? (
                        pullTimelineRows.map((row, index) => (
                            <div
                                key={`${row.at}-${row.type}-${String(index)}`}
                                className="font-mono text-xs leading-5 text-emerald-300"
                            >
                                <span className="text-emerald-500">
                                    [{toClock(row.at)}]
                                </span>{' '}
                                <span className="text-amber-300">
                                    {row.type}
                                </span>{' '}
                                {row.message}
                            </div>
                        ))
                    ) : (
                        <p className="font-mono text-xs text-zinc-400">
                            Waiting for pull activity…
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
