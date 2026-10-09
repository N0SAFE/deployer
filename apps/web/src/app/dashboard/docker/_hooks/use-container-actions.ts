'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useDockerRunContainerAction } from '@/domains/docker/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useOnDepsChange } from './use-on-deps-change'

export type ContainerOp = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'remove'

/** Operations that interrupt or delete the container and therefore need an explicit confirmation. */
export const DESTRUCTIVE_CONTAINER_OPS: ReadonlySet<ContainerOp> = new Set(['stop', 'kill', 'remove'])

interface UseContainerActionsParams {
  id: string
  name: string | null
  refetchInspect: () => Promise<unknown>
  onContainerStateChange?: () => unknown
}

/** Container lifecycle actions (start/stop/...) with a notice, toasts and a pending confirmation for destructive ones. */
export function useContainerActions({ id, name, refetchInspect, onContainerStateChange }: UseContainerActionsParams) {
  const mutation = useDockerRunContainerAction()
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ContainerOp | null>(null)
  const label = name ?? id

  const run = useCallback((action: ContainerOp) => {
    mutation.mutate(
      { containerId: id, action },
      {
        onSuccess: () => {
          setNotice(`${action} completed for ${label}`)
          toast.success(`${action} completed`, { description: label })
          void Promise.all([
            refetchInspect(),
            onContainerStateChange ? Promise.resolve(onContainerStateChange()) : Promise.resolve(),
          ])
        },
        onError: (error) => {
          const message = isDefinedORPCError(error) ? getErrorMessage(error) : String(error)
          setNotice(`${action} failed for ${label}: ${message}`)
          toast.error(`${action} failed`, { description: message })
        },
      },
    )
  }, [id, label, mutation, onContainerStateChange, refetchInspect])

  /** Runs immediately, or asks for confirmation first when the action is destructive. */
  const request = useCallback((action: ContainerOp) => {
    if (DESTRUCTIVE_CONTAINER_OPS.has(action)) {
      setPendingConfirm(action)
      return
    }
    run(action)
  }, [run])

  const confirm = useCallback(() => {
    if (!pendingConfirm) return
    run(pendingConfirm)
    setPendingConfirm(null)
  }, [pendingConfirm, run])

  const cancelConfirm = useCallback(() => { setPendingConfirm(null) }, [])

  useOnDepsChange([id], () => {
    setNotice(null)
    setPendingConfirm(null)
  }, false)

  return { notice, isPending: mutation.isPending, pendingConfirm, request, confirm, cancelConfirm }
}
