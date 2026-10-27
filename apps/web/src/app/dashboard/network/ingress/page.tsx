'use client'

import { DoorOpen } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { EmptyState, PageHeader } from '@/components/dashboard'
import { NodeNetworkConfig } from '@/components/dashboard/system/NodeNetworkConfig'
import { DoorsTable } from '../_components/doors-table'
import { ExposureCard } from '../_components/exposure-card'
import { WithIngress } from '../_components/ingress-query-state'
import { ConsoleVisibilityCard, LocalLaneCard, PrivateLaneCard } from '../_components/lane-cards'
import { PublicEdgePanel } from '../_components/public-edge-panel'
import { useCanManageNetwork } from '../_components/use-can-manage-network'

/**
 * Ingress & edge — the lanes clients reach Traefik through, and the edge provider
 * that carries the public one.
 *
 *   local     loopback door on every node                    always on
 *   private   door on each node's mesh address               members only
 *   public    one pluggable edge provider for the stack      the internet
 *
 * Every lane is a separate Traefik entrypoint, so a route marked `private` simply
 * has no public router: the public lane cannot serve it even by accident.
 */
export default function NetworkIngressPage() {
  const canEdit = useCanManageNetwork()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Network"
        title="Ingress & edge"
        description="How clients reach the stack. A lane is one way in (local, private or public) and can be on alongside the others; each route picks the lanes it is visible on. A door is the listener a node runs for a lane. The edge provider is the one service that carries the public lane to the internet."
      />
      <WithIngress>
        {(ingress) => {
          const inbound = ingress.edge.active?.provider?.opensInboundPorts === true
          return (
            <>
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <LocalLaneCard ingress={ingress} canEdit={canEdit} />
                <PrivateLaneCard ingress={ingress} canEdit={canEdit} />
              </div>
              <PublicEdgePanel ingress={ingress} canEdit={canEdit} />
              {inbound ? <NodeNetworkConfig /> : null}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <ConsoleVisibilityCard ingress={ingress} canEdit={canEdit} />
                <ExposureCard exposure={ingress.exposure} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DoorOpen className="size-4" />
                    Doors on this node
                  </CardTitle>
                  <CardDescription>
                    Listeners the node’s mesh agent runs in front of Traefik — the only thing that binds a host address.
                    The local door falls back to the console directly if Traefik stops answering.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ingress.mesh.doors.length === 0 ? (
                    <EmptyState
                      icon={DoorOpen}
                      title={ingress.mesh.available ? 'No door yet' : 'Mesh agent not reachable'}
                      description={
                        ingress.mesh.available
                          ? 'The ingress supervisor publishes the doors on its next sweep.'
                          : (ingress.mesh.lastError ?? 'This node’s mesh agent does not answer, so it runs no door.')
                      }
                      compact
                    />
                  ) : (
                    <DoorsTable doors={ingress.mesh.doors} />
                  )}
                </CardContent>
              </Card>
            </>
          )
        }}
      </WithIngress>
    </div>
  )
}
