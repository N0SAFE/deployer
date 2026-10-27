'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@deployer/ui/components/shadcn/tabs'
import { DockerContainerDetailModalTrigger } from './container-detail-modal'
import { DockerCopyButton } from './docker-copy-button'
import { DockerDetailLoadingState } from './docker-loading-states'
import { DockerKeyValueGrid } from './docker-key-value-grid'
import { DockerRelativeTime } from './docker-relative-time'
import { describeNetwork, isBuiltInNetwork } from '../networks/_utils/networks'
import { shortId } from '../_utils/format'

type NetworkTab = 'overview' | 'containers' | 'labels'

interface DockerNetworkDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: NetworkTab
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}

export function DockerNetworkDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerNetworkDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<NetworkTab>(initialTab)
  const detailQuery = useDockerRuntimeEntityDetail('networks', id, { enabled: open })
  const detail = detailQuery.data
  const isDetailLoading = detailQuery.isLoading && !detail
  // Observations come only from what the engine reported; nothing is estimated.
  const observations = useMemo(() => (detail ? describeNetwork(detail) : []), [detail])
  const labels = Object.entries(detail?.labels ?? {})

  return (
    <>
      <button
        type="button"
        className={className ?? 'text-left underline-offset-4 hover:underline'}
        onClick={() => {
          setActiveTab(initialTab)
          setOpen(true)
        }}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] max-h-[85vh] w-[96vw]! max-w-350! flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Network {detail ? <code className="font-mono">{detail.name}</code> : null}
              {detail && isBuiltInNetwork(detail.name) ? <Badge variant="outline">built-in</Badge> : null}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1 font-mono text-xs break-all">
              {id}
              <DockerCopyButton value={id} label="network ID" />
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <Tabs
              value={activeTab}
              onValueChange={(value) => { setActiveTab(value as NetworkTab) }}
              className="flex min-h-0 w-full flex-1 flex-col **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:overflow-auto"
            >
              <TabsList className="flex h-auto w-full shrink-0 flex-nowrap items-center justify-start gap-1 overflow-x-auto">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="containers">Containers ({detail.containerIds.length})</TabsTrigger>
                <TabsTrigger className="shrink-0" value="labels">Labels ({labels.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3 text-sm">
                <DockerKeyValueGrid
                  items={[
                    { key: 'Name', value: detail.name, mono: true },
                    { key: 'Driver', value: detail.driver },
                    { key: 'Scope', value: detail.scope },
                    { key: 'Subnet', value: detail.subnet ?? '—', mono: true, copyValue: detail.subnet ?? undefined },
                    { key: 'Gateway', value: detail.gateway ?? '—', mono: true, copyValue: detail.gateway ?? undefined },
                    { key: 'Internal', value: yesNo(detail.internal) },
                    { key: 'Attachable', value: yesNo(detail.attachable) },
                    { key: 'Created', value: <DockerRelativeTime value={detail.createdAt} /> },
                  ]}
                />
                {observations.length > 0 ? (
                  <ul className="list-disc space-y-1 rounded border bg-muted/20 p-3 pl-7 text-muted-foreground">
                    {observations.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                ) : null}
              </TabsContent>

              <TabsContent value="containers" className="space-y-2 text-sm">
                {detail.containerIds.length > 0 ? (
                  <ul className="divide-y rounded border">
                    {detail.containerIds.map((containerId) => (
                      <li key={containerId} className="flex items-center justify-between gap-2 p-3">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <DockerContainerDetailModalTrigger id={containerId} className="font-mono text-xs underline-offset-4 hover:underline">
                            {shortId(containerId)}
                          </DockerContainerDetailModalTrigger>
                          <DockerCopyButton value={containerId} label="container ID" />
                        </span>
                        <Badge variant="outline">attached</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">No containers are attached. This network is unused.</p>
                )}
              </TabsContent>

              <TabsContent value="labels" className="space-y-2 text-sm">
                {labels.length > 0 ? labels.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded border p-3">
                    <span className="text-muted-foreground">{key}</span>
                    <code className="font-mono text-xs break-all">{value}</code>
                  </div>
                )) : <p className="text-muted-foreground">This network has no labels.</p>}
              </TabsContent>
            </Tabs>
          ) : isDetailLoading ? (
            <DockerDetailLoadingState label="Loading network details…" />
          ) : (
            <p className="text-sm text-muted-foreground">This network is no longer reported by the engine. It may have been removed.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setOpen(false) }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
