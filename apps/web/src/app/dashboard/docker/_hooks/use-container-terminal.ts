'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  useDockerCloseContainerTerminalSession,
  useDockerContainerTerminalSessionStream,
  useDockerOpenContainerTerminalSession,
  useDockerSendContainerTerminalInput,
} from '@/domains/docker/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import type { DockerContainerInspectDetail, DockerFileEntry, DockerTerminalProfile } from '@repo/contracts-entities'
import {
  appendTerminalOutput,
  escapeShellPath,
  isTerminalClosedStatus,
  resolveTerminalConnectionState,
  resolveTerminalWorkingDirForEntry,
  terminalChunkFromEvent,
  type DockerTerminalSessionState,
  type DockerTerminalStreamEvent,
} from '../_utils/container-terminal'
import { STREAM_QUERY_BASE_OPTIONS } from './container-stream-options'
import { useOnDepsChange } from './use-on-deps-change'

interface UseContainerTerminalParams {
  id: string
  active: boolean
  inspectDetail: DockerContainerInspectDetail | null
  onRequestTerminalTab: () => void
}

function describeError(error: unknown): string {
  return isDefinedORPCError(error) ? getErrorMessage(error) : String(error)
}

/**
 * Interactive shell sessions inside the container. Sessions are opened lazily
 * when the Terminal tab is first shown and closed server-side when the modal unmounts.
 */
