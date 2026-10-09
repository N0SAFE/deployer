'use client'

import { useContainerInspect } from '../../_hooks/use-container-inspect'
import { useContainerTerminal } from '../../_hooks/use-container-terminal'
import { DockerContainerTerminalTab } from '../../_components/container-detail-modal/tabs/terminal-tab'
import { DockerDetailLoadingState } from '../../_components/docker-loading-states'

const noop = () => undefined

/**
 * One shell workspace for one container. Mounted with `key={containerId}` so
 * switching container closes the old sessions (the hook closes them on unmount).
 * Sessions only open once the container's configured user/working dir is known,
 * so the shell does not silently start as root in a container that runs as someone else.
 */
export function ShellSession({ containerId, containerName }: { containerId: string; containerName: string }) {
  const { inspectDetail, inspectQuery } = useContainerInspect({ id: containerId, container: null })
  const inspectSettled = inspectDetail !== null || inspectQuery.isError
  const terminal = useContainerTerminal({ id: containerId, active: inspectSettled, inspectDetail, onRequestTerminalTab: noop })

  if (!inspectSettled) return <DockerDetailLoadingState label={`Reading ${containerName}'s user and working directory…`} />

  return (
    <DockerContainerTerminalTab
      containerName={containerName}
      connectionState={terminal.connectionState}
      openError={terminal.openError}
      terminalSessions={terminal.sessions}
      activeTerminalSessionId={terminal.activeSessionId}
      isSending={terminal.isSending}
      onCreateTerminalSession={terminal.createSession}
      onActivateTerminalSession={terminal.activateSession}
      onCloseTerminalSession={terminal.closeSession}
      onTerminalInputChange={terminal.changeInput}
      onSend={terminal.sendCommand}
      onClearOutput={terminal.clearOutput}
      onSendControlInput={terminal.sendControlInput}
    />
  )
}
