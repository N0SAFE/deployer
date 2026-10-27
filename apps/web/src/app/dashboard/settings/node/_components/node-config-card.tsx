'use client'

import { useState } from 'react'
import { Eye, EyeOff, Settings, Sliders } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { QueryError } from '../../_components/query-error'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { useNodeStatus } from '@/domains/setup/hooks'
import { useMeshNodeConfig, useMeshSseState } from '@/domains/mesh/hooks'
import { formatDateTime } from '@/lib/format/date'
import { NodeConfigForm } from './node-config-form'
import { ValueTile } from './field'
import { useNodeConfigForm } from './use-node-config-form'

/**
 * The persisted configuration of THIS node — what the node reads from its config
 * file at startup. Saving writes the file; the running service keeps its current
 * values until it restarts.
 */
export function NodeConfigCard() {
  const { data: nodeConfig, isLoading, error: configError, refetch: refetchConfig } = useMeshNodeConfig()
  const { data: nodeStatus, isLoading: statusLoading } = useNodeStatus()
  const { state: meshState } = useMeshSseState()
  const localNode = meshState?.localNode
  const form = useNodeConfigForm()
  const [revealDb, setRevealDb] = useState(false)

  const edit = () => {
    const cfg = nodeConfig ?? nodeStatus
    form.begin({
      nodeId: cfg?.nodeId ?? localNode?.nodeId ?? '',
      strategy: cfg?.strategy === 'remote' ? 'remote' : 'local',
      meshUrls: cfg?.meshUrlsSnapshot ?? [],
      databaseUrl: nodeConfig?.databaseUrl ?? '',
      region: localNode?.region ?? '',
      zone: localNode?.zone ?? '',
      version: localNode?.version ?? '',
      roles: localNode?.roles ?? [],
      routingMode: localNode?.routingMode ?? '',
      consistencyMode: localNode?.consistencyMode ?? '',
    })
  }

  const roles = nodeConfig?.roles ?? localNode?.roles
  const databaseUrl = nodeConfig?.databaseUrl

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="size-5 text-primary" /> Configuration file
            </CardTitle>
            <CardDescription>
              The settings this node loads on startup. Saving here changes the file only — the running service keeps its current values until it restarts.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {localNode ? (
              <Badge variant={localNode.lifecycleState === 'healthy' ? 'default' : localNode.lifecycleState === 'suspect' ? 'secondary' : 'destructive'}>
                {localNode.lifecycleState}
              </Badge>
            ) : null}
            <Button variant="outline" size="sm" className="gap-1" onClick={form.open ? form.cancel : edit}>
              <Sliders className="size-3.5" /> {form.open ? 'Cancel' : 'Edit config'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {form.open ? (
          <NodeConfigForm form={form} />
        ) : isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : configError ? (
          <QueryError what="this node's configuration" onRetry={() => { void refetchConfig() }} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <ValueTile label="Node ID" hint="Identity in the mesh"><span className="break-all font-mono">{nodeConfig?.nodeId ?? nodeStatus?.nodeId ?? localNode?.nodeId ?? '—'}</span></ValueTile>
            <ValueTile label="Strategy" hint="local owns its data; remote joins an existing mesh">
              <Badge variant="outline">{nodeConfig?.strategy ?? nodeStatus?.strategy ?? (nodeStatus?.meshUrlsSnapshot.length ? 'remote' : 'local')}</Badge>
            </ValueTile>
            <ValueTile label="Configured at">{formatDateTime(nodeConfig?.configuredAt ?? nodeStatus?.configuredAt?.toString())}</ValueTile>
            <ValueTile label="Region">{nodeConfig?.region ?? localNode?.region ?? '—'}</ValueTile>
            <ValueTile label="Zone">{nodeConfig?.zone ?? localNode?.zone ?? '—'}</ValueTile>
            <ValueTile label="Version">{nodeConfig?.version ?? localNode?.version ?? '—'}</ValueTile>
            <ValueTile label="Routing mode"><Badge variant="outline">{nodeConfig?.routingMode ?? localNode?.routingMode ?? '—'}</Badge></ValueTile>
            <ValueTile label="Consistency mode"><Badge variant="outline">{nodeConfig?.consistencyMode ?? localNode?.consistencyMode ?? '—'}</Badge></ValueTile>
            <ValueTile label="Roles">
              <div className="flex flex-wrap gap-1">
                {roles?.length ? roles.map((role) => <Badge key={role} variant="secondary" className="text-[10px]">{role}</Badge>) : <span className="text-muted-foreground">—</span>}
              </div>
            </ValueTile>
            <ValueTile label="Setup status">
              {statusLoading ? <Skeleton className="h-5 w-20" /> : (
                <Badge variant={nodeStatus?.isConfigured ? 'default' : 'destructive'}>{nodeStatus?.isConfigured ? 'Configured' : 'Not configured'}</Badge>
              )}
            </ValueTile>
            <ValueTile label="Database URL" hint="Masked by default — it can contain the database password">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono">
                  {databaseUrl ? (revealDb ? databaseUrl : '••••••••••••') : '—'}
                </span>
                {databaseUrl ? (
                  <Button variant="ghost" size="icon" className="size-6" aria-label={revealDb ? 'Hide database URL' : 'Reveal database URL'} onClick={() => { setRevealDb(!revealDb) }}>
                    {revealDb ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                ) : null}
              </div>
            </ValueTile>
          </div>
        )}
        {!form.open && nodeConfig?.meshUrlsSnapshot && nodeConfig.meshUrlsSnapshot.length > 0 ? (
          <div className="mt-4 space-y-1 rounded-lg border bg-card p-3">
            <p className="text-sm text-muted-foreground">Mesh URLs this node uses to rejoin after a restart</p>
            <div className="mt-1 space-y-1">
              {nodeConfig.meshUrlsSnapshot.map((url) => <p key={url} className="truncate font-mono text-xs">{url}</p>)}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
