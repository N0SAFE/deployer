import { TerminalViewer } from '@/components/atomics/organisms/terminal'
import type { DockerTerminalProfile } from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Plus, TerminalSquare, X } from 'lucide-react'
import type { TerminalConnectionState } from '../../../_utils/container-terminal'

interface DockerTerminalSessionViewModel {
  sessionId: string
  profiles: DockerTerminalProfile[]
  output: string[]
  input: string
  closed: boolean
}

const CONNECTION_LABEL: Record<TerminalConnectionState, { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  none: { text: 'Not connected', variant: 'outline' },
  opening: { text: 'Connecting…', variant: 'secondary' },
  connected: { text: 'Connected', variant: 'default' },
  closed: { text: 'Session closed', variant: 'destructive' },
}

interface DockerContainerTerminalTabProps {
  containerName: string
  connectionState: TerminalConnectionState
  openError: unknown
  terminalSessions: DockerTerminalSessionViewModel[]
  activeTerminalSessionId: string | null
  isSending: boolean
  onCreateTerminalSession: () => void
  onActivateTerminalSession: (sessionId: string) => void
  onCloseTerminalSession: (sessionId: string) => void
  onTerminalInputChange: (value: string) => void
  onSend: () => void
  onClearOutput: () => void
  onSendControlInput: (value: string) => void
}

export function DockerContainerTerminalTab({
  containerName,
  connectionState,
  openError,
  terminalSessions,
  activeTerminalSessionId,
  isSending,
  onCreateTerminalSession,
  onActivateTerminalSession,
  onCloseTerminalSession,
  onTerminalInputChange,
  onSend,
  onClearOutput,
  onSendControlInput,
}: DockerContainerTerminalTabProps) {
  const activeSession = activeTerminalSessionId
    ? terminalSessions.find((session) => session.sessionId === activeTerminalSessionId) ?? null
    : null

  const connection = CONNECTION_LABEL[connectionState]
  const openErrorMessage = openError instanceof Error ? openError.message : openError ? 'The engine rejected the request.' : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Alert>
        <TerminalSquare className="size-4" />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          Shell inside <span className="font-mono">{containerName}</span>
          <Badge variant={connection.variant} role="status">{connection.text}</Badge>
        </AlertTitle>
        <AlertDescription>
          Commands run inside the container with that container&apos;s privileges and user, not on the host. Changes you make to its filesystem are lost when the container is removed unless they are in a volume.
        </AlertDescription>
      </Alert>

      {openErrorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Could not open a shell in {containerName}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>The container may be stopped or have no shell. Reason: <span className="font-mono text-xs">{openErrorMessage}</span></p>
            <Button type="button" size="sm" variant="outline" onClick={onCreateTerminalSession}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div role="group" aria-label="Terminal sessions" className="flex flex-wrap items-center gap-2 rounded border bg-muted/20 p-2">
        {terminalSessions.map((session, index) => {
          const profile = session.profiles.find((candidate) => candidate.recommended) ?? session.profiles[0]
          const isActive = session.sessionId === activeTerminalSessionId

          return (
            <div key={session.sessionId} className={`flex items-center gap-1 rounded border px-1 py-1 ${isActive ? 'border-primary/50 bg-primary/10' : 'border-border bg-background'}`}>
              <button
                type="button"
                aria-pressed={isActive}
                aria-label={`Terminal ${String(index + 1)}${profile ? `, ${profile.shell} as ${profile.user}` : ''}${session.closed ? ', closed' : ''}`}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
                onClick={() => {
                  onActivateTerminalSession(session.sessionId)
                }}
              >
                <span className="font-mono">T{String(index + 1)}</span>
                {profile ? <span className="text-muted-foreground">{profile.shell}@{profile.user}</span> : null}
                {session.closed ? <Badge variant="outline">closed</Badge> : null}
              </button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                aria-label={`Close terminal ${String(index + 1)}`}
                title={`Close terminal ${String(index + 1)}`}
                onClick={() => {
                  onCloseTerminalSession(session.sessionId)
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        })}

        <Button type="button" variant="outline" size="sm" className="h-8" onClick={onCreateTerminalSession}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          New terminal
        </Button>
      </div>

      {activeSession ? (
        <TerminalViewer
          profiles={activeSession.profiles.map((profile) => ({
            id: `${activeSession.sessionId}:${profile.shell}:${profile.user}:${profile.workingDir}`,
            shell: profile.shell,
            user: profile.user,
            workingDir: profile.workingDir,
            recommended: profile.recommended,
          }))}
          outputChunks={activeSession.output}
          inputValue={activeSession.input}
          sessionId={activeSession.closed ? null : activeSession.sessionId}
          isSending={isSending || activeSession.closed}
          onInputChange={onTerminalInputChange}
          onSend={onSend}
          onClearOutput={onClearOutput}
          onSendControlInput={onSendControlInput}
          description={activeSession.closed
            ? 'This terminal session is closed. Start a new one to continue.'
            : `Interactive shell in ${containerName} (persistent stdin/stdout stream).`}
          openingMessage={activeSession.closed ? 'Session closed.' : 'Opening terminal session...'}
        />
      ) : (
        <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          {connectionState === 'opening'
            ? 'Opening a shell in the container…'
            : 'No active terminal session. Use New terminal to open a shell in this container.'}
        </div>
      )}
    </div>
  )
}
