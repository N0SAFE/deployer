'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useDockerRunContainerAction } from '@/domains/docker/hooks'
import type { ContainerAction, ContainerRow } from '../_models/container-list.model'
import { actionTargets } from '../_utils/container-rows'

export interface ContainerActionRequest {
  action: ContainerAction
  rows: ContainerRow[]
}

const PAST_TENSE: Record<ContainerAction, string> = {
  start: 'started',
  stop: 'stopped',
  restart: 'restarted',
  remove: 'removed',
}

/** Stopping and removing interrupt or destroy something, so they are confirmed first. */
const NEEDS_CONFIRMATION: ReadonlySet<ContainerAction> = new Set(['stop', 'remove'])

function plural(count: number): string {
  return `${String(count)} container${count === 1 ? '' : 's'}`
}

/**
 * Runs start/stop/restart/remove on one or many containers. Rows an action cannot
 * apply to are skipped (stopping a stopped container is a no-op, not an error).
 * Stop and remove go through a confirmation request first.
 */
export function useContainerActions({ onSettled, onRemoved }: {
  onSettled: () => Promise<void>
  onRemoved?: (ids: string[]) => void
}): {
  request: (action: ContainerAction, rows: readonly ContainerRow[]) => void
  confirmation: ContainerActionRequest | null
  confirm: () => void
  cancel: () => void
  isBusy: boolean
} {
  const mutation = useDockerRunContainerAction()
  const [confirmation, setConfirmation] = useState<ContainerActionRequest | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const { mutateAsync } = mutation

  const execute = useCallback(async ({ action, rows }: ContainerActionRequest) => {
    setIsBusy(true)
    try {
      const results = await Promise.allSettled(rows.map((row) => mutateAsync({ containerId: row.id, action })))
      const succeededIds = rows.filter((_, index) => results[index]?.status === 'fulfilled').map((row) => row.id)
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      await onSettled()
      if (succeededIds.length > 0) {
        toast.success(`${plural(succeededIds.length)} ${PAST_TENSE[action]}`)
        if (action === 'remove') onRemoved?.(succeededIds)
      }
      if (failures.length > 0) {
        const reason: unknown = failures[0]?.reason
        toast.error(`Could not ${action} ${plural(failures.length)}`, {
          description: reason instanceof Error ? reason.message : 'The Docker engine rejected the request.',
        })
      }
    } finally {
      setIsBusy(false)
      setConfirmation(null)
    }
  }, [mutateAsync, onRemoved, onSettled])

  const request = useCallback((action: ContainerAction, rows: readonly ContainerRow[]) => {
    const targets = actionTargets(action, rows)
    if (targets.length === 0) {
      toast.info(`Nothing to ${action}`, { description: 'None of the selected containers are in a state where this applies.' })
      return
    }
    const next = { action, rows: targets }
    if (NEEDS_CONFIRMATION.has(action)) setConfirmation(next)
    else void execute(next)
  }, [execute])

  const confirm = useCallback(() => {
    if (confirmation) void execute(confirmation)
  }, [confirmation, execute])

  const cancel = useCallback(() => { setConfirmation(null) }, [])

  return { request, confirmation, confirm, cancel, isBusy }
}
