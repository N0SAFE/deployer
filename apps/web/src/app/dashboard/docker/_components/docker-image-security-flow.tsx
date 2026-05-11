'use client'

import { Badge } from '@repo/ui/components/shadcn/badge'
import { Download, Loader2, ScrollText, Shield } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { DockerFlowTabGroup, type DockerFlowTabItem } from './docker-flow-tab-group'

export type DockerImageSecurityFlowStage = 'pulling' | 'logs' | 'results'

interface DockerImageSecurityFlowProps {
  activeStage: DockerImageSecurityFlowStage
  onStageChange: (stage: DockerImageSecurityFlowStage) => void
  pullStatus: 'idle' | 'pulling' | 'complete' | 'error'
  logsCount: number
  resultsCount: number
  pullingContent: ReactNode
  logsContent: ReactNode
  resultsContent: ReactNode
}

export function DockerImageSecurityFlow({
  activeStage,
  onStageChange,
  pullStatus,
  logsCount,
  resultsCount,
  pullingContent,
  logsContent,
  resultsContent,
}: DockerImageSecurityFlowProps) {
  const tabs = useMemo<readonly DockerFlowTabItem<DockerImageSecurityFlowStage>[]>(() => {
    return [
      {
        value: 'pulling',
        label: 'Pulling',
        icon: Download,
        badge: (
          <>
            {pullStatus === 'pulling' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {pullStatus === 'complete' ? <Badge variant="default" className="h-5 px-1 text-[10px]">done</Badge> : null}
            {pullStatus === 'error' ? <Badge variant="destructive" className="h-5 px-1 text-[10px]">error</Badge> : null}
          </>
        ),
      },
      {
        value: 'logs',
        label: 'Logs',
        icon: ScrollText,
        badge: <Badge variant="outline" className="h-5 px-1 text-[10px]">{logsCount}</Badge>,
      },
      {
        value: 'results',
        label: 'Results',
        icon: Shield,
        badge: <Badge variant="outline" className="h-5 px-1 text-[10px]">{resultsCount}</Badge>,
      },
    ] as const
  }, [logsCount, pullStatus, resultsCount])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DockerFlowTabGroup tabs={tabs} activeTab={activeStage} onTabChange={onStageChange} />

      <div className="flex-1 min-h-0 overflow-hidden pt-2">
        <div className={`h-full ${activeStage === 'pulling' ? 'block' : 'hidden'}`}>{pullingContent}</div>
        <div className={`h-full ${activeStage === 'logs' ? 'block' : 'hidden'}`}>{logsContent}</div>
        <div className={`h-full ${activeStage === 'results' ? 'block' : 'hidden'}`}>{resultsContent}</div>
      </div>
    </div>
  )
}
