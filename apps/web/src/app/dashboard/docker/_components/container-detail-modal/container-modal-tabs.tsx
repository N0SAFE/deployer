'use client'

import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import type { DockerContainer, DockerContainerInspectDetail } from '@deployer/contracts-entities'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@deployer/ui/components/shadcn/tabs'
import { DockerContainerLogsTab } from '../../containers/_components/container-detail-modal/logs-tab'
import { DockerDetailLoadingState } from '../docker-loading-states'
import { DockerEngineError } from '../docker-engine-error'
import { buildComposeRows, resolveOrchestrator } from '../../_utils/container-detail'
import type { useContainerFiles } from '../../_hooks/use-container-files'
import type { useContainerLogs } from '../../_hooks/use-container-logs'
import type { useContainerMetrics } from '../../_hooks/use-container-metrics'
import type { useContainerProcesses } from '../../_hooks/use-container-processes'
import type { useContainerSecurity } from '../../_hooks/use-container-security'
import type { useContainerTerminal } from '../../_hooks/use-container-terminal'
import {
  DockerContainerComposeTab,
  DockerContainerConfigTab,
  DockerContainerEnvTab,
  DockerContainerFilesTab,
  DockerContainerLabelsTab,
  DockerContainerLayersTab,
  DockerContainerMountsTab,
  DockerContainerNetworkTab,
  DockerContainerOverviewTab,
  DockerContainerProcessesTab,
  DockerContainerSecurityTab,
  DockerContainerTerminalTab,
} from './tabs'
import { useState } from 'react'

export const CONTAINER_TABS = [
  ['overview', 'Overview'],
  ['layers', 'Layers'],
  ['processes', 'Processes'],
  ['logs', 'Logs'],
  ['network', 'Network'],
  ['mounts', 'Mounts'],
  ['files', 'Files'],
  ['env', 'Environment'],
  ['config', 'Config'],
  ['compose', 'Compose'],
  ['labels', 'Labels'],
  ['terminal', 'Terminal'],
  ['security', 'Security'],
] as const

interface ContainerModalTabsProps {
  activeTab: string
  onTabChange: (tab: string) => void
  detail: DockerContainer
  inspectDetail: DockerContainerInspectDetail | null
  inspectLoading: boolean
  metrics: ReturnType<typeof useContainerMetrics>
  logs: ReturnType<typeof useContainerLogs>
  processes: ReturnType<typeof useContainerProcesses>
  security: ReturnType<typeof useContainerSecurity>
  files: ReturnType<typeof useContainerFiles>
  terminal: ReturnType<typeof useContainerTerminal>
}

const PANEL_CLASS = 'flex min-h-0 flex-col gap-3 text-sm'

