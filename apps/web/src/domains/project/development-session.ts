"use client"

import { useMemo, useState } from 'react'
import { toast } from 'sonner'

export type DevelopmentExecutionLocation = 'local' | 'cloud' | 'dependency-managed'
export type DevelopmentDependencyHandling =
  | 'auto-resolve-preview'
  | 'reuse-shared-preview'
  | 'strict-local-only'

export interface DevelopmentServiceExecutionPolicy {
  executionLocation: DevelopmentExecutionLocation
  dependencyHandling: DevelopmentDependencyHandling
  notes: string
}

export type DevelopmentSessionState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'error'

export type DevelopmentSessionLifecyclePhase =
  | 'requested'
  | 'provisioning'
  | 'running'
  | 'degraded'
  | 'stopping'
  | 'stopped'

export interface DevelopmentSessionTimelineEvent {
  state: DevelopmentSessionState
  occurredAt: string
  message: string
}

export interface DevelopmentSessionActionGuards {
  canStart: boolean
  canStop: boolean
  canMarkDegraded: boolean
  canRecover: boolean
  canRevokeToken: boolean
  canNormalizePolicies: boolean
  nextActionHint: string
}

function createTimelineEvent(input: {
  state: DevelopmentSessionState
  message: string
}): DevelopmentSessionTimelineEvent {
  return {
    state: input.state,
    message: input.message,
    occurredAt: new Date().toISOString(),
  }
}

function toLifecyclePhase(state: DevelopmentSessionState): DevelopmentSessionLifecyclePhase {
  if (state === 'idle' || state === 'error') {
    return 'requested'
  }

  if (state === 'starting') {
    return 'provisioning'
  }

  return state
}

export interface DevelopmentPolicyService {
  id: string
  name: string
  type: string
  runtime: string
}

function createInitialDevelopmentServicePolicies(input: {
  services: DevelopmentPolicyService[]
}): Record<string, DevelopmentServiceExecutionPolicy> {
  const entries: Record<string, DevelopmentServiceExecutionPolicy> = {}

  for (const service of input.services) {
    const executionLocation: DevelopmentExecutionLocation =
      service.type === 'worker' || service.type === 'projection-worker' || service.type === 'data-pipeline'
        ? 'cloud'
        : service.type === 'database' || service.runtime === 'postgresql' || service.runtime === 'redis'
          ? 'dependency-managed'
          : 'local'

    entries[service.id] = {
      executionLocation,
      dependencyHandling:
        executionLocation === 'local'
          ? 'auto-resolve-preview'
          : executionLocation === 'cloud'
            ? 'reuse-shared-preview'
            : 'strict-local-only',
      notes: '',
    }
  }

  return entries
}