export function useContainerTerminal({ id, active, inspectDetail, onRequestTerminalTab }: UseContainerTerminalParams) {
  const [sessions, setSessions] = useState<DockerTerminalSessionState[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const openMutation = useDockerOpenContainerTerminalSession()
  const sendMutation = useDockerSendContainerTerminalInput()
  const closeMutation = useDockerCloseContainerTerminalSession()

  const activeSession = useMemo(
    () => (activeSessionId ? sessions.find((session) => session.sessionId === activeSessionId) ?? null : null),
    [activeSessionId, sessions],
  )

  const streamInput = useMemo(() => ({ query: { sessionId: activeSessionId ?? '' } }), [activeSessionId])
  const streamOptions = useMemo(
    () => ({
      ...STREAM_QUERY_BASE_OPTIONS,
      enabled: active && activeSessionId !== null && !activeSession?.closed,
    }),
    [active, activeSession?.closed, activeSessionId],
  )
  const streamQuery = useDockerContainerTerminalSessionStream(streamInput, streamOptions)

  const defaultProfiles = useMemo<DockerTerminalProfile[]>(() => {
    const user = inspectDetail?.runtimeConfig.user ?? 'root'
    const workingDir = inspectDetail?.runtimeConfig.workingDir ?? '/'
    return [
      { shell: 'bash', user, workingDir, recommended: true },
      { shell: 'sh', user, workingDir, recommended: false },
    ]
  }, [inspectDetail?.runtimeConfig.user, inspectDetail?.runtimeConfig.workingDir])

  const updateSession = useCallback(
    (sessionId: string, patch: (session: DockerTerminalSessionState) => DockerTerminalSessionState) => {
      setSessions((previous) => previous.map((session) => (session.sessionId === sessionId ? patch(session) : session)))
    },
    [],
  )

  const createSession = useCallback((workingDir?: string) => {
    if (openMutation.isPending) return

    openMutation.mutate(
      {
        containerId: id,
        shell: 'sh',
        user: inspectDetail?.runtimeConfig.user ?? 'root',
        workingDir: workingDir ?? inspectDetail?.runtimeConfig.workingDir ?? '/',
      },
      {
        onSuccess: (response) => {
          const body = response.body
          const nextSession: DockerTerminalSessionState = {
            sessionId: body.sessionId,
            profiles: body.profiles.length > 0 ? body.profiles : defaultProfiles,
            output: [],
            input: '',
            closed: false,
          }
          setSessions((previous) => (previous.some((s) => s.sessionId === nextSession.sessionId) ? previous : [...previous, nextSession]))
          setActiveSessionId(nextSession.sessionId)
        },
        onError: (error) => {
          toast.error('Failed to open terminal session', { description: describeError(error) })
        },
      },
    )
  }, [defaultProfiles, id, inspectDetail?.runtimeConfig.user, inspectDetail?.runtimeConfig.workingDir, openMutation])

  const closeSession = useCallback((sessionId: string) => {
    const session = sessions.find((candidate) => candidate.sessionId === sessionId)
    if (session && !session.closed) closeMutation.mutate({ sessionId })

    const remaining = sessions.filter((candidate) => candidate.sessionId !== sessionId)
    setSessions(remaining)
    setActiveSessionId((current) => (current === sessionId ? (remaining[0]?.sessionId ?? null) : current))
  }, [closeMutation, sessions])

  const sendInput = useCallback((sessionId: string, input: string) => {
    if (input.length === 0) return
    sendMutation.mutate(
      { sessionId, input },
      {
        onError: (error) => {
          updateSession(sessionId, (session) => ({
            ...session,
            output: appendTerminalOutput(session.output, `\r\n[error] ${describeError(error)}\r\n`),
          }))
        },
      },
    )
  }, [sendMutation, updateSession])

  const sendCommand = useCallback(() => {
    if (!activeSession || activeSession.closed || activeSession.input.trim().length === 0) return
    const payload = activeSession.input.endsWith('\n') ? activeSession.input : `${activeSession.input}\n`
    sendInput(activeSession.sessionId, payload)
    updateSession(activeSession.sessionId, (session) => ({ ...session, input: '' }))
  }, [activeSession, sendInput, updateSession])

  const sendControlInput = useCallback((value: string) => {
    if (!activeSession || activeSession.closed) return
    sendInput(activeSession.sessionId, value)
  }, [activeSession, sendInput])

  const changeInput = useCallback((value: string) => {
    if (!activeSessionId) return
    updateSession(activeSessionId, (session) => ({ ...session, input: value }))
  }, [activeSessionId, updateSession])

  const clearOutput = useCallback(() => {
    if (!activeSessionId) return
    updateSession(activeSessionId, (session) => ({ ...session, output: [] }))
  }, [activeSessionId, updateSession])

  /** Files tab: `cd` into the entry in the live shell, or open a shell there. */
  const goToPath = useCallback((path: string, type: DockerFileEntry['type']) => {
    const workingDir = resolveTerminalWorkingDirForEntry(path, type)
    onRequestTerminalTab()
    if (activeSession && !activeSession.closed) {
      sendInput(activeSession.sessionId, `cd ${escapeShellPath(workingDir)}\n`)
      return
    }
    createSession(workingDir)
  }, [activeSession, createSession, onRequestTerminalTab, sendInput])

  const openNewAtPath = useCallback((path: string, type: DockerFileEntry['type']) => {
    onRequestTerminalTab()
    createSession(resolveTerminalWorkingDirForEntry(path, type))
  }, [createSession, onRequestTerminalTab])

  // Lazily open the first session. Do not retry on failure: the tab shows the error with a retry button.
  useEffect(() => {
    if (!active || sessions.length > 0 || openMutation.isPending || openMutation.isError) return
    createSession()
  }, [active, createSession, openMutation.isError, openMutation.isPending, sessions.length])

  const streamEvent = streamQuery.data as DockerTerminalStreamEvent | undefined
  useOnDepsChange([activeSessionId, streamEvent, updateSession], () => {
    const sessionId = activeSessionId
    if (!sessionId || !streamEvent || typeof streamEvent.data !== 'string') return
    const event = { ...streamEvent, data: streamEvent.data }
    const chunk = terminalChunkFromEvent(event)
    const markClosed = isTerminalClosedStatus(event)

    updateSession(sessionId, (session) => ({
      ...session,
      closed: markClosed ? true : session.closed,
      output: appendTerminalOutput(session.output, chunk),
    }))
  })

  // Close live shells on the server when the modal goes away.
  const sessionsRef = useRef(sessions)
  const closeRef = useRef(closeMutation.mutate)
  useEffect(() => {
    sessionsRef.current = sessions
    closeRef.current = closeMutation.mutate
  })
  useEffect(() => () => {
    sessionsRef.current
      .filter((session) => !session.closed)
      .forEach((session) => { closeRef.current({ sessionId: session.sessionId }) })
  }, [])

  useOnDepsChange([id], () => {
    setSessions([])
    setActiveSessionId(null)
  }, false)

  return {
    sessions,
    activeSessionId,
    isSending: sendMutation.isPending,
    isOpening: openMutation.isPending,
    openError: openMutation.isError ? openMutation.error : null,
    connectionState: resolveTerminalConnectionState(activeSession, openMutation.isPending),
    createSession: () => { createSession() },
    activateSession: setActiveSessionId,
    closeSession,
    changeInput,
    sendCommand,
    clearOutput,
    sendControlInput,
    goToPath,
    openNewAtPath,
  }
}
