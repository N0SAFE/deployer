'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import type { IngressState } from '@repo/api-contracts/modules/reachability/index'
import { useUpdateIngress } from '@/domains/reachability/hooks'
import { LANE_COPY, Mono } from './network-copy'
import { useNetworkAction } from './use-network-action'

function ConsoleUrl({ url }: { url: string | null }) {
  if (url === null) return <span className="text-muted-foreground">not served on this lane</span>
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs hover:underline">
      {url}
      <ExternalLink className="size-3" />
    </a>
  )
}

/** The local lane: always on. Only its port is a choice. */
export function LocalLaneCard({ ingress, canEdit }: { ingress: IngressState; canEdit: boolean }) {
  const update = useUpdateIngress()
  const { run } = useNetworkAction()
  const [port, setPort] = useState(String(ingress.lanes.entryPort))
  const Icon = LANE_COPY.local.icon
  const parsed = Number(port)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4" />
          Local lane
          <Badge variant="secondary">always on</Badge>
        </CardTitle>
        <CardDescription>{LANE_COPY.local.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div>
          Console: <ConsoleUrl url={ingress.consoleUrls.local} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="entry-port">Door port (every node, local and private doors)</Label>
          <div className="flex gap-2">
            <Input id="entry-port" className="w-32" inputMode="numeric" value={port} disabled={!canEdit} onChange={(event) => { setPort(event.target.value); }} />
            {canEdit ? (
              <Button
                variant="outline"
                disabled={!valid || parsed === ingress.lanes.entryPort || update.isPending}
                onClick={() => void run(`Doors now bind :${port}`, () => update.mutateAsync({ entryPort: parsed }))}
              >
                Save
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** The private lane: members only, over the mesh. */
export function PrivateLaneCard({ ingress, canEdit }: { ingress: IngressState; canEdit: boolean }) {
  const update = useUpdateIngress()
  const { run } = useNetworkAction()
  const lane = ingress.lanes.private
  const [domain, setDomain] = useState(lane.domain)
  const Icon = LANE_COPY.private.icon

  const save = (label: string, next: { enabled?: boolean; domain?: string; exposeOnLan?: boolean }) =>
    void run(label, () =>
      update.mutateAsync({
        private: {
          enabled: next.enabled ?? lane.enabled,
          domain: next.domain ?? lane.domain,
          exposeOnLan: next.exposeOnLan ?? lane.exposeOnLan,
        },
      }),
    )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-4" />
            Private lane
          </CardTitle>
          <CardDescription>{LANE_COPY.private.blurb}</CardDescription>
        </div>
        <Switch
          aria-label="Private lane"
          checked={lane.enabled}
          disabled={!canEdit || update.isPending}
          onCheckedChange={(enabled) => { save(enabled ? 'Private lane on' : 'Private lane off', { enabled }); }}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">{LANE_COPY.private.cost}</p>
        <div>
          Console: <ConsoleUrl url={ingress.consoleUrls.private} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="private-domain">Private domain</Label>
          <div className="flex gap-2">
            <Input id="private-domain" value={domain} disabled={!canEdit} onChange={(event) => { setDomain(event.target.value); }} />
            {canEdit ? (
              <Button
                variant="outline"
                disabled={domain.trim() === '' || domain.trim() === lane.domain || update.isPending}
                onClick={() => { save('Private domain saved', { domain: domain.trim().toLowerCase() }); }}
              >
                Save
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Apps answer on <Mono>{`<app>.${lane.domain}`}</Mono>. Under a reserved suffix such as <Mono>.internal</Mono> the
            names resolve on the mesh only; under a real domain the DNS plane points them at every node’s mesh address.
          </p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="expose-on-lan">Allow same-network join</Label>
            <span className="text-xs text-muted-foreground">
              Also bind the private door on each node’s LAN address, so a machine on the same network can reach a member
              BEFORE it has a mesh address — the no-provider way to add a node. Other machines on that network can then
              reach private routes too.
            </span>
          </div>
          <Switch
            id="expose-on-lan"
            checked={lane.exposeOnLan}
            disabled={!canEdit || !lane.enabled || update.isPending}
            onCheckedChange={(exposeOnLan) => { save(exposeOnLan ? 'Same-network join allowed' : 'Same-network join closed', { exposeOnLan }); }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/** Which lanes the platform's own console (api, web, setup) is on. */
export function ConsoleVisibilityCard({ ingress, canEdit }: { ingress: IngressState; canEdit: boolean }) {
  const update = useUpdateIngress()
  const { run } = useNetworkAction()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Console visibility</CardTitle>
        <CardDescription>
          Public keeps webhooks and OAuth callbacks working once a public lane exists. Private keeps the console on the
          local and private lanes only — reachable from mesh members, never from the internet.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <Select
          value={ingress.lanes.consoleVisibility}
          disabled={!canEdit || update.isPending}
          onValueChange={(value) =>
            void run(`Console is now ${value}`, () => update.mutateAsync({ consoleVisibility: value === 'private' ? 'private' : 'public' }))
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="private">Private (mesh only)</SelectItem>
          </SelectContent>
        </Select>
        <div>
          Public console: <ConsoleUrl url={ingress.consoleUrls.public} />
        </div>
      </CardContent>
    </Card>
  )
}
