'use client'

import { useEffect, useRef } from 'react'
import type { LogData } from '@repo/logger'
import type { ContextFilterDebugLogger, ContextFilterDebugPredicate } from './context-filter-debug'

export function useLogger<TContext extends LogData = LogData>(
  logger: ContextFilterDebugLogger,
  methodName: string,
  context: TContext,
  shouldEmit?: ContextFilterDebugPredicate<TContext>,
) {
  const lastDataRef = useRef<TContext | undefined>(undefined)

  useEffect(() => {
    const previous = lastDataRef.current

    let canEmit = true
    if (shouldEmit) {
      try {
        canEmit = shouldEmit(previous, context)
      } catch {
        canEmit = true
      }
    }

    lastDataRef.current = context

    if (!canEmit) {
      return
    }

    logger(methodName, context)
  }, [context, logger, methodName, shouldEmit])
}
