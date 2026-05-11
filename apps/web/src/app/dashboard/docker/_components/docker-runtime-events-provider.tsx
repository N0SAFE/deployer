'use client'

import type { ReactNode } from 'react'
import { DockerRuntimeEventsProvider } from '@/domains/docker/hooks'

interface DockerRuntimeEventsProviderClientProps {
  children: ReactNode
}

export function DockerRuntimeEventsProviderClient({
  children,
}: DockerRuntimeEventsProviderClientProps) {
  return (
    <DockerRuntimeEventsProvider>
      {children}
    </DockerRuntimeEventsProvider>
  )
}
