'use client'

import { Download, Loader2 } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { DockerImagePullProgressPanel } from '../docker-image-pull-progress-panel'
import { DockerScanStackPanel } from '../docker-scan-stack-panel'
import { titleCaseStage, toClock } from './pull-scan.model'
import type { ImageSuggestion } from './use-image-catalog'
import type { PullScanFlow } from './use-pull-scan-flow'

function PullButton({ flow, hasImage, label }: { flow: PullScanFlow; hasImage: boolean; label: string }) {
  const pulling = flow.pullStatus === 'pulling'
  return (
    <Button type="button" onClick={() => { flow.startPull() }} disabled={!hasImage || pulling}>
      {pulling ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download aria-hidden="true" />}
      {pulling ? 'Pulling image…' : label}
    </Button>
  )
}

/** Step 1: choose or type the image reference; suggestions come from images already on this node. */
export function ImageStage({ image, onImageChange, suggestions, flow, nodeName, catalogError, onRetryCatalog }: {
  image: string
  onImageChange: (value: string) => void
  suggestions: ImageSuggestion[]
  flow: PullScanFlow
  nodeName: string
  catalogError: boolean
  onRetryCatalog: () => void
}) {
  const hasImage = image.trim().length > 0
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="ccm-stage-image">Image</Label>
        <Input id="ccm-stage-image" value={image} className="font-mono" onChange={(event) => { onImageChange(event.target.value) }} placeholder="ghcr.io/org/app:latest" />
        <p className="text-xs text-muted-foreground">Only images already known to {nodeName}&apos;s engine can be pulled and scanned from here.</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-background/80 p-2 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">Images on this node</h3>
          <Badge variant="outline">{suggestions.length} matches</Badge>
        </div>
        {catalogError ? (
          <p role="alert" className="p-3 text-destructive">
            Could not list images from the engine. <Button type="button" variant="link" className="h-auto p-0" onClick={onRetryCatalog}>Retry</Button>
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto rounded border">
          {suggestions.length > 0 ? (
            <ul className="divide-y">
              {suggestions.map((suggestion) => {
                const selected = image === suggestion.imageRef
                return (
                  <li key={suggestion.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 ${selected ? 'bg-primary/5' : ''}`}
                      onClick={() => { onImageChange(suggestion.imageRef) }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs">{suggestion.repositoryBase}</span>
                        <span className="text-xs text-muted-foreground">tag: {suggestion.tag}</span>
                      </span>
                      <Badge variant={selected ? 'default' : 'secondary'}>{selected ? 'Selected' : 'Select'}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="p-3 text-muted-foreground">{hasImage ? 'No image on this node matches what you typed.' : 'No images on this node yet.'}</p>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <PullButton flow={flow} hasImage={hasImage} label="Pull and scan" />
        <Button type="button" variant="outline" disabled={!hasImage} onClick={() => { flow.setActiveStage('pulling') }}>View pull details</Button>
      </div>
    </div>
  )
}

/** Step 2: pull progress. */
export function PullStage({ image, flow }: { image: string; flow: PullScanFlow }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <DockerImagePullProgressPanel
        image={image}
        pullStatus={flow.pullStatus}
        pullProgress={flow.pullProgress}
        pullErrorMessage={flow.pullErrorMessage}
        pullRuntimeEventCount={flow.pullRuntimeEventCount}
        pullLayers={flow.pullLayers}
        pullTimelineRows={flow.pullTimelineRows}
        toClock={toClock}
      />
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <PullButton flow={flow} hasImage={image.trim().length > 0} label="Start pull" />
        <Button type="button" variant="outline" disabled={!flow.canOpenScan} onClick={() => { flow.setActiveStage('scan') }}>Continue to scan</Button>
      </div>
    </div>
  )
}

/** Step 3: vulnerability scan. */
export function ScanStage({ flow }: { flow: PullScanFlow }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <DockerScanStackPanel
        scanStatus={flow.scanStatus}
        scanProgress={flow.scanProgress}
        scanErrorMessage={flow.scanErrorMessage}
        scanVulns={flow.scanVulns}
        scanStageSummaryRows={flow.scanStageSummaryRows}
        scannerPullRows={flow.scannerPullRows}
        scanSourceStreams={flow.scanSourceStreams}
        scanFindings={flow.scanFindings}
        rawScanLines={flow.rawScanLines}
        canStartScan={flow.canOpenScan}
        onStartScan={() => { flow.startScan() }}
        titleCaseStage={titleCaseStage}
        toClock={toClock}
      />
      {flow.showContainerStage ? (
        <div className="mt-auto">
          <Button type="button" variant="outline" disabled={flow.scanStatus !== 'complete'} onClick={() => { flow.setActiveStage('container') }}>Continue to configuration</Button>
        </div>
      ) : null}
    </div>
  )
}
