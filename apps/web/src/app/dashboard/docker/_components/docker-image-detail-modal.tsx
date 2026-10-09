'use client'

import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useOnDepsChange } from '../_hooks/use-on-deps-change'
import { useDockerImageInspect, useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import { dockerImageInspectDetailSchema } from '@repo/contracts-entities'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { toast } from 'sonner'
import { DockerConfirmDialog } from './docker-confirm-dialog'
import { DockerEngineError } from './docker-engine-error'
import { DockerDetailLoadingState } from './docker-loading-states'
import { DockerCopyableId } from './docker-copy-button'
import { ImageDetailActions, type ImageQueuedOp } from './image-detail-modal/image-detail-actions'
import { ImageLabelsTab } from './image-detail-modal/labels-tab'
import { ImageLayersTab } from './image-detail-modal/layers-tab'
import { ImageOverviewTab } from './image-detail-modal/overview-tab'
import { buildLayerRiskById } from './image-detail-modal/scan-model'
import { SecurityTab } from './image-detail-modal/security-tab'
import { useImageScanSession } from './image-detail-modal/use-image-scan-session'

type DockerImageModalTab = 'overview' | 'layers' | 'security' | 'labels'

interface DockerImageDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: DockerImageModalTab
}

interface DockerImageDetailModalProps {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunImage?: (imageRef: string) => void
  initialTab?: DockerImageModalTab
}

const TAB_PANEL_CLASS = 'flex min-h-0 flex-col gap-3 text-sm'

