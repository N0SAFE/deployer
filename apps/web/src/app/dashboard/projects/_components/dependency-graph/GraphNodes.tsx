'use client'

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { FolderTree } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { StatusBadge, statusMeta } from '@/components/dashboard'
import { cn } from '@/lib/utils'
import { getColorForEnvironment } from './graph-env'
import type { EnvironmentGroupNodeData, ServiceNodeData, SubserviceGroupNodeData } from './graph-types'

/** Status-aware node card — status badge replaces the plain active/inactive. */
export function ServiceNode({ data: nodeData }: NodeProps<Node<ServiceNodeData>>) {
  const projectIdLabel = nodeData.service.projectId.slice(0, 8)
  const status = nodeData.service.status ?? (nodeData.service.isActive ? 'active' : 'inactive')
  const isSubService = Boolean(nodeData.service.parentId)

  return (
    <div className="relative w-56">
      <Handle
        type="target"
        position={Position.Left}
        className="h-2.5! w-2.5! border-0! bg-primary/70!"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="h-2.5! w-2.5! border-0! bg-primary/70!"
      />

      <Card
        className={cn(
          'border-border/70 bg-card/85 shadow-md backdrop-blur-xl transition-all hover:border-primary/35 hover:shadow-lg',
          isSubService && 'border-dashed',
        )}
      >
        <CardHeader className="space-y-2 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="truncate text-sm font-semibold">{nodeData.service.name}</CardTitle>
            <StatusBadge status={status} showDot />
          </div>
          <CardDescription className="text-xs">
            type: <span className="font-medium text-foreground">{nodeData.service.type}</span>
            {isSubService ? <span className="text-muted-foreground"> · sub-service</span> : null}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-2 pt-0 text-xs">
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/35 px-2 py-1.5">
            <span className="text-muted-foreground">project</span>
            <span className="font-mono text-xs text-foreground">{projectIdLabel}</span>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/35 px-2 py-1.5">
            <span className="text-muted-foreground">env</span>
            <span className="font-mono text-xs text-foreground">{nodeData.environment}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border/60 bg-muted/25 px-2 py-1.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">depends on</p>
              <p className="text-sm font-semibold">{nodeData.dependencies}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/25 px-2 py-1.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">depended by</p>
              <p className="text-sm font-semibold">{nodeData.dependents}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function EnvironmentGroupNode({ data: nodeData }: NodeProps<Node<EnvironmentGroupNodeData>>) {
  const laneColor = getColorForEnvironment(nodeData.environment)

  return (
    <div className="pointer-events-none h-full w-full rounded-xl border border-border/60 bg-transparent p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/75 px-2 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: laneColor }} />
          <p className="text-xs font-semibold uppercase tracking-wide">{nodeData.environment}</p>
        </div>
        <div className="flex gap-1">
          <Badge variant="outline" className="text-xs">
            {nodeData.serviceCount} services
          </Badge>
          <Badge variant="outline" className="text-xs">
            {nodeData.linkCount} links
          </Badge>
        </div>
      </div>
    </div>
  )
}

/**
 * Group node that wraps the sub-services of a parent service (react-flow
 * `parentId`-style group). Renders a header band with the parent identity
 * and a child-count badge; children are positioned inside it.
 */
export function SubserviceGroupNode({ data: nodeData }: NodeProps<Node<SubserviceGroupNodeData>>) {
  const status = nodeData.service.status ?? (nodeData.service.isActive ? 'active' : 'inactive')
  const meta = statusMeta(status)

  return (
    <div className="h-full w-full rounded-xl border border-border/60 bg-card/30 p-2 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/75 px-2 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className={cn('inline-block size-2 rounded-full', meta.dotClass)} />
          <p className="truncate text-xs font-semibold">{nodeData.service.name}</p>
          <Badge variant="outline" className="gap-1 text-xs">
            <FolderTree className="size-2.5" /> {nodeData.childCount} sub
          </Badge>
        </div>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{nodeData.environment}</span>
      </div>
    </div>
  )
}
