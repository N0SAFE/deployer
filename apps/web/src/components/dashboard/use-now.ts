'use client'

import { useEffect, useState } from 'react'

/**
 * A clock that re-renders its consumer every `intervalMs`, so "last seen 3 min
 * ago" and staleness keep ageing on a screen that is otherwise static.
 */
export function useNow(intervalMs = 30_000): number {
  // eslint-disable-next-line react-hooks/purity -- initial clock read, refreshed by the interval below
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      window.clearInterval(id)
    }
  }, [intervalMs])
  return now
}