function DockerImageDetailContent({ id, open, onOpenChange, onRunImage, initialTab = 'overview' }: DockerImageDetailModalProps) {
  const [activeTab, setActiveTab] = useState<DockerImageModalTab>(initialTab)
  const [opsNotice, setOpsNotice] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const snapshotQuery = useDockerRuntimeEntityDetail('images', id, { enabled: open })
  const detail = snapshotQuery.data
  const inspectQuery = useDockerImageInspect({ query: { imageId: id } }, { enabled: open })

  const inspectDetail = useMemo(() => {
    const parsed = dockerImageInspectDetailSchema.safeParse(inspectQuery.data)
    return parsed.success ? parsed.data : null
  }, [inspectQuery.data])

  const refetchInspect = inspectQuery.refetch
  const session = useImageScanSession({
    id,
    open,
    securityTabActive: activeTab === 'security',
    inspectDetail,
    refetchInspect,
    onNotice: setOpsNotice,
  })
  const { hasCompletedScan, hasCriticalOrHigh, vulnerabilities } = session

  const inspectLayers = inspectDetail?.layers
  const layers = useMemo(() => inspectLayers ?? [], [inspectLayers])
  const layerRiskById = useMemo(() => buildLayerRiskById(layers, vulnerabilities), [layers, vulnerabilities])
  const unmappedVulnerabilityCount = useMemo(() => {
    const mapped = Array.from(layerRiskById.values()).reduce((sum, risk) => sum + risk.findings.length, 0)
    return Math.max(0, vulnerabilities.length - mapped)
  }, [layerRiskById, vulnerabilities.length])

  const imageRef = useMemo(() => {
    const source = inspectDetail ?? detail
    if (!source) return id
    const base = `${source.registry}/${source.repository}`
    return source.tag ? `${base}:${source.tag}` : base
  }, [detail, id, inspectDetail])

  useOnDepsChange([initialTab, open], () => { if (open) setActiveTab(initialTab) })

  useOnDepsChange([id, open], () => { setOpsNotice(null) })

  useDockerLiveRefetch({
    on: { image: ['pull', 'create', 'import', 'load', 'tag', 'untag', 'push', 'delete', 'prune'] },
    onData: () => { void refetchInspect() },
    enabled: open,
    debounceMs: 650,
  })

  const rescan = useCallback((): void => {
    setActiveTab('security')
    setOpsNotice('Manual image rescan requested.')
    session.startScan()
  }, [session])

  function handleRun(): void {
    if (!hasCompletedScan) {
      setActiveTab('security')
      setOpsNotice('Run blocked: the first security scan has not finished yet.')
      toast.info('Scan not ready yet', { description: imageRef })
      return
    }

    if (hasCriticalOrHigh) {
      setActiveTab('security')
      setOpsNotice('Run blocked by policy: critical or high vulnerabilities were found.')
      toast.error('Run blocked by vulnerability policy', { description: `Critical/high findings detected for ${imageRef}` })
      return
    }

    onRunImage?.(imageRef)
    toast.info('Run setup opened', { description: imageRef })
    onOpenChange(false)
  }

  function queueImageOp(action: ImageQueuedOp | 'remove'): void {
    setOpsNotice(`${action} queued for ${inspectDetail?.repository ?? detail?.repository ?? id}`)
    toast.success(`${action} queued`, { description: imageRef })
  }

  const containerCount = inspectDetail?.usedByContainerIds.length ?? 0
  const removeConsequence = containerCount > 0
    ? `${String(containerCount)} container${containerCount === 1 ? ' uses' : 's use'} this image and will fail to restart. Layers not shared with other images are deleted from this node.`
    : 'Layers not shared with other images are deleted from this node, and pulling it again re-downloads them.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[96vw]! max-w-350! flex-col overflow-hidden">
        <DialogHeader className="gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="break-all font-mono text-base">{imageRef === id ? 'Image' : imageRef}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex items-center gap-1 text-xs">
                  <span>Image ID</span>
                  <DockerCopyableId value={id} short={id.replace(/^sha256:/u, '').slice(0, 12)} label="image ID" />
                </div>
              </DialogDescription>
            </div>
            <ImageDetailActions
              canRescan={hasCompletedScan}
              onRun={handleRun}
              onRescan={rescan}
              onQueueOp={queueImageOp}
              onRemove={() => { setConfirmRemove(true) }}
            />
          </div>
          {opsNotice ? <p role="status" className="text-xs text-muted-foreground">{opsNotice}</p> : null}
        </DialogHeader>

        {detail ? (
          <Tabs
            value={activeTab}
            onValueChange={(value: string) => { setActiveTab(value as DockerImageModalTab) }}
            className="flex min-h-0 w-full flex-1 flex-col **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:overflow-auto"
          >
            <TabsList aria-label="Image detail sections" className="flex h-auto w-full shrink-0 flex-nowrap items-center justify-start gap-1 overflow-x-auto">
              <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
              <TabsTrigger className="shrink-0" value="layers">Layers</TabsTrigger>
              <TabsTrigger className="shrink-0" value="security">Security</TabsTrigger>
              <TabsTrigger className="shrink-0" value="labels">Labels</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className={TAB_PANEL_CLASS}>
              <ImageOverviewTab imageId={id} inspect={inspectDetail} snapshot={detail} />
            </TabsContent>
            <TabsContent value="layers" className={TAB_PANEL_CLASS}>
              <ImageLayersTab
                layers={layers}
                layerRiskById={layerRiskById}
                hasCompletedScan={hasCompletedScan}
                unmappedVulnerabilityCount={unmappedVulnerabilityCount}
              />
            </TabsContent>
            <TabsContent value="security" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden! text-sm">
              <SecurityTab key={id} imageRef={imageRef} session={session} inspectError={inspectQuery.error} onRescan={rescan} />
            </TabsContent>
            <TabsContent value="labels" className={TAB_PANEL_CLASS}>
              <ImageLabelsTab labels={detail.labels} />
            </TabsContent>
          </Tabs>
        ) : snapshotQuery.error ? (
          <DockerEngineError what="this image" error={snapshotQuery.error} onRetry={() => { void snapshotQuery.refetch() }} isRetrying={snapshotQuery.isFetching} />
        ) : snapshotQuery.isLoading ? (
          <DockerDetailLoadingState label="Loading image details…" />
        ) : (
          <p className="text-sm text-muted-foreground">This image no longer exists on the node. It may have been removed or replaced by a newer build.</p>
        )}

        <DialogFooter className="pt-2">
          <Button className="h-8" type="button" variant="outline" onClick={() => { onOpenChange(false) }}>Close</Button>
        </DialogFooter>

        <DockerConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title="Remove this image?"
          objectName={imageRef}
          consequence={removeConsequence}
          confirmLabel="Remove image"
          onConfirm={() => {
            setConfirmRemove(false)
            queueImageOp('remove')
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

export function DockerImageDetailModal({ id, open, onOpenChange, onRunImage, initialTab = 'overview' }: DockerImageDetailModalProps) {
  return <DockerImageDetailContent id={id} open={open} onOpenChange={onOpenChange} onRunImage={onRunImage} initialTab={initialTab} />
}

export function DockerImageDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerImageDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={className ?? 'text-left underline-offset-4 hover:underline'} onClick={() => { setOpen(true) }}>
        {children}
      </button>
      {open ? <DockerImageDetailContent id={id} open={open} onOpenChange={setOpen} initialTab={initialTab} /> : null}
    </>
  )
}
