'use client'

import { Loader2, Play } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { DockerNodeBadge, useDockerNode } from './docker-node-context'
import { ContainerConfigStage } from './create-container-modal/container-config-stage'
import { ImageStage, PullStage, ScanStage } from './create-container-modal/image-stages'
import { StageTabs } from './create-container-modal/stage-tabs'
import { useContainerForm } from './create-container-modal/use-container-form'
import { useCreateContainerSubmit } from './create-container-modal/use-create-container-submit'
import { useImageCatalog } from './create-container-modal/use-image-catalog'
import { usePullScanFlow } from './create-container-modal/use-pull-scan-flow'
import type { DockerCreateContainerPayload } from './create-container-modal/container-form.model'

interface DockerCreateContainerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefilledImage?: string
  autoPull?: boolean
  skipPullTab?: boolean
  pullScanOnly?: boolean
  onCreated?: (payload: DockerCreateContainerPayload) => void
}

/**
 * Create a container (or only pull and scan an image) on this node:
 * Image -> Pull -> Scan -> Container configuration.
 */
export function DockerCreateContainerModal({
  open,
  onOpenChange,
  prefilledImage,
  autoPull = false,
  skipPullTab = false,
  pullScanOnly = false,
  onCreated,
}: DockerCreateContainerModalProps) {
  const { nodeName } = useDockerNode()
  const form = useContainerForm(open, prefilledImage)
  const image = form.state.image
  const catalog = useImageCatalog(image)
  const flow = usePullScanFlow({ open, image, selectedImageEntity: catalog.selectedImageEntity, prefilledImage, autoPull, skipPullTab, pullScanOnly })
  const { submit, submitting, blockReason } = useCreateContainerSubmit({ form, flow, onCreated, onOpenChange })

  const isBusy = submitting || flow.isRunning
  const { activeStage } = flow
  const showWarning = ((activeStage === 'container' && flow.showContainerStage) || (pullScanOnly && activeStage === 'scan')) && flow.hasCriticalOrHigh

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen || !isBusy) onOpenChange(nextOpen) }}>
      <DialogContent
        className="flex h-[85vh] max-h-[85vh] w-[95vw] max-w-7xl! flex-col overflow-hidden p-0 sm:w-[85vw]"
        onEscapeKeyDown={(event) => { if (isBusy) event.preventDefault() }}
        onInteractOutside={(event) => { if (isBusy) event.preventDefault() }}
      >
        <DialogHeader className="shrink-0 border-b bg-muted/25 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <DialogTitle>{pullScanOnly ? 'Pull and scan image' : 'Create container'}</DialogTitle>
              <DialogDescription>
                {pullScanOnly
                  ? `Choose an image, pull its layers, then scan it for vulnerabilities on ${nodeName}.`
                  : `Pull the image if needed, scan it, then configure the container. It is created on ${nodeName}.`}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <DockerNodeBadge />
              <Badge variant="outline" role="status">{flow.stageBadge}</Badge>
            </div>
          </div>
        </DialogHeader>

        {!skipPullTab ? <StageTabs flow={flow} hasImage={image.trim().length > 0} /> : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeStage === 'image' ? (
            <div className="h-full px-5 py-4">
              <ImageStage
                image={image}
                onImageChange={(value) => { form.setField('image', value) }}
                suggestions={catalog.suggestions}
                flow={flow}
                nodeName={nodeName}
                catalogError={catalog.catalogError}
                onRetryCatalog={catalog.refetchCatalog}
              />
            </div>
          ) : null}
          {activeStage === 'pulling' ? <div className="h-full px-5 py-4"><PullStage image={image} flow={flow} /></div> : null}
          {activeStage === 'scan' ? <div className="h-full px-5 py-4"><ScanStage flow={flow} /></div> : null}
          {activeStage === 'container' && flow.showContainerStage ? (
            <div className="h-full overflow-y-auto px-5 py-4">
              <ContainerConfigStage form={form} flow={flow} networkOptions={catalog.networkOptions} />
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between border-t bg-muted/20 px-5 py-3 sm:justify-between">
          <div className="min-w-0 space-y-0.5 text-xs">
            {showWarning ? <p className="text-amber-600 dark:text-amber-400">Critical or high vulnerabilities found. Review them before deploying.</p> : null}
            {flow.showContainerStage && blockReason ? <p className="text-muted-foreground">{blockReason}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false) }} disabled={isBusy}>
              {pullScanOnly ? 'Close' : 'Cancel'}
            </Button>
            {flow.showContainerStage ? (
              <Button type="button" onClick={submit} disabled={blockReason !== null}>
                {submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play aria-hidden="true" />}
                {submitting ? 'Creating…' : form.state.startAfterCreate ? 'Create and start container' : 'Create container'}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
