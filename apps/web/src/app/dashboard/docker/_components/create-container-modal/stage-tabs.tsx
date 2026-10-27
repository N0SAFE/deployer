'use client'

import { Download, Loader2, Search, Shield } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { cn } from '@/lib/utils'
import type { Stage } from './pull-scan.model'
import type { PullScanFlow } from './use-pull-scan-flow'

const TAB = 'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring'

function tabClass(active: boolean): string {
  return cn(TAB, active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')
}

/** Step navigation: Image -> Pulling -> Scan -> Container. */
export function StageTabs({ flow, hasImage }: { flow: PullScanFlow; hasImage: boolean }) {
  const { activeStage, setActiveStage } = flow
  const go = (stage: Stage) => () => { setActiveStage(stage) }
  return (
    <div role="group" aria-label="Steps" className="flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-muted/10 px-5">
      <button type="button" aria-current={activeStage === 'image' ? 'step' : undefined} className={tabClass(activeStage === 'image')} onClick={go('image')}>
        <Search className="size-4" aria-hidden="true" /> 1. Image
      </button>
      <span aria-hidden="true" className="text-muted-foreground/60">→</span>
      <button type="button" disabled={!hasImage} aria-current={activeStage === 'pulling' ? 'step' : undefined} className={tabClass(activeStage === 'pulling')} onClick={go('pulling')}>
        <Download className="size-4" aria-hidden="true" /> 2. Pull
        {flow.pullStatus === 'pulling' ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-label="in progress" /> : null}
        {flow.pullStatus === 'complete' ? <Badge variant="default">done</Badge> : null}
      </button>
      <span aria-hidden="true" className="text-muted-foreground/60">→</span>
      <button type="button" disabled={!flow.canOpenScan} aria-current={activeStage === 'scan' ? 'step' : undefined} className={tabClass(activeStage === 'scan')} onClick={go('scan')}>
        <Shield className="size-4" aria-hidden="true" /> 3. Scan
        {flow.scanStatus === 'scanning' ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-label="in progress" /> : null}
        {flow.scanStatus === 'complete' ? <Badge variant={flow.hasCriticalOrHigh ? 'destructive' : 'default'}>done</Badge> : null}
      </button>
      {flow.showContainerStage ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground/60">→</span>
          <button type="button" disabled={!flow.canOpenContainer} aria-current={activeStage === 'container' ? 'step' : undefined} className={tabClass(activeStage === 'container')} onClick={go('container')}>
            4. Container
          </button>
        </>
      ) : null}
    </div>
  )
}
