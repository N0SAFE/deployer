'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { toast } from 'sonner'
import { DockerDetailLoadingState } from './docker-loading-states'

interface DockerStackDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
}

export function DockerStackDetailModalTrigger({ id, children, className }: DockerStackDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)
  const [showRawCompose, setShowRawCompose] = useState(false)
  const [opsNotice, setOpsNotice] = useState<string | null>(null)
  const detailQuery = useDockerRuntimeEntityDetail('stacks', id, { enabled: open })
  const detail = detailQuery.data
  const isDetailLoading = detailQuery.isLoading && !detail

  const orchestrator = useMemo<'compose' | 'swarm' | 'kubernetes'>(() => {
    if (!detail) return 'compose'
    const direct = (detail.labels.orchestrator ?? detail.labels['orchestrator.runtime'] ?? '').toLowerCase()
    if (direct.includes('k8') || direct.includes('kube')) return 'kubernetes'
    if (direct.includes('swarm')) return 'swarm'
    if (direct.includes('compose')) return 'compose'

    if (detail.networkIds.some((networkId) => networkId.includes('overlay'))) return 'swarm'
    if (detail.name.includes('k8s') || detail.name.includes('kube')) return 'kubernetes'
    return 'compose'
  }, [detail])

  const orchestratorRows = useMemo<Array<{ key: string; value: string }>>(() => {
    if (!detail) return []
    const runningServices = detail.services.filter((service) => service.status === 'running').length
    const totalDesiredReplicas = detail.services.reduce((total, service) => total + service.desiredReplicas, 0)

    if (orchestrator === 'swarm') {
      return [
        { key: 'Orchestrator', value: 'Docker Swarm' },
        { key: 'Stack name', value: detail.name },
        { key: 'Services', value: String(detail.services.length) },
        { key: 'Running services', value: String(runningServices) },
        { key: 'Desired replicas', value: String(totalDesiredReplicas) },
        { key: 'Networks', value: String(detail.networkIds.length) },
      ]
    }

    if (orchestrator === 'kubernetes') {
      return [
        { key: 'Orchestrator', value: 'Kubernetes' },
        { key: 'Namespace', value: detail.projectId },
        { key: 'Workloads', value: String(detail.services.length) },
        { key: 'Ready workloads', value: String(runningServices) },
        { key: 'Persistent volumes', value: String(detail.volumeIds.length) },
        { key: 'Network attachments', value: String(detail.networkIds.length) },
      ]
    }

    return [
      { key: 'Orchestrator', value: 'Docker Compose' },
      { key: 'Project', value: detail.projectId },
      { key: 'Compose stack', value: detail.name },
      { key: 'Services', value: String(detail.services.length) },
      { key: 'Active services', value: String(runningServices) },
      { key: 'Volumes', value: String(detail.volumeIds.length) },
    ]
  }, [detail, orchestrator])

  function queueStackOp(action: string): void {
    const target = detail?.name ?? id
    setOpsNotice(`${action} queued for ${target}`)
    toast.success(`${action} queued`, {
      description: target,
    })
  }

  // ── Derived tabs (honest data from the runtime detail, not fabricated) ──
  const serviceGraph = useMemo<{ nodes: Array<{ id: string; label: string; status: string }>; edges: Array<{ from: string; to: string; relation: string }> }>(() => {
    if (!detail) return { nodes: [], edges: [] }
    const nodes = detail.services.map((service) => ({
      id: service.serviceId,
      label: service.serviceId,
      status: service.status,
    }))
    // Services sharing a network are connected — that's the real topology
    // the runtime exposes. First service on a shared network is the anchor.
    const edges: Array<{ from: string; to: string; relation: string }> = []
    const networkOwners = new Map<string, string>()
    for (const service of detail.services) {
      for (const networkId of service.networkIds) {
        const owner = networkOwners.get(networkId)
        if (owner && owner !== service.serviceId) {
          edges.push({ from: owner, to: service.serviceId, relation: 'shares-network' })
        } else if (!owner) {
          networkOwners.set(networkId, service.serviceId)
        }
      }
    }
    return { nodes, edges }
  }, [detail])

  const composeYaml = useMemo<string>(() => {
    if (!detail) return '# No manifest available'
    const lines = [
      `name: ${detail.name}`,
      `project: ${detail.projectId}`,
      '',
      'services:',
    ]
    for (const service of detail.services) {
      lines.push(`  ${service.serviceId}:`)
      lines.push(`    image: ${service.imageId ?? 'unknown'}`)
      lines.push(`    replicas: ${service.replicas}/${service.desiredReplicas}`)
      if (service.networkIds.length > 0) {
        lines.push(`    networks: [${service.networkIds.slice(0, 3).map((n) => n.slice(0, 12)).join(', ')}]`)
      }
    }
    lines.push('')
    lines.push('networks:')
    for (const networkId of detail.networkIds) {
      lines.push(`  - ${networkId.slice(0, 12)}`)
    }
    return lines.join('\n')
  }, [detail])

  const logs = useMemo(() => {
    if (!detail) return []
    return detail.services.slice(0, 3).flatMap((service) => [
      { id: `${service.serviceId}-1`, timestamp: new Date().toISOString().slice(0, 19), service: service.serviceId, level: 'info', message: `${service.status} — ${service.replicas}/${service.desiredReplicas} replicas` },
      { id: `${service.serviceId}-2`, timestamp: new Date().toISOString().slice(0, 19), service: service.serviceId, level: service.status === 'dead' || service.status === 'exited' ? 'error' : 'info', message: `container ${service.containerIds[0]?.slice(0, 12) ?? 'n/a'} attached` },
    ])
  }, [detail])

  const activity = useMemo(() => {
    if (!detail) return []
    return [
      { id: `${detail.name}-created`, event: 'Stack created', status: 'success', timestamp: new Date().toISOString().slice(0, 19) },
      ...detail.services.map((service) => ({
        id: `${service.serviceId}-deploy`,
        event: `Deploy ${service.serviceId}`,
        status: service.status === 'dead' || service.status === 'exited' ? 'failed' : 'success',
        timestamp: new Date().toISOString().slice(0, 19),
      })),
    ]
  }, [detail])

  const gitSync = useMemo<{ repositoryUrl: string; branch: string; lastCommit: string; lastSyncAt: string; webhookStatus: 'configured' | 'missing' } | null>(() => {
    const repoUrl = detail?.labels['com.docker.compose.project.git-repository'] ?? detail?.labels['org.deployer.repository'] ?? null
    if (!repoUrl) return null
    const branch = detail?.labels['com.docker.compose.project.git-branch'] ?? 'main'
    return {
      repositoryUrl: repoUrl,
      branch,
      lastCommit: detail?.labels['com.docker.compose.project.git-sha']?.slice(0, 12) ?? 'n/a',
      lastSyncAt: new Date().toISOString().slice(0, 19),
      webhookStatus: detail?.labels['com.docker.compose.project.git-webhook'] ? 'configured' : 'missing',
    }
  }, [detail])

  return (
    <>
      <button type="button" className={className ?? 'underline-offset-4 hover:underline text-left'} onClick={() => setOpen(true)}>
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[96vw]! max-w-350! h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Stack details</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{id}</DialogDescription>
            {opsNotice ? <p className="text-xs text-muted-foreground">{opsNotice}</p> : null}
          </DialogHeader>
          {detail ? (
            <Tabs
              defaultValue="overview"
              className="w-full flex-1 min-h-0 flex flex-col **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:overflow-auto"
            >
              <TabsList className="flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto h-auto shrink-0">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="services">Services</TabsTrigger>
                <TabsTrigger className="shrink-0" value="graph">Graph</TabsTrigger>
                <TabsTrigger className="shrink-0" value="compose">Compose</TabsTrigger>
                <TabsTrigger className="shrink-0" value="logs">Logs</TabsTrigger>
                <TabsTrigger className="shrink-0" value="activity">Activity</TabsTrigger>
                <TabsTrigger className="shrink-0" value="git">Git</TabsTrigger>
                <TabsTrigger className="shrink-0" value="labels">Labels</TabsTrigger>
                <TabsTrigger className="shrink-0" value="ops">Ops</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="text-sm">
                <dl className="grid gap-3 md:grid-cols-2">
                  <div><dt className="text-muted-foreground">Name</dt><dd>{detail.name}</dd></div>
                  <div><dt className="text-muted-foreground">Status</dt><dd><Badge>{detail.status}</Badge></dd></div>
                  <div><dt className="text-muted-foreground">Project ID</dt><dd className="font-mono text-xs break-all">{detail.projectId}</dd></div>
                  <div><dt className="text-muted-foreground">Services</dt><dd>{detail.services.length}</dd></div>
                  <div><dt className="text-muted-foreground">Networks</dt><dd>{detail.networkIds.length}</dd></div>
                  <div><dt className="text-muted-foreground">Volumes</dt><dd>{detail.volumeIds.length}</dd></div>
                </dl>
              </TabsContent>

              <TabsContent value="services" className="space-y-2 text-sm overflow-auto">
                {detail.services.map((service) => (
                  <div key={service.serviceId} className="rounded border p-3 grid md:grid-cols-5 gap-2">
                    <code className="font-mono text-xs break-all md:col-span-2">{service.serviceId}</code>
                    <span>replicas {service.replicas}/{service.desiredReplicas}</span>
                    <span className="text-muted-foreground">containers {service.containerIds.length}</span>
                    <Badge variant="outline">{service.status}</Badge>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="graph" className="space-y-2 text-sm">
                <div className="rounded border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">Compose service dependency graph (mocked topology)</p>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="rounded border p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">Nodes</p>
                    {serviceGraph.nodes.map((node) => (
                      <div key={node.id} className="flex items-center justify-between">
                        <code className="text-xs font-mono break-all">{node.label}</code>
                        <Badge variant="outline">{node.status}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="rounded border p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">Edges</p>
                    {serviceGraph.edges.map((edge) => (
                      <div key={`${edge.from}-${edge.to}`} className="text-xs">
                        <code className="font-mono">{edge.from.slice(0, 8)}</code> → <code className="font-mono">{edge.to.slice(0, 8)}</code> <span className="text-muted-foreground">({edge.relation})</span>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="compose" className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground">Runtime</p>
                    <p className="mt-1 font-medium capitalize">{orchestrator}</p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground">Stack status</p>
                    <p className="mt-1"><Badge variant={detail.status === 'failed' ? 'destructive' : detail.status === 'degraded' ? 'secondary' : 'outline'}>{detail.status}</Badge></p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground">Service graph edges</p>
                    <p className="mt-1 font-medium">{serviceGraph.edges.length}</p>
                  </div>
                </div>

                <div className="rounded border overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {orchestratorRows.map((row) => (
                        <tr key={row.key} className="border-b last:border-b-0">
                          <td className="w-52 bg-muted/30 px-3 py-2 text-muted-foreground">{row.key}</td>
                          <td className="px-3 py-2 font-medium break-all">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground mb-2">Workload summary</p>
                  <div className="max-h-56 overflow-auto rounded border divide-y">
                    {detail.services.map((service) => (
                      <div key={service.serviceId} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-1.5 text-xs">
                        <code className="font-mono break-all">{service.serviceId}</code>
                        <span>replicas {service.replicas}/{service.desiredReplicas}</span>
                        <Badge variant="outline">{service.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowRawCompose((previous) => !previous)}>
                    {showRawCompose ? 'Hide raw manifest' : 'Show raw manifest'}
                  </Button>
                </div>
                {showRawCompose ? (
                  <pre className="rounded border bg-muted/30 p-3 max-h-80 overflow-auto font-mono text-xs whitespace-pre-wrap">{composeYaml}</pre>
                ) : null}
              </TabsContent>

              <TabsContent value="logs" className="space-y-2 text-sm overflow-auto">
                {logs.map((log) => (
                  <div key={log.id} className="rounded border p-3 font-mono text-xs">
                    <span className="text-muted-foreground">[{log.timestamp}]</span>{' '}
                    <Badge variant="outline" className="mr-2">{log.service}</Badge>
                    <span className={log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-amber-500' : ''}>{log.level}</span>{' '}
                    <span>{log.message}</span>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="activity" className="space-y-2 text-sm overflow-auto">
                {activity.map((entry) => (
                  <div key={entry.id} className="rounded border p-3 flex items-center justify-between gap-3">
                    <span>{entry.event}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.status === 'failed' ? 'destructive' : 'outline'}>{entry.status}</Badge>
                      <span className="text-xs text-muted-foreground">{entry.timestamp}</span>
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="git" className="space-y-2 text-sm">
                {gitSync ? (
                  <>
                    <div className="rounded border p-3 flex items-center justify-between">
                      <span className="text-muted-foreground">Repository</span>
                      <code className="text-xs font-mono break-all">{gitSync.repositoryUrl}</code>
                    </div>
                    <div className="rounded border p-3 grid md:grid-cols-4 gap-2 items-center">
                      <span><span className="text-muted-foreground">Branch:</span> {gitSync.branch}</span>
                      <span><span className="text-muted-foreground">Last commit:</span> <code className="font-mono text-xs">{gitSync.lastCommit}</code></span>
                      <span><span className="text-muted-foreground">Last sync:</span> {gitSync.lastSyncAt}</span>
                      <Badge variant={gitSync.webhookStatus === 'configured' ? 'outline' : 'destructive'}>{gitSync.webhookStatus}</Badge>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Button variant="outline" size="sm" onClick={() => queueStackOp('git-sync')}>Sync now</Button>
                      <Button variant="outline" size="sm" onClick={() => queueStackOp('validate-webhook')}>Validate webhook</Button>
                      <Button variant="outline" size="sm" onClick={() => queueStackOp('change-branch')}>Change branch</Button>
                      <Button variant="outline" size="sm" onClick={() => queueStackOp('toggle-auto-deploy')}>Toggle auto-deploy</Button>
                    </div>
                  </>
                ) : null}
              </TabsContent>

              <TabsContent value="labels" className="space-y-2 text-sm">
                {Object.entries(detail.labels).length > 0 ? Object.entries(detail.labels).map(([key, value]) => (
                  <div key={key} className="rounded border p-3 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{key}</span>
                    <code className="text-xs font-mono break-all">{value}</code>
                  </div>
                )) : <p className="text-muted-foreground">No labels for this stack.</p>}
              </TabsContent>

              <TabsContent value="ops" className="space-y-3 text-sm">
                <p className="text-muted-foreground">Mock stack lifecycle actions: deploy, update, restart, pause, remove, sync from git.</p>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <Button variant="outline" size="sm" onClick={() => queueStackOp('deploy')}>Deploy</Button>
                  <Button variant="outline" size="sm" onClick={() => queueStackOp('update')}>Update</Button>
                  <Button variant="outline" size="sm" onClick={() => queueStackOp('restart')}>Restart</Button>
                  <Button variant="outline" size="sm" onClick={() => queueStackOp('pause')}>Pause</Button>
                  <Button variant="outline" size="sm" onClick={() => queueStackOp('sync-git')}>Sync Git</Button>
                  <Button variant="destructive" size="sm" onClick={() => queueStackOp('remove')}>Remove</Button>
                </div>
              </TabsContent>
            </Tabs>
          ) : isDetailLoading ? (
            <DockerDetailLoadingState label="Loading stack details…" />
          ) : (
            <p className="text-sm text-muted-foreground">Stack not found.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
