'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DockerContainer } from '@repo/contracts-entities'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogFooter } from '@repo/ui/components/shadcn/dialog'
import { useContainerActions } from '../../_hooks/use-container-actions'
import { useContainerFiles } from '../../_hooks/use-container-files'
import { useContainerInspect } from '../../_hooks/use-container-inspect'
import { useContainerLogs } from '../../_hooks/use-container-logs'
import { useContainerMetrics } from '../../_hooks/use-container-metrics'
import { useContainerProcesses } from '../../_hooks/use-container-processes'
import { useContainerSecurity } from '../../_hooks/use-container-security'
import { useContainerTerminal } from '../../_hooks/use-container-terminal'
import { DockerConfirmDialog } from '../docker-confirm-dialog'
import { DockerEngineError } from '../docker-engine-error'
import { DockerDetailLoadingState } from '../docker-loading-states'
import { ContainerFileDialogs } from './container-file-dialogs'
import { ContainerModalHeader } from './container-modal-header'
import { ContainerModalTabs } from './container-modal-tabs'
import { useOnDepsChange } from '../../_hooks/use-on-deps-change'

interface DockerContainerDetailModalContentProps {
  id: string
  container: DockerContainer | null
  onContainerStateChange?: () => unknown
  initialTab: string
  onOpenChange: (open: boolean) => void
}

const CONFIRM_COPY = {
  stop: { title: 'Stop container?', confirm: 'Stop container', consequence: 'it will be sent a stop signal; services it runs go offline until it is started again.' },
  kill: { title: 'Kill container?', confirm: 'Kill container', consequence: 'its main process is terminated immediately, without a graceful shutdown; unsaved data in it may be lost.' },
  remove: { title: 'Remove container?', confirm: 'Remove container', consequence: 'it is deleted together with its writable layer; data not stored in a volume cannot be recovered.' },
} as const

/**
 * Heavy container detail modal, mounted only while the dialog is open. It owns
 * the active tab and wires the per-concern hooks (inspect, metrics, logs, ...)
 * into the header, the tabs and the file dialogs.
 */
export function DockerContainerDetailModalContent({
  id,
  container,
  onContainerStateChange,
  initialTab,
  onOpenChange,
}: DockerContainerDetailModalContentProps) {
  const [activeTab, setActiveTab] = useState(initialTab)
  useOnDepsChange([id, initialTab], () => { setActiveTab(initialTab) }, false)

  const inspect = useContainerInspect({ id, container, onContainerStateChange })
  const { inspectQuery, inspectDetail, detail } = inspect

  const metrics = useContainerMetrics({ id, detail, enabled: activeTab === 'overview', matchesTarget: inspect.matchesTarget })
  const logs = useContainerLogs({ id, activeTab })
  const processes = useContainerProcesses({ id, active: activeTab === 'processes', inspectDetail })
  const security = useContainerSecurity({ detail, inspectDetail, activeTab })
  const files = useContainerFiles({ id, active: activeTab === 'files', inspectDetail })
  const showTerminalTab = useCallback(() => { setActiveTab('terminal') }, [])
  const terminal = useContainerTerminal({ id, active: activeTab === 'terminal', inspectDetail, onRequestTerminalTab: showTerminalTab })
  const actions = useContainerActions({
    id,
    name: detail?.name ?? null,
    refetchInspect: inspectQuery.refetch,
    onContainerStateChange,
  })

  const containerName = detail?.name ?? id
  const confirmCopy = actions.pendingConfirm && actions.pendingConfirm in CONFIRM_COPY
    ? CONFIRM_COPY[actions.pendingConfirm as keyof typeof CONFIRM_COPY]
    : null

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[85vh] max-h-[85vh] w-[96vw]! max-w-350! flex-col overflow-hidden">
          <ContainerModalHeader
            id={id}
            detail={detail}
            notice={actions.notice}
            actionsPending={actions.isPending}
            inspectState={inspectQuery.isError ? 'failed' : inspectQuery.isFetching ? 'refreshing' : 'ready'}
            runtimeStreamStatus={inspect.runtimeStreamStatus}
            lastRuntimeAction={inspect.lastRuntimeContainerAction}
            lastMetricAt={metrics.lastMetricAt}
            onAction={actions.request}
          />
          {inspectQuery.isError ? (
            <DockerEngineError
              what="container details"
              error={inspectQuery.error}
              onRetry={() => { void inspectQuery.refetch() }}
              isRetrying={inspectQuery.isFetching}
            />
          ) : null}
          {detail ? (
            <ContainerModalTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              detail={detail}
              inspectDetail={inspectDetail}
              inspectLoading={inspectQuery.isLoading && !inspectDetail}
              metrics={metrics}
              logs={logs}
              processes={processes}
              security={security}
              files={files}
              terminal={terminal}
            />
          ) : inspect.isDetailLoading ? (
            <DockerDetailLoadingState label="Loading container details…" />
          ) : inspectQuery.isError ? null : (
            <p className="text-sm text-muted-foreground">
              Container not found. It may have been removed; close this dialog and refresh the list.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false) }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContainerFileDialogs files={files} containerName={containerName} />

      <DockerConfirmDialog
        open={confirmCopy !== null}
        onOpenChange={(next) => { if (!next) actions.cancelConfirm() }}
        title={confirmCopy?.title ?? ''}
        objectName={containerName}
        consequence={confirmCopy?.consequence ?? ''}
        confirmLabel={confirmCopy?.confirm ?? ''}
        pending={actions.isPending}
        onConfirm={actions.confirm}
      />
    </>
  )
}
