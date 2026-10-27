import type { DockerFileEntry, DockerTerminalProfile } from '@deployer/contracts-entities'
import { getParentPath } from '../_components/docker-filesystem-utils'

export interface DockerTerminalSessionState {
  sessionId: string
  profiles: DockerTerminalProfile[]
  output: string[]
  input: string
  closed: boolean
}

export interface DockerTerminalStreamEvent {
  type?: 'output' | 'status' | 'error'
  data?: string
  timestamp?: string
}

export const TERMINAL_OUTPUT_CHUNK_LIMIT = 1200

/** Single-quotes a path for safe use in a shell command. */
export function escapeShellPath(pathValue: string): string {
  return `'${pathValue.replace(/'/g, `'"'"'`)}'`
}

/** Directories open in place; files open in their parent directory. */
export function resolveTerminalWorkingDirForEntry(path: string, type: DockerFileEntry['type']): string {
  return type === 'dir' ? path : getParentPath(path)
}

export function appendTerminalOutput(output: string[], chunk: string): string[] {
  return [...output, chunk].slice(-TERMINAL_OUTPUT_CHUNK_LIMIT)
}

/** Text appended to the transcript for a stream event. */
export function terminalChunkFromEvent(event: DockerTerminalStreamEvent & { data: string }): string {
  if (event.type === 'output') return event.data
  if (event.type === 'error') return `\r\n[error] ${event.data}\r\n`
  const prefix = event.timestamp ? `[${event.timestamp}] ` : ''
  return `\r\n${prefix}${event.data}\r\n`
}

export function isTerminalClosedStatus(event: DockerTerminalStreamEvent & { data: string }): boolean {
  if (event.type !== 'status') return false
  const normalized = event.data.toLowerCase()
  return normalized.includes('shell exited') || normalized.includes('shell closed') || normalized.includes('session closed')
}

export type TerminalConnectionState = 'none' | 'opening' | 'connected' | 'closed'

export function resolveTerminalConnectionState(
  session: Pick<DockerTerminalSessionState, 'closed' | 'output'> | null,
  isOpening: boolean,
): TerminalConnectionState {
  if (session) return session.closed ? 'closed' : 'connected'
  return isOpening ? 'opening' : 'none'
}
