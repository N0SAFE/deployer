'use client'

import type { ReactNode } from 'react'
import { PageHeader } from '@/components/dashboard'
import { DockerNodeBadge } from './docker-node-context'

/** Standard header for every Node engine page: eyebrow, title, description, node indicator. */
export function DockerPageHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <PageHeader
      eyebrow="Node engine"
      title={title}
      badge={<DockerNodeBadge />}
      description={description}
      actions={actions}
    />
  )
}
