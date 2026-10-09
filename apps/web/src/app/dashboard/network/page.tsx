'use client'

import { ArrowRight, Cable, DoorOpen, Globe, Network, Waypoints } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { PageHeader, StatStrip, StatStripItem, StatusBadge } from '@/components/dashboard'
import type { IngressState } from '@repo/api-contracts/modules/reachability/index'
import { AuthDashboardNetworkDns, AuthDashboardNetworkIngress, AuthDashboardNetworkMesh } from '@/routes'
import { ExposureCard } from './_components/exposure-card'
import { WithIngress } from './_components/ingress-query-state'
import { JoinPathsCard } from './_components/join-paths-card'
import { EdgeHealthBadge, enabledLaneKeys, LANE_COPY, Mono } from './_components/network-copy'

/**
 * Network — the whole picture on one page, plane by plane:
 *
 *   mesh      how nodes reach each other          (WireGuard, peer-equal)
 *   ingress   how clients reach Traefik           (lanes; the public one through an edge provider)
 *   dns       where the lanes' names point
 *
 * Each card links to the page that changes it; this one only reads.
 */
export default function NetworkOverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Platform"
        title="Network"
        description="How the stack is reached and the mesh it runs on. A lane is one way in (local, private, public); the mesh is the private WireGuard network between nodes. No node needs a public IP or an open port unless you choose an edge that opens one."
      />
      <WithIngress>{(ingress) => <Overview ingress={ingress} />}</WithIngress>
    </div>
  )
}

function Overview({ ingress }: { ingress: IngressState }) {
  const lanes = enabledLaneKeys(ingress.lanes)
  const peers = ingress.mesh.members.filter((member) => member.state === 'active' && !member.self)
  const direct = peers.filter((member) => member.link.path === 'direct').length
  const dnsIssues = ingress.dns.filter((record) => record.status !== 'synced').length
  const edge = ingress.edge.active

  return (
    <>
      <StatStrip>
        <StatStripItem icon={Network} label="Lanes" value={lanes.map((lane) => LANE_COPY[lane].label).join(' + ')} />
        <StatStripItem
          icon={Globe}
          label="Public edge"
          value={edge === null ? 'off' : (edge.provider?.label ?? edge.providerId)}
          tone={edge === null ? 'neutral' : edge.status.health === 'healthy' ? 'live' : edge.status.provisioned ? 'pending' : 'danger'}
        />
        <StatStripItem
          icon={Waypoints}
          label="Mesh"
          value={ingress.mesh.clusterId === null ? 'none' : `${String(peers.length + 1)} members`}
          hint={ingress.mesh.clusterId === null ? undefined : `${String(direct)}/${String(peers.length)} direct`}
          tone={!ingress.mesh.available || !ingress.mesh.interfaceUp ? 'danger' : direct === peers.length ? 'live' : 'pending'}
        />
        <StatStripItem
          icon={DoorOpen}
          label="New nodes can join"
          value={ingress.entryPoints.joinable ? 'yes' : 'no'}
          tone={ingress.entryPoints.joinable ? 'live' : 'neutral'}
        />
      </StatStrip>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>How clients reach the stack</span>
              <AuthDashboardNetworkIngress.Link className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground">
                Ingress & edge <ArrowRight className="size-4" />
              </AuthDashboardNetworkIngress.Link>
            </CardTitle>
            <CardDescription>Each lane is its own Traefik entrypoint; a route is attached to the lanes its visibility allows.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {(['local', 'private', 'public'] as const).map((lane) => {
              const on = lanes.includes(lane)
              const copy = LANE_COPY[lane]
              const Icon = copy.icon
              return (
                <div key={lane} className={on ? 'rounded-md border p-3' : 'rounded-md border border-dashed p-3 opacity-60'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="size-4" />
                    <span className="font-medium">{copy.label}</span>
                    {on && ingress.domains[lane] !== null ? <Mono>{`*.${ingress.domains[lane]}`}</Mono> : <Badge variant="outline">off</Badge>}
                    {lane === 'public' && edge !== null ? (
                      <>
                        <span className="text-sm text-muted-foreground">via {edge.provider?.label ?? edge.providerId}</span>
                        <EdgeHealthBadge health={edge.status.health} />
                      </>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{copy.blurb}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>
        <ExposureCard exposure={ingress.exposure} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Cable className="size-4" />
                Mesh
              </span>
              <AuthDashboardNetworkMesh.Link className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground">
                Members <ArrowRight className="size-4" />
              </AuthDashboardNetworkMesh.Link>
            </CardTitle>
            <CardDescription>The WireGuard network Swarm and the private lane run on.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {!ingress.mesh.available ? (
              <StatusBadge status="failed">agent unreachable</StatusBadge>
            ) : (
              <>
                <div>
                  This node: <Mono>{ingress.mesh.address ?? '—'}</Mono>{' '}
                  <StatusBadge status={ingress.mesh.interfaceUp ? 'running' : 'failed'}>{ingress.mesh.interfaceUp ? 'interface up' : 'interface down'}</StatusBadge>
                </div>
                <div>
                  {peers.length === 0 ? 'No other member yet.' : `${String(direct)} of ${String(peers.length)} peers linked directly.`}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>DNS</span>
              <AuthDashboardNetworkDns.Link className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground">
                Records <ArrowRight className="size-4" />
              </AuthDashboardNetworkDns.Link>
            </CardTitle>
            <CardDescription>Where the lanes’ names point.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {ingress.dns.length === 0
              ? 'No record is needed by the current lanes.'
              : dnsIssues === 0
                ? `${String(ingress.dns.length)} record set${ingress.dns.length === 1 ? '' : 's'} in sync.`
                : `${String(dnsIssues)} of ${String(ingress.dns.length)} record sets need attention.`}
          </CardContent>
        </Card>
      </div>

      <JoinPathsCard entryPoints={ingress.entryPoints} />
    </>
  )
}
