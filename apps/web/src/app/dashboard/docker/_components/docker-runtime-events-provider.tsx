'use client'

import { DockerRuntimeEventsProvider } from '@/domains/docker/hooks'

import type { ReactNode } from 'react'

interface DockerRuntimeEventsProviderClientProps {
    children: ReactNode
}

export function DockerRuntimeEventsProviderClient({
    children,
}: DockerRuntimeEventsProviderClientProps) {
    return <DockerRuntimeEventsProvider>{children}</DockerRuntimeEventsProvider>
}
