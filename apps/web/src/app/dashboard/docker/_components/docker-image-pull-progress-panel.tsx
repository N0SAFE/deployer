'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { AlertCircle, CheckCircle2, Download, Loader2, XCircle } from 'lucide-react'

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

  const completedLayers = useMemo(() => pullLayers.filter((layer) => layer.status === 'done').length, [pullLayers])
  const totalLayers = pullLayers.length
  const statusMessage = pullTimelineRows.at(-1)?.message ?? ''

  useEffect(() => {
    if (!layerViewportRef.current) {
      return
    }

    layerViewportRef.current.scrollTop = layerViewportRef.current.scrollHeight
  }, [pullLayers])

  useEffect(() => {
    if (!activityViewportRef.current) {
      return
    }

    activityViewportRef.current.scrollTop = activityViewportRef.current.scrollHeight
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

    return 'text-zinc-500'
  }

  function shouldSpin(status: DockerPullLayerRow['status']): boolean {
    return status === 'downloading' || status === 'extracting'
  }

  const statusNode =
    pullStatus === 'pulling' ? (
      <>
        <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
        <span className="text-sm text-sky-600 dark:text-sky-400">Pulling…</span>
      </>
    ) : pullStatus === 'complete' ? (
      <>
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <span className="text-sm text-emerald-600 dark:text-emerald-400">Complete</span>
      </>
    ) : pullStatus === 'error' ? (
      <>
        <XCircle className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">Failed</span>
      </>
    ) : pullStatus === 'queued' ? (
      <>
        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
        <span className="text-sm text-amber-600 dark:text-amber-400">Queued on server…</span>
      </>
    ) : (
      <>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Initializing…</span>
      </>
    )

  return (
    <div className="grid flex-1 min-h-0 gap-3 md:grid-cols-[1.15fr_.85fr]">
      <div className="rounded-xl border bg-linear-to-b from-background to-muted/20 overflow-hidden min-h-0 flex flex-col">
        <div className="shrink-0 border-b p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Download className="h-4 w-4" />
            <span className="truncate font-mono text-[12px]">{image || 'No image selected yet'}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2">{statusNode}</div>
            {totalLayers > 0 ? (
              <Badge variant="secondary" className="text-[10px]">{completedLayers}/{totalLayers}</Badge>
            ) : null}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>Overall progress</span>
              <span>{pullProgress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-sky-500 via-indigo-500 to-violet-500 transition-all duration-300"
                style={{ width: `${String(pullProgress)}%` }}
              />
            </div>
          </div>

          {statusMessage ? (
            <p className="text-[11px] text-muted-foreground truncate">{statusMessage}</p>
          ) : null}

          {pullErrorMessage ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive inline-flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-all">{pullErrorMessage}</span>
            </div>
          ) : null}
        </div>

        <div ref={layerViewportRef} className="flex-1 min-h-0 overflow-auto p-2">
          {pullLayers.length > 0 ? (
            <div className="space-y-1">
              {pullLayers.map((layer) => {
                const icon = layer.status === 'done' ? CheckCircle2 : layer.status === 'waiting' ? Loader2 : Loader2

                return (
                  <div key={layer.id} className="rounded-md border bg-background/80 p-2">
                    <div className="flex items-center gap-2">
                      {icon === CheckCircle2 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <Loader2 className={`h-3.5 w-3.5 shrink-0 ${layerTone(layer.status)} ${shouldSpin(layer.status) ? 'animate-spin' : ''}`} />
                      )}
                      <code className="w-20 shrink-0 font-mono text-[10px]">{layer.digest.slice(0, 12)}</code>
                      <span className={`min-w-0 truncate text-[11px] ${layerTone(layer.status)}`}>{layer.status}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{layer.progress}%</span>
                    </div>

                    {(layer.status === 'downloading' || layer.status === 'extracting') ? (
                      <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full transition-all duration-200 ${layer.status === 'extracting' ? 'bg-amber-500' : 'bg-sky-500'}`}
                          style={{ width: `${String(layer.progress)}%` }}
                        />
                      </div>
                    ) : null}

                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="truncate">{layer.instruction}</span>
                      <span className="shrink-0">{layer.size}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">Waiting for layers…</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden min-h-0 flex flex-col bg-background">
        <div className="shrink-0 border-b px-3 py-2 flex items-center justify-between">
          <p className="text-xs font-medium">Pull activity</p>
          <Badge variant="outline" className="text-[10px]">{pullRuntimeEventCount} pull lines</Badge>
        </div>
        <div ref={activityViewportRef} className="flex-1 min-h-0 overflow-auto bg-black/85 p-2 space-y-1">
          {pullTimelineRows.length > 0 ? pullTimelineRows.map((row, index) => (
            <div key={`${row.at}-${row.type}-${String(index)}`} className="font-mono text-[11px] leading-5 text-emerald-300">
              <span className="text-emerald-500">[{toClock(row.at)}]</span>{' '}
              <span className="text-amber-300">{row.type}</span>{' '}
              {row.message}
            </div>
          )) : (
            <p className="font-mono text-[11px] text-zinc-500">Waiting for pull activity…</p>
          )}
        </div>
      </div>
    </div>
  )
}
