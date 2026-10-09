'use client'

import { Cable, CircleAlert, ListOrdered, Server, Users, Waypoints } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { EmptyState, PageHeader, StatStrip, StatStripItem } from '@/components/dashboard'
import type { IngressState } from '@repo/api-contracts/modules/reachability/index'
import { WithIngress } from '../_components/ingress-query-state'
import { JoinPathsCard } from '../_components/join-paths-card'
import { MeshMembersTable } from '../_components/mesh-members-table'
import { Age, LinkPathLegend, Mono } from '../_components/network-copy'
import { useCanManageNetwork } from '../_components/use-can-manage-network'

/**
 * Mesh — the WireGuard network every node (and operator machine) is a member of.
 *
 * Peer-equal: every member holds the full signed roster, any member can admit or
 * revoke another, and there is no coordinator to lose. Swarm, the private lane and
 * the doors all ride on the addresses shown here.
 */
export default function NetworkMeshPage() {
  const canRevoke = useCanManageNetwork()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Network"
        title="Mesh"
        description="The private WireGuard network under everything: Swarm, the private lane and the node doors use these addresses. No member is in charge — each one holds the whole roster."
      />
      <WithIngress>
        {(ingress) =>
          !ingress.mesh.available ? (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>This node’s mesh agent is not reachable</AlertTitle>
              <AlertDescription>
                {ingress.mesh.lastError ?? 'The agent does not answer on its socket.'} Setup starts the agent on a fresh node;
                on an upgraded node the API starts it at boot. Check the <Mono>deployer-mesh-agent</Mono> container.
              </AlertDescription>
            </Alert>
          ) : ingress.mesh.clusterId === null ? (
            <EmptyState
              icon={Waypoints}
              title="This node is in no mesh yet"
              description="A lone node founds its own mesh when setup completes; a node joining a cluster is admitted by a member during the join."
            />
          ) : (
            <MeshContent ingress={ingress} canRevoke={canRevoke} />
          )
        }
      </WithIngress>
    </div>
  )
}

function MeshContent({ ingress, canRevoke }: { ingress: IngressState; canRevoke: boolean }) {
  const { mesh } = ingress
  const active = mesh.members.filter((member) => member.state === 'active')
  const peers = active.filter((member) => !member.self)
  const direct = peers.filter((member) => member.link.path === 'direct').length
  return (
    <>
      <StatStrip>
        <StatStripItem icon={Users} label="Members" value={String(active.length)} hint={`${String(active.filter((m) => m.kind === 'node').length)} nodes`} />
        <StatStripItem
          icon={Cable}
          label="Direct links"
          value={`${String(direct)} / ${String(peers.length)}`}
          tone={peers.length === 0 || direct === peers.length ? 'live' : 'pending'}
          hint="peers with a fresh handshake"
        />
        <StatStripItem icon={Server} label="This node" value={mesh.address ?? '—'} tone={mesh.interfaceUp ? 'live' : 'danger'} hint={mesh.interfaceUp ? 'interface up' : 'interface down'} />
        <StatStripItem icon={Waypoints} label="Address range" value={mesh.cidr ?? '—'} />
      </StatStrip>

      {mesh.lastError !== null ? (
        <Alert>
          <CircleAlert className="size-4" />
          <AlertTitle>The agent reported a problem</AlertTitle>
          <AlertDescription>{mesh.lastError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            As this node sees them. A link goes <em>direct</em> once a WireGuard handshake (the key exchange between two peers) is
            fresh; until then the agent tries each candidate endpoint (same LAN first, then declared, then STUN-discovered).
            Members that left are dimmed at the bottom.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MeshMembersTable members={mesh.members} canRevoke={canRevoke} />
          <div className="mt-4 border-t pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Link path</p>
            <LinkPathLegend />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <JoinPathsCard entryPoints={ingress.entryPoints} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="size-4" />
              Adding a node
            </CardTitle>
            <CardDescription>What happens when a fresh machine joins — nothing to configure by hand.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
              <li>Install the deployer on the new machine and open its setup wizard (it is served on that machine only).</li>
              <li>Choose “Join an existing cluster” and enter the address of one of the paths on the left.</li>
              <li>Sign in with an admin account of this cluster. A one-time join grant is issued for that node.</li>
              <li>
                The new node’s mesh agent signs a join request; the member it reached admits it, and the signed roster
                gossips to every other member — no central server records it.
              </li>
              <li>Its WireGuard links come up, then it joins Swarm over its mesh address. It appears above within seconds.</li>
            </ol>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <dt>Cluster</dt>
              <dd>
                <Mono>{mesh.clusterId ?? '—'}</Mono>
              </dd>
              <dt>WireGuard port</dt>
              <dd>{mesh.listenPort === null ? '—' : `udp/${String(mesh.listenPort)} — peers dial each other; two members both behind strict NAT need a relay (not available yet)`}</dd>
              <dt>Last gossip</dt>
              <dd>
                <Age at={mesh.lastGossipAt} />
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
