'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import type { DockerFileEntry } from '@repo/contracts-entities'
import { DockerContainerDetailModalTrigger } from './container-detail-modal'
import { DockerCopyButton } from './docker-copy-button'
import { DockerFileBrowser } from './docker-file-browser'
import { DockerKeyValueGrid } from './docker-key-value-grid'
import { DockerDetailLoadingState } from './docker-loading-states'
import { DockerRelativeTime } from './docker-relative-time'
import { formatBytes, shortId } from '../_utils/format'

type VolumeTab = 'overview' | 'usage' | 'files' | 'labels'

interface DockerVolumeDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: VolumeTab
}

/** Metadata-only preview: volume file contents are not read by the dashboard, so none is invented. */
function describeFile(file: DockerFileEntry): string {
  return [
    `Path: ${file.path}`,
    `Owner: ${file.owner}`,
    `Permissions: ${file.permissions}`,
    `Updated: ${file.updatedAt}`,
    '',
    'File contents are not available for volumes yet.',
  ].join('\n')
}

export function DockerVolumeDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerVolumeDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<VolumeTab>(initialTab)
  const [currentPath, setCurrentPath] = useState('/')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const detailQuery = useDockerRuntimeEntityDetail('volumes', id, { enabled: open })
  const detail = detailQuery.data
  const isDetailLoading = detailQuery.isLoading && !detail

  const files = useMemo<DockerFileEntry[]>(() => {
    const rawFiles = (detail as { files?: unknown } | null)?.files
    return Array.isArray(rawFiles) ? (rawFiles as DockerFileEntry[]) : []
  }, [detail])
  const labels = Object.entries(detail?.labels ?? {})
  const usedBy = detail?.usedByContainerIds ?? []

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
              Volume {detail ? <code className="font-mono break-all">{detail.name}</code> : null}
              {detail ? (
                <Badge variant={usedBy.length > 0 ? 'default' : 'outline'}>
                  {usedBy.length > 0 ? `used by ${String(usedBy.length)} container${usedBy.length === 1 ? '' : 's'}` : 'unused'}
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1 font-mono text-xs break-all">
              {id}
              <DockerCopyButton value={id} label="volume ID" />
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <Tabs
              value={activeTab}
              onValueChange={(value) => { setActiveTab(value as VolumeTab) }}
              className="flex min-h-0 w-full flex-1 flex-col **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:overflow-auto"
            >
              <TabsList className="flex h-auto w-full shrink-0 flex-nowrap items-center justify-start gap-1 overflow-x-auto">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="usage">Usage ({usedBy.length})</TabsTrigger>
                <TabsTrigger className="shrink-0" value="files">Files</TabsTrigger>
                <TabsTrigger className="shrink-0" value="labels">Labels ({labels.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3 text-sm">
                <DockerKeyValueGrid
                  items={[
                    { key: 'Name', value: detail.name, mono: true, copyValue: detail.name },
                    { key: 'Driver', value: detail.driver },
                    { key: 'Mountpoint', value: detail.mountpoint ?? '—', mono: true, copyValue: detail.mountpoint ?? undefined },
                    { key: 'Size', value: formatBytes(detail.sizeBytes) },
                    { key: 'Used by', value: usedBy.length === 0 ? 'no containers' : `${String(usedBy.length)} container${usedBy.length === 1 ? '' : 's'}` },
                    { key: 'Created', value: <DockerRelativeTime value={detail.createdAt} /> },
                    { key: 'Updated', value: <DockerRelativeTime value={detail.updatedAt} /> },
                  ]}
                />
                {usedBy.length > 0 ? (
                  <p className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-muted-foreground">
                    Containers are using this volume. Removing a volume permanently deletes its data, so stop and remove those containers first.
                  </p>
                ) : null}
              </TabsContent>

              <TabsContent value="usage" className="space-y-2 text-sm">
                {usedBy.length > 0 ? (
                  <ul className="divide-y rounded border">
                    {usedBy.map((containerId) => (
                      <li key={containerId} className="flex items-center justify-between gap-2 p-3">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <DockerContainerDetailModalTrigger id={containerId} className="font-mono text-xs underline-offset-4 hover:underline">
                            {shortId(containerId)}
                          </DockerContainerDetailModalTrigger>
                          <DockerCopyButton value={containerId} label="container ID" />
                        </span>
                        <Badge variant="outline">mounted</Badge>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-muted-foreground">No containers mount this volume.</p>}
              </TabsContent>

              <TabsContent value="files" className="space-y-2 text-sm">
                <DockerFileBrowser
                  files={files}
                  currentPath={currentPath}
                  selectedFilePath={selectedFilePath}
                  notice={`Volume root on the host: ${detail.mountpoint ?? 'unknown'}`}
                  emptyMessage="No file listing is available for this volume: the engine does not report its contents."
                  onCurrentPathChange={setCurrentPath}
                  onSelectedFilePathChange={setSelectedFilePath}
                  getFilePreviewContent={describeFile}
                />
              </TabsContent>

              <TabsContent value="labels" className="space-y-2 text-sm">
                {labels.length > 0 ? labels.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded border p-3">
                    <span className="text-muted-foreground">{key}</span>
                    <code className="font-mono text-xs break-all">{value}</code>
                  </div>
                )) : <p className="text-muted-foreground">This volume has no labels.</p>}
              </TabsContent>
            </Tabs>
          ) : isDetailLoading ? (
            <DockerDetailLoadingState label="Loading volume details…" />
          ) : (
            <p className="text-sm text-muted-foreground">This volume is no longer reported by the engine. It may have been removed.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setOpen(false) }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
