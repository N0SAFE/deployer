'use client'

import { useEffect, useState } from 'react'

/** Current time in ms, refreshed every `everyMs` so relative times and presence stay true. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => { setNow(Date.now()) }, everyMs)
    return () => { window.clearInterval(id) }
  }, [everyMs])
  return now
}
