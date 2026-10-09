'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, Pause, Play, RefreshCw, ScrollText, WrapText } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Toggle } from '@repo/ui/components/shadcn/toggle'
import { EmptyState } from '@/components/dashboard'
import { useDeploymentLogs } from '@/domains/deployment/hooks'
import { formatDateTime } from '@/lib/format/date'
import { InlineError } from '../../../../../_components/workload/WorkloadStates'
import { isInProgress } from '../../../../../_utils/workload'

const LEVEL_CLASS: Record<string, string> = {
  error: 'text-red-300',
  warn: 'text-amber-300',
  info: 'text-slate-100',
  debug: 'text-slate-400',
}

/**
 * Real build/deploy output of ONE deployment (`deployment.getLogs`). Follows the
 * newest line while the run is in progress; pause, wrap, copy and download.
 */
export function DeploymentLogsViewer({ deploymentId, status }: { deploymentId: string; status: string }) {
  const running = isInProgress(status)
  const [wrap, setWrap] = useState(true)
  const [follow, setFollow] = useState(running)
  const [paused, setPaused] = useState(false)
  const [copied, setCopied] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const query = useDeploymentLogs(deploymentId, { limit: 500, offset: 0 })
  const logs = useMemo(() => query.data?.logs ?? [], [query.data])

  // Poll while the run is live and the operator has not paused.
  const { refetch } = query
  useEffect(() => {
    if (!running || paused) return
    const id = window.setInterval(() => { void refetch() }, 4000)
    return () => { window.clearInterval(id) }
  }, [running, paused, refetch])

  useEffect(() => {
    if (follow && viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [logs, follow])

  const lines = useMemo(
    () => logs.map((l) => `${formatDateTime(l.timestamp)} [${l.level}]${l.phase ? ` [${l.phase}]` : ''} ${l.message}`),
    [logs],
  )

  if (query.isError) {
    return <InlineError title="Could not load the logs of this deployment" error={query.error} onRetry={() => void query.refetch()} />
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Toggle
            variant="outline"
            size="sm"
            pressed={paused}
            onPressedChange={setPaused}
            aria-label={paused ? 'Resume live updates' : 'Pause live updates'}
            className="h-8 gap-1.5"
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </Toggle>
        ) : null}
        <Toggle variant="outline" size="sm" pressed={follow} onPressedChange={setFollow} className="h-8">Follow newest</Toggle>
        <Toggle variant="outline" size="sm" pressed={wrap} onPressedChange={setWrap} className="h-8 gap-1.5">
          <WrapText className="size-3.5" /> Wrap
        </Toggle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={lines.length === 0}
          onClick={() => {
            void navigator.clipboard.writeText(lines.join('\n')).then(() => {
              setCopied(true)
              window.setTimeout(() => { setCopied(false) }, 1500)
            })
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={lines.length === 0}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }))
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = `deployment-${deploymentId.slice(0, 8)}-logs.txt`
            anchor.click()
            URL.revokeObjectURL(url)
          }}
        >
          <Download className="size-3.5" /> Download
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`size-3.5 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} /> Refresh
        </Button>
        <span className="ml-auto text-sm text-muted-foreground" role="status">
          {query.isLoading ? 'Loading…' : `${String(logs.length)} line${logs.length === 1 ? '' : 's'}${query.data?.hasMore ? ' (first 500)' : ''}`}
        </span>
      </div>

      {!query.isLoading && logs.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={running ? 'No output yet' : 'No output was recorded for this run'}
          description={running ? 'The run has started but has not written any log line yet. This view refreshes on its own.' : 'The build and deploy steps of this run did not write any log line.'}
          compact
        />
      ) : (
        <div
          ref={viewportRef}
          tabIndex={0}
          role="log"
          aria-label="Deployment logs"
          className={`max-h-96 overflow-auto rounded-md border border-border/60 bg-[#070b14] p-3 font-mono text-xs ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
        >
          {logs.map((l, index) => (
            <p key={l.id} className={LEVEL_CLASS[l.level] ?? 'text-slate-100'}>
              <span className="text-slate-400">{lines[index]?.slice(0, formatDateTime(l.timestamp).length)}</span>{' '}
              <span className="uppercase">[{l.level}]</span> {l.phase ? <span className="text-sky-300">[{l.phase}] </span> : null}
              {l.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
