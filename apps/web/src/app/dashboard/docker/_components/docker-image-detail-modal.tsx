'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { getDockerEntityDetail } from '@/domains/docker/mock-hooks'
import { getMockImageLayers, getMockImageVulnerabilities } from '@/mocks/platform/entities/docker.large.mock'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { ChevronDown, ChevronRight, Download, Play, ScanSearch, Tag, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { DockerModalQuickActions } from './docker-modal-quick-actions'

interface DockerImageDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
}

interface DockerImageDetailModalProps {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunImage?: (imageRef: string) => void
}

interface DockerImageDetailContentProps {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunImage?: (imageRef: string) => void
}

function DockerImageDetailContent({ id, open, onOpenChange, onRunImage }: DockerImageDetailContentProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)
  const [opsNotice, setOpsNotice] = useState<string | null>(null)
  const detail = useMemo(() => getDockerEntityDetail('images', id).image, [id])
  const layers = useMemo(() => getMockImageLayers(id), [id])
  const vulns = useMemo(() => getMockImageVulnerabilities(id), [id])

  function layerStatus(layerId: string): 'verified' | 'cached' | 'warning' | 'pending' {
    let hash = 0
    for (let i = 0; i < layerId.length; i += 1) hash = (hash * 31 + layerId.charCodeAt(i)) >>> 0
    const hasHighRisk = vulns.some((entry) => entry.severity === 'critical' || entry.severity === 'high')
    if (hasHighRisk && hash % 4 === 0) return 'warning'
    if (hash % 5 === 0) return 'pending'
    if (hash % 3 === 0) return 'cached'
    return 'verified'
  }

  function layerStatusVariant(status: 'verified' | 'cached' | 'warning' | 'pending'): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'verified') return 'default'
    if (status === 'cached') return 'secondary'
    if (status === 'warning') return 'destructive'
    return 'outline'
  }

  function queueImageOp(action: string): void {
    setOpsNotice(`${action} queued for ${detail?.repository ?? id}`)
    toast.success(`${action} queued`, {
      description: detail ? `${detail.registry}/${detail.repository}${detail.tag ? `:${detail.tag}` : ''}` : id,
    })
  }

  function buildImageRef(): string {
    if (!detail) return id
    const repositoryBase = `${detail.registry}/${detail.repository}`
    return detail.tag ? `${repositoryBase}:${detail.tag}` : repositoryBase
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw]! max-w-350! h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>Image details</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">{id}</DialogDescription>
            </div>
            <DockerModalQuickActions
              actions={[
                {
                  label: 'Run',
                  icon: Play,
                  onClick: () => {
                    onRunImage?.(buildImageRef())
                    toast.info('Run setup opened', {
                      description: buildImageRef(),
                    })
                    onOpenChange(false)
                  },
                },
                { label: 'Pull', icon: Download, onClick: () => queueImageOp('pull') },
                { label: 'Tag', icon: Tag, onClick: () => queueImageOp('tag') },
                { label: 'Push', icon: Upload, onClick: () => queueImageOp('push') },
                { label: 'Scan', icon: ScanSearch, onClick: () => queueImageOp('scan') },
                { label: 'Export', icon: Download, onClick: () => queueImageOp('export') },
              ]}
              dangerAction={{ label: 'Remove', icon: Trash2, onClick: () => queueImageOp('remove') }}
            />
          </div>
          {opsNotice ? <p className="text-xs text-muted-foreground">{opsNotice}</p> : null}
        </DialogHeader>
        {detail ? (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full flex-1 min-h-0 flex flex-col **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:overflow-auto"
          >
            <TabsList className="flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto h-auto shrink-0">
              <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
              <TabsTrigger className="shrink-0" value="layers">Layers</TabsTrigger>
              <TabsTrigger className="shrink-0" value="security">Security</TabsTrigger>
              <TabsTrigger className="shrink-0" value="labels">Labels</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="flex min-h-0 flex-col gap-3 text-sm">
              <dl className="grid gap-3 md:grid-cols-2">
                <div><dt className="text-muted-foreground">Registry</dt><dd>{detail.registry}</dd></div>
                <div><dt className="text-muted-foreground">Repository</dt><dd className="break-all">{detail.repository}</dd></div>
                <div><dt className="text-muted-foreground">Tag</dt><dd>{detail.tag ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">Digest</dt><dd className="font-mono text-xs break-all">{detail.digest ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">Size</dt><dd>{detail.sizeBytes === null ? '—' : `${detail.sizeBytes} bytes`}</dd></div>
                <div><dt className="text-muted-foreground">Last seen</dt><dd>{detail.lastSeenAt}</dd></div>
              </dl>
            </TabsContent>

            <TabsContent value="layers" className="flex min-h-0 flex-col gap-2 text-sm">
              <div className="flex-1 min-h-0 rounded border divide-y overflow-auto">
                {layers.map((layer) => (
                  <div key={layer.id} className="p-2">
                    {/** Dockhand-style layer row with status metadata */}
                    <button
                      type="button"
                      className="w-full rounded-sm px-2 py-1.5 transition-colors hover:bg-muted/60"
                      onClick={() => setExpandedLayerId((previous) => (previous === layer.id ? null : layer.id))}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {expandedLayerId === layer.id ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <p className="font-mono text-xs break-all text-left">{layer.instruction}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={layerStatusVariant(layerStatus(layer.id))}>{layerStatus(layer.id)}</Badge>
                          <Badge variant="outline">{layer.size}</Badge>
                        </div>
                      </div>
                    </button>
                    {expandedLayerId === layer.id ? (
                      <div className="mt-2 rounded border bg-muted/20 p-2 text-xs">
                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            <p className="text-muted-foreground">Layer ID</p>
                            <code className="break-all">{layer.id}</code>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Created</p>
                            <p>{layer.createdAt}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Status</p>
                            <Badge variant={layerStatusVariant(layerStatus(layer.id))}>{layerStatus(layer.id)}</Badge>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Risk context</p>
                            <p>{vulns.length} known vulnerability entries in image</p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="text-muted-foreground">Instruction</p>
                            <p className="font-mono break-all">{layer.instruction}</p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="security" className="flex min-h-0 flex-col gap-2 text-sm">
              <div className="flex-1 min-h-0 rounded border divide-y overflow-auto">
                {vulns.map((v) => (
                  <div key={v.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs font-mono">{v.id}</code>
                      <Badge variant={v.severity === 'critical' || v.severity === 'high' ? 'destructive' : 'outline'}>{v.severity}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{v.packageName} {v.currentVersion} → {v.fixedVersion ?? 'no fix yet'}</p>
                    <p>{v.description}</p>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="labels" className="flex min-h-0 flex-col gap-2 text-sm">
              {Object.entries(detail.labels).length > 0 ? Object.entries(detail.labels).map(([key, value]) => (
                <div key={key} className="rounded border p-3 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{key}</span>
                  <code className="text-xs font-mono break-all">{value}</code>
                </div>
              )) : <p className="text-muted-foreground">No labels on this image.</p>}
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground">Image not found.</p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DockerImageDetailModal({ id, open, onOpenChange, onRunImage }: DockerImageDetailModalProps) {
  return <DockerImageDetailContent id={id} open={open} onOpenChange={onOpenChange} onRunImage={onRunImage} />
}

export function DockerImageDetailModalTrigger({ id, children, className }: DockerImageDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={className ?? 'underline-offset-4 hover:underline text-left'} onClick={() => setOpen(true)}>
        {children}
      </button>
      <DockerImageDetailContent id={id} open={open} onOpenChange={setOpen} />
    </>
  )
}