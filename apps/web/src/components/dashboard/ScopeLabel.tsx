'use client'

import { Badge } from '@repo/ui/components/shadcn/badge'
import { Network, Server } from 'lucide-react'

/**
 * ScopeLabel — makes the node-vs-mesh distinction explicit on every page.
 *
 * Every dashboard section is either:
 *  - **Mesh** (the single mesh-wide tenant): projects, services, domains,
 *    configuration defaults — data that spans all nodes.
 *  - **Node** (a single node): deployments, docker, per-node configuration.
 *
 * Render one at the top of each page so the operator always knows which
 * scope they are operating in.
 */
export function ScopeLabel({
  scope,
  nodeName,
}: {
  scope: 'mesh' | 'node'
  nodeName?: string
}) {
  if (scope === 'node') {
    return (
      <Badge variant="secondary" className="gap-1.5 font-normal">
        <Server className="size-3" />
        Node{nodeName ? ` · ${nodeName}` : ''}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <Network className="size-3" />
      Mesh
    </Badge>
  )
}