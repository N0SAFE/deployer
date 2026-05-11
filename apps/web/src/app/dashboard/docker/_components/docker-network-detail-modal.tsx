'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import { getMockNetworkDiagnostics } from '@/mocks/platform/entities/docker.large.mock'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Activity, Route, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { DockerModalQuickActions } from './docker-modal-quick-actions'
import { DockerDetailLoadingState } from './docker-loading-states'
import { toast } from 'sonner'

interface DockerNetworkDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: 'overview' | 'ipam' | 'containers' | 'labels' | 'diag'
}

export function DockerNetworkDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerNetworkDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'ipam' | 'containers' | 'labels' | 'diag'>(initialTab)
  const detailQuery = useDockerRuntimeEntityDetail('networks', id, { enabled: open })
  const detail = detailQuery.data
  const diagnostics = useMemo(() => (detail ? getMockNetworkDiagnostics(detail) : null), [detail])
  const isDetailLoading = detailQuery.isLoading && !detail

  return (
    <>
      <button
        type="button"
        className={className ?? 'underline-offset-4 hover:underline text-left'}
        onClick={() => {
          setActiveTab(initialTab)
          setOpen(true)
        }}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[96vw]! max-w-350! h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>Network details</DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">{id}</DialogDescription>
              </div>
              <DockerModalQuickActions
                actions={[
                  { label: 'Endpoints', icon: Route, onClick: () => setActiveTab('containers') },
                  { label: 'IPAM', icon: Search, onClick: () => setActiveTab('ipam') },
                  { label: 'Diagnostics', icon: Activity, onClick: () => setActiveTab('diag') },
                  {
                    label: 'Probe route',
                    icon: ShieldCheck,
                    onClick: () => {
                      setActiveTab('diag')
                      toast.success('Route probe queued', {
                        description: detail?.name ?? id,
                      })
                    },
                  },
                ]}
                dangerAction={{
                  label: 'Disconnect all',
                  icon: Trash2,
                  onClick: () => {
                    setActiveTab('containers')
                    toast.warning('Disconnect workflow queued', {
                      description: detail?.name ?? id,
                    })
                  },
                }}
              />
            </div>
          </DialogHeader>
          {detail ? (
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as 'overview' | 'ipam' | 'containers' | 'labels' | 'diag')}
              className="w-full flex-1 min-h-0 flex flex-col **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:overflow-auto"
            >
              <TabsList className="flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto h-auto shrink-0">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="ipam">IPAM</TabsTrigger>
                <TabsTrigger className="shrink-0" value="containers">Containers</TabsTrigger>
                <TabsTrigger className="shrink-0" value="labels">Labels</TabsTrigger>
                <TabsTrigger className="shrink-0" value="diag">Diagnostics</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3 text-sm">
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Driver</p>
                    <p className="font-medium">{detail.driver}</p>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Scope</p>
                    <p className="font-medium">{detail.scope}</p>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Endpoints</p>
                    <p className="font-medium">{String(detail.containerIds.length)}</p>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Connectivity</p>
                    <p className="font-medium">{diagnostics ? `${String(diagnostics.connectivityScore)}%` : '—'}</p>
                  </div>
                </div>
                <dl className="grid gap-3 md:grid-cols-2">
                  <div><dt className="text-muted-foreground">Name</dt><dd>{detail.name}</dd></div>
                  <div><dt className="text-muted-foreground">Subnet</dt><dd>{detail.subnet ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Gateway</dt><dd>{detail.gateway ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Internal</dt><dd>{detail.internal ? 'yes' : 'no'}</dd></div>
                  <div><dt className="text-muted-foreground">Attachable</dt><dd>{detail.attachable ? 'yes' : 'no'}</dd></div>
                  <div><dt className="text-muted-foreground">DNS health</dt><dd>{diagnostics?.dnsResolution ?? 'unknown'}</dd></div>
                </dl>
              </TabsContent>

              <TabsContent value="ipam" className="space-y-2 text-sm">
                <div className="rounded border p-3"><span className="text-muted-foreground">Subnet:</span> {detail.subnet ?? '—'}</div>
                <div className="rounded border p-3"><span className="text-muted-foreground">Gateway:</span> {detail.gateway ?? '—'}</div>
              </TabsContent>

              <TabsContent value="containers" className="space-y-2 text-sm">
                {detail.containerIds.length > 0 ? (
                  <div className="rounded border divide-y max-h-72 overflow-auto">
                    {detail.containerIds.map((containerId, index) => (
                      <div key={containerId} className="p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <code className="font-mono text-xs break-all">{containerId}</code>
                          <p className="text-[11px] text-muted-foreground">endpoint: {detail.subnet ? `${detail.subnet.split('/')[0]}.${String(10 + index)}` : 'auto-assigned'}</p>
                        </div>
                        <Badge variant="outline">attached</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No attached containers.</p>
                )}
              </TabsContent>

              <TabsContent value="labels" className="space-y-2 text-sm">
                {Object.entries(detail.labels).length > 0 ? Object.entries(detail.labels).map(([key, value]) => (
                  <div key={key} className="rounded border p-3 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{key}</span>
                    <code className="text-xs font-mono break-all">{value}</code>
                  </div>
                )) : <p className="text-muted-foreground">No labels found.</p>}
              </TabsContent>

              <TabsContent value="diag" className="space-y-2 text-sm">
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">DNS resolution</span>
                  <Badge variant={diagnostics?.dnsResolution === 'ok' ? 'outline' : 'destructive'}>{diagnostics?.dnsResolution ?? 'unknown'}</Badge>
                </div>
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Connectivity score</span>
                  <span className="font-semibold">{diagnostics ? `${String(diagnostics.connectivityScore)}%` : '—'}</span>
                </div>
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Packet loss (est.)</span>
                  <span className="font-semibold">{diagnostics ? `${String(Math.max(0, 100 - diagnostics.connectivityScore))}%` : '—'}</span>
                </div>
                <div className="rounded border divide-y">
                  {diagnostics?.notes.map((note) => <p key={note} className="p-3">{note}</p>)}
                </div>
              </TabsContent>
            </Tabs>
          ) : isDetailLoading ? (
            <DockerDetailLoadingState label="Loading network details…" />
          ) : (
            <p className="text-sm text-muted-foreground">Network not found.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}