/** Tab list plus one panel per section. Each panel body lives in ./tabs; this only wires data to it. */
export function ContainerModalTabs({
  activeTab,
  onTabChange,
  detail,
  inspectDetail,
  inspectLoading,
  metrics,
  logs,
  processes,
  security,
  files,
  terminal,
}: ContainerModalTabsProps) {
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)
  const [showRawCompose, setShowRawCompose] = useState(false)

  const orchestrator = resolveOrchestrator(inspectDetail?.composeConfig?.labels['orchestrator.runtime'])
  const composeRows = inspectDetail?.composeConfig ? buildComposeRows(inspectDetail.composeConfig, orchestrator) : []
  const securityError = security.imageInspectQuery.error
  const securityErrorMessage = isDefinedORPCError(securityError)
    ? getErrorMessage(securityError)
    : securityError ? UNKNOWN_ORPC_ERROR_MESSAGE : null

  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className="flex min-h-0 w-full flex-1 flex-col **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:overflow-auto"
    >
      <TabsList aria-label="Container sections" className="flex h-auto w-full shrink-0 flex-nowrap items-center justify-start gap-1 overflow-x-auto">
        {CONTAINER_TABS.map(([value, label]) => (
          <TabsTrigger key={value} className="shrink-0" value={value}>{label}</TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview">
        {inspectLoading ? (
          <DockerDetailLoadingState label="Loading container runtime details…" />
        ) : (
          <DockerContainerOverviewTab
            detail={detail}
            inspectDetail={inspectDetail}
            metricSummary={metrics.metricSummary}
            metricChartData={metrics.metricChartData}
          />
        )}
      </TabsContent>

      <TabsContent value="layers" className={PANEL_CLASS}>
        <DockerContainerLayersTab
          containerLayers={security.layers}
          expandedLayerId={expandedLayerId}
          securityVulnerabilitiesCount={security.vulnerabilities.length}
          onToggleLayer={(layerId) => { setExpandedLayerId((previous) => (previous === layerId ? null : layerId)) }}
          layerStatus={security.layerStatus}
          layerStatusVariant={security.layerStatusVariant}
        />
      </TabsContent>

      <TabsContent value="processes">
        {processes.isLoading ? (
          <DockerDetailLoadingState label="Loading process list…" />
        ) : (
          <DockerContainerProcessesTab
            liveProcesses={processes.liveProcesses}
            expandedProcessPid={processes.expandedPid}
            expandedProcessLogs={processes.expandedLogs}
            processesAutoRefresh={processes.autoRefresh}
            onToggleAutoRefresh={processes.toggleAutoRefresh}
            onToggleProcess={processes.toggleProcess}
          />
        )}
      </TabsContent>

      <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col overflow-hidden!">
        {logs.isConnecting ? (
          <DockerDetailLoadingState label="Connecting to the log stream…" />
        ) : logs.error && logs.liveLogs.length === 0 ? (
          <DockerEngineError what="container logs" error={logs.error} onRetry={() => { void logs.refetch() }} />
        ) : (
          <DockerContainerLogsTab
            liveLogs={logs.liveLogs}
            streamingEnabled={logs.streamingEnabled}
            onToggleStreaming={logs.toggleStreaming}
            onReset={logs.reset}
            hasMoreHistory={logs.hasMoreHistory}
            isLoadingHistory={logs.isLoadingHistory}
            onLoadOlderLogs={logs.loadOlder}
            timeRange={logs.timeRange}
            onApplyTimeRange={logs.applyTimeRange}
            onClearTimeRange={logs.clearTimeRange}
            streamingLogsSupported={inspectDetail?.streamingLogsSupported ?? false}
          />
        )}
      </TabsContent>

      <TabsContent value="network" className="space-y-3 text-sm">
        <DockerContainerNetworkTab networks={inspectDetail?.networkConfig ?? []} portMappings={inspectDetail?.portMappings ?? []} />
      </TabsContent>

      <TabsContent value="mounts" className={PANEL_CLASS}>
        <DockerContainerMountsTab mounts={inspectDetail?.mounts ?? []} />
      </TabsContent>

      <TabsContent value="files" className={PANEL_CLASS}>
        {files.listError ? (
          <DockerEngineError what={`files in ${files.currentFilePath}`} error={files.listError} onRetry={() => { void files.refetchList() }} />
        ) : null}
        <DockerContainerFilesTab
            fileBrowserMode={files.fileBrowserMode}
            volumeMounts={files.volumeMounts}
            selectedVolumePath={files.selectedVolumePath}
            currentFilePath={files.currentFilePath}
            selectedFilePath={files.selectedFilePath}
            selectedFile={files.selectedFile}
            selectedFileContent={files.selectedFileContent}
            effectiveFiles={files.effectiveFiles}
            fileActionNotice={files.fileActionNotice}
            uploadInputRef={files.uploadInputRef}
            onSetFileBrowserMode={files.setFileBrowserMode}
            onSetSelectedVolumePath={files.setSelectedVolumePath}
            onSetCurrentFilePath={files.setCurrentFilePath}
            onSetSelectedFilePath={files.setSelectedFilePath}
            onOpenCreateFolder={files.openCreateFolder}
            onTriggerUploadPicker={() => { files.uploadInputRef.current?.click() }}
            onOpenEditFileModal={files.openEditor}
            onUploadFiles={files.uploadFiles}
            modeRootPath={files.modeRootPath}
            onRenameFile={files.startRename}
            onChmodFile={files.chmod}
            onDownloadFile={files.download}
            onDeletePath={files.requestDelete}
            onGoToTerminalPath={terminal.goToPath}
            onOpenNewTerminalPath={terminal.openNewAtPath}
          />
      </TabsContent>

      <TabsContent value="env" className="flex min-h-0 flex-col gap-2 text-sm">
        <DockerContainerEnvTab environment={inspectDetail?.environment ?? []} />
      </TabsContent>

      <TabsContent value="config" className="space-y-3 text-sm">
        <DockerContainerConfigTab runtimeConfig={inspectDetail?.runtimeConfig ?? null} />
      </TabsContent>

      <TabsContent value="compose" className={PANEL_CLASS}>
        <DockerContainerComposeTab
          composeConfig={inspectDetail?.composeConfig ?? null}
          orchestrator={orchestrator}
          composeRows={composeRows}
          showRawCompose={showRawCompose}
          onToggleShowRawCompose={() => { setShowRawCompose((previous) => !previous) }}
        />
      </TabsContent>

      <TabsContent value="labels" className="space-y-2 text-sm">
        <DockerContainerLabelsTab
          labels={[
            { key: 'projectId', value: detail.projectId },
            { key: 'serviceId', value: detail.serviceId },
            { key: 'logsStreamId', value: detail.logsStreamId ?? '—' },
          ]}
        />
      </TabsContent>

      <TabsContent value="terminal" className="flex min-h-0 flex-1 flex-col overflow-hidden!">
        <DockerContainerTerminalTab
          containerName={detail.name}
          terminalSessions={terminal.sessions}
          activeTerminalSessionId={terminal.activeSessionId}
          isSending={terminal.isSending}
          connectionState={terminal.connectionState}
          openError={terminal.openError}
          onCreateTerminalSession={terminal.createSession}
          onActivateTerminalSession={terminal.activateSession}
          onCloseTerminalSession={terminal.closeSession}
          onTerminalInputChange={terminal.changeInput}
          onSend={terminal.sendCommand}
          onClearOutput={terminal.clearOutput}
          onSendControlInput={terminal.sendControlInput}
        />
      </TabsContent>

      <TabsContent value="security" className="space-y-2 text-sm">
        <DockerContainerSecurityTab
          severityCounts={security.severityCounts}
          imageId={detail.imageId}
          isFetching={security.imageInspectQuery.isFetching}
          hasScannerDetail={Boolean(security.imageInspectDetail)}
          errorMessage={securityErrorMessage}
          scanSummary={security.imageInspectDetail?.scanSummary ?? null}
          scanEvents={security.scanEvents}
          scanStreamStatus={security.scanStreamStatus}
          privileged={inspectDetail?.runtimeConfig.privileged ?? false}
          readOnlyRootFs={inspectDetail?.runtimeConfig.readOnlyRootFs ?? false}
          networkMode={inspectDetail?.runtimeConfig.networkMode ?? null}
          health={detail.health}
          vulnerabilities={security.vulnerabilities}
        />
      </TabsContent>
    </Tabs>
  )
}