export function useDevelopmentSessionPlanner(input: {
  services: DevelopmentPolicyService[]
  developmentEnabled: boolean
}) {
  const { services, developmentEnabled } = input

  const [developmentConnectionToken, setDevelopmentConnectionToken] = useState('')
  const [developmentLocalServiceUrl, setDevelopmentLocalServiceUrl] = useState('http://localhost:3000')
  const [developmentLaunchCommand, setDevelopmentLaunchCommand] = useState('bun run dev')
  const [developmentSessionState, setDevelopmentSessionState] = useState<DevelopmentSessionState>('idle')
  const [developmentSessionStartedAt, setDevelopmentSessionStartedAt] = useState<string | null>(null)
  const [developmentSessionLastError, setDevelopmentSessionLastError] = useState<string | null>(null)
  const [developmentSessionTimeline, setDevelopmentSessionTimeline] = useState<
    DevelopmentSessionTimelineEvent[]
  >(() => [createTimelineEvent({ state: 'idle', message: 'Planner initialized' })])
  const [developmentServicePoliciesById, setDevelopmentServicePoliciesById] = useState<
    Record<string, DevelopmentServiceExecutionPolicy>
  >(() =>
    createInitialDevelopmentServicePolicies({
      services,
    }),
  )

  const developmentExecutionStats = useMemo(() => {
    const stats = {
      local: 0,
      cloud: 0,
      dependencyManaged: 0,
      tokenRequired: 0,
      strictLocalOnly: 0,
    }

    for (const service of services) {
      const policy = developmentServicePoliciesById[service.id]
      if (!policy) {
        continue
      }

      if (policy.executionLocation === 'local') {
        stats.local += 1
      } else if (policy.executionLocation === 'cloud') {
        stats.cloud += 1
        stats.tokenRequired += 1
      } else {
        stats.dependencyManaged += 1
        stats.tokenRequired += 1
      }

      if (policy.dependencyHandling === 'strict-local-only') {
        stats.strictLocalOnly += 1
      }
    }

    return stats
  }, [developmentServicePoliciesById, services])

  const developmentSessionRequiresToken = developmentExecutionStats.tokenRequired > 0
  const developmentSessionLifecyclePhase = toLifecyclePhase(developmentSessionState)

  const developmentPolicyConflicts = useMemo(() => {
    const conflicts: string[] = []

    for (const service of services) {
      const policy = developmentServicePoliciesById[service.id]
      if (!policy) {
        continue
      }

      if (
        policy.executionLocation !== 'local' &&
        policy.dependencyHandling === 'strict-local-only'
      ) {
        conflicts.push(
          `${service.name}: strict-local-only dependency handling requires local execution location.`,
        )
      }

      if (
        policy.executionLocation === 'local' &&
        policy.dependencyHandling === 'reuse-shared-preview'
      ) {
        conflicts.push(
          `${service.name}: reuse-shared-preview should use cloud or dependency-managed execution.`,
        )
      }
    }

    return conflicts
  }, [developmentServicePoliciesById, services])

  const developmentSessionActionGuards = useMemo<DevelopmentSessionActionGuards>(() => {
    const hasActiveSession =
      developmentSessionState === 'running' ||
      developmentSessionState === 'starting' ||
      developmentSessionState === 'degraded'

    const canStop = hasActiveSession
    const canMarkDegraded = developmentSessionState === 'running'
    const canRecover = developmentSessionState === 'degraded'
    const canRevokeToken = developmentConnectionToken.length > 0
    const canNormalizePolicies = developmentEnabled && developmentPolicyConflicts.length > 0
    const hasTokenRequirementSatisfied =
      !developmentSessionRequiresToken || developmentConnectionToken.trim().length > 0

    const canStart =
      developmentEnabled &&
      !hasActiveSession &&
      hasTokenRequirementSatisfied &&
      developmentPolicyConflicts.length === 0

    let nextActionHint = 'Ready to start a development session.'

    if (!developmentEnabled) {
      nextActionHint = 'Enable development mode to allow session actions.'
    } else if (developmentSessionState === 'starting') {
      nextActionHint = 'Provisioning in progress. Wait for running state or stop the session.'
    } else if (developmentSessionState === 'degraded') {
      nextActionHint = 'Session degraded. Recover or stop to continue safely.'
    } else if (developmentSessionState === 'running') {
      nextActionHint = 'Session is running. You can mark degraded or stop it.'
    } else if (!hasTokenRequirementSatisfied) {
      nextActionHint = 'Provide a development token to start cloud or dependency-managed services.'
    } else if (developmentPolicyConflicts.length > 0) {
      nextActionHint = 'Resolve or normalize policy conflicts before starting a session.'
    }

    return {
      canStart,
      canStop,
      canMarkDegraded,
      canRecover,
      canRevokeToken,
      canNormalizePolicies,
      nextActionHint,
    }
  }, [
    developmentConnectionToken,
    developmentEnabled,
    developmentPolicyConflicts.length,
    developmentSessionRequiresToken,
    developmentSessionState,
  ])

  const appendDevelopmentSessionTimelineEvent = (state: DevelopmentSessionState, message: string) => {
    setDevelopmentSessionTimeline((previous) => [
      createTimelineEvent({ state, message }),
      ...previous,
    ].slice(0, 20))
  }

  const setServiceExecutionLocation = (serviceId: string, executionLocation: DevelopmentExecutionLocation) => {
    setDevelopmentServicePoliciesById((previous) => {
      const current = previous[serviceId] ?? {
        executionLocation: 'local' as DevelopmentExecutionLocation,
        dependencyHandling: 'auto-resolve-preview' as DevelopmentDependencyHandling,
        notes: '',
      }

      return {
        ...previous,
        [serviceId]: {
          ...current,
          executionLocation,
        },
      }
    })
  }

  const setServiceDependencyHandling = (serviceId: string, dependencyHandling: DevelopmentDependencyHandling) => {
    setDevelopmentServicePoliciesById((previous) => {
      const current = previous[serviceId] ?? {
        executionLocation: 'local' as DevelopmentExecutionLocation,
        dependencyHandling: 'auto-resolve-preview' as DevelopmentDependencyHandling,
        notes: '',
      }

      return {
        ...previous,
        [serviceId]: {
          ...current,
          dependencyHandling,
        },
      }
    })
  }

  const setServicePolicyNotes = (serviceId: string, notes: string) => {
    setDevelopmentServicePoliciesById((previous) => {
      const current = previous[serviceId] ?? {
        executionLocation: 'local' as DevelopmentExecutionLocation,
        dependencyHandling: 'auto-resolve-preview' as DevelopmentDependencyHandling,
        notes: '',
      }

      return {
        ...previous,
        [serviceId]: {
          ...current,
          notes,
        },
      }
    })
  }

  const resetDevelopmentPlanner = () => {
    setDevelopmentSessionState('idle')
    setDevelopmentSessionStartedAt(null)
    setDevelopmentSessionLastError(null)
    setDevelopmentConnectionToken('')
    setDevelopmentLocalServiceUrl('http://localhost:3000')
    setDevelopmentLaunchCommand('bun run dev')
    setDevelopmentSessionTimeline([createTimelineEvent({ state: 'idle', message: 'Planner reset' })])
    setDevelopmentServicePoliciesById(
      createInitialDevelopmentServicePolicies({
        services,
      }),
    )
  }

  const startDevelopmentSession = () => {
    if (!developmentEnabled) {
      appendDevelopmentSessionTimelineEvent('idle', 'Start blocked: development mode is disabled')
      toast.error('Enable development environment before starting a session')
      return
    }

    if (developmentSessionRequiresToken && developmentConnectionToken.trim().length === 0) {
      const message = 'A development token is required for cloud or dependency-managed execution policies'
      setDevelopmentSessionState('error')
      setDevelopmentSessionLastError(message)
      appendDevelopmentSessionTimelineEvent('error', message)
      toast.error(message)
      return
    }

    if (developmentPolicyConflicts.length > 0) {
      const message = 'Resolve development policy conflicts before starting a session'
      setDevelopmentSessionState('error')
      setDevelopmentSessionLastError(message)
      appendDevelopmentSessionTimelineEvent('error', message)
      toast.error(message)
      return
    }

    setDevelopmentSessionState('starting')
    setDevelopmentSessionLastError(null)
    appendDevelopmentSessionTimelineEvent('starting', 'Development session provisioning started')

    setTimeout(() => {
      setDevelopmentSessionState('running')
      setDevelopmentSessionStartedAt(new Date().toISOString())
      appendDevelopmentSessionTimelineEvent('running', 'Development session is running')
      toast.success('Development session started (fixture mode)')
    }, 150)
  }

  const stopDevelopmentSession = () => {
    if (
      developmentSessionState !== 'running' &&
      developmentSessionState !== 'starting' &&
      developmentSessionState !== 'degraded'
    ) {
      appendDevelopmentSessionTimelineEvent('error', 'Stop blocked: no active development session')
      toast.error('No active development session to stop')
      return
    }

    setDevelopmentSessionState('stopping')
    appendDevelopmentSessionTimelineEvent('stopping', 'Development session stopping requested')
    setTimeout(() => {
      setDevelopmentSessionState('stopped')
      appendDevelopmentSessionTimelineEvent('stopped', 'Development session stopped')
      toast.success('Development session stopped (fixture mode)')
    }, 150)
  }

  const markDevelopmentSessionDegraded = (reason?: string) => {
    if (developmentSessionState !== 'running') {
      appendDevelopmentSessionTimelineEvent('error', 'Degraded mode can only be set from running state')
      toast.error('Session must be running before marking it degraded')
      return
    }

    const message = reason?.trim().length
      ? reason.trim()
      : 'Dependency health degradation detected while session is active'

    setDevelopmentSessionState('degraded')
    setDevelopmentSessionLastError(message)
    appendDevelopmentSessionTimelineEvent('degraded', message)
    toast.error(message)
  }

  const recoverDevelopmentSession = () => {
    if (developmentSessionState !== 'degraded') {
      appendDevelopmentSessionTimelineEvent('error', 'Recover blocked: session is not degraded')
      toast.error('Session is not degraded')
      return
    }

    setDevelopmentSessionState('running')
    setDevelopmentSessionLastError(null)
    appendDevelopmentSessionTimelineEvent('running', 'Development session recovered from degraded state')
    toast.success('Development session recovered')
  }

  const revokeDevelopmentToken = () => {
    setDevelopmentConnectionToken('')
    setDevelopmentSessionState('idle')
    setDevelopmentSessionStartedAt(null)
    setDevelopmentSessionLastError(null)
    appendDevelopmentSessionTimelineEvent('idle', 'Development token revoked and session reset')
    toast.success('Development token revoked in fixture state')
  }

  const normalizeDevelopmentPolicies = () => {
    setDevelopmentServicePoliciesById((previous) => {
      const next = { ...previous }

      for (const service of services) {
        const policy = next[service.id]
        if (!policy) {
          continue
        }

        if (policy.executionLocation !== 'local' && policy.dependencyHandling === 'strict-local-only') {
          next[service.id] = {
            ...policy,
            dependencyHandling: 'reuse-shared-preview',
          }
          continue
        }

        if (policy.executionLocation === 'local' && policy.dependencyHandling === 'reuse-shared-preview') {
          next[service.id] = {
            ...policy,
            dependencyHandling: 'auto-resolve-preview',
          }
        }
      }

      return next
    })

    setDevelopmentSessionLastError(null)
    toast.success('Development policies normalized')
  }

  return {
    developmentConnectionToken,
    setDevelopmentConnectionToken,
    developmentLocalServiceUrl,
    setDevelopmentLocalServiceUrl,
    developmentLaunchCommand,
    setDevelopmentLaunchCommand,
    developmentSessionState,
    developmentSessionLifecyclePhase,
    developmentSessionActionGuards,
    developmentSessionStartedAt,
    developmentSessionLastError,
    developmentSessionTimeline,
    developmentServicePoliciesById,
    developmentExecutionStats,
    developmentSessionRequiresToken,
    developmentPolicyConflicts,
    setServiceExecutionLocation,
    setServiceDependencyHandling,
    setServicePolicyNotes,
    resetDevelopmentPlanner,
    startDevelopmentSession,
    stopDevelopmentSession,
    markDevelopmentSessionDegraded,
    recoverDevelopmentSession,
    revokeDevelopmentToken,
    normalizeDevelopmentPolicies,
  }
}
