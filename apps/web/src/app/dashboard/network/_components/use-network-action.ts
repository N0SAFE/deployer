'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { getErrorMessage, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'

/**
 * Run a networking mutation with one feedback convention: a success toast naming
 * what changed, or the server's own reason. Returns whether it succeeded so a
 * dialog can stay open on failure.
 */
export function useNetworkAction() {
  const [pending, setPending] = useState<string | null>(null)
  const run = useCallback(async (label: string, action: () => Promise<unknown>): Promise<boolean> => {
    setPending(label)
    try {
      await action()
      toast.success(label)
      return true
    } catch (error) {
      toast.error(getErrorMessage(error, UNKNOWN_ORPC_ERROR_MESSAGE))
      return false
    } finally {
      setPending(null)
    }
  }, [])
  return { run, pending }
}
