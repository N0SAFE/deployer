'use client'

import { ArrowRight, Waypoints } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { useIngress, useListNodeNetworkConfigs } from '@/domains/reachability/hooks'
import { AuthDashboardNetworkMesh } from '@/routes'
import { Age, LinkPathBadge, Mono } from './network-copy'

/** Label a node member carries with its platform node id (mirrors `MEMBER_LABEL_NODE_ID`). */
const NODE_ID_LABEL = 'deployer.node-id'

/**
 * One node's place in the network: its mesh member (address, link from the node
 * serving this page, last handshake) and its declared public address. Used on the
 * node detail page so a node and its network identity read as one thing.
 */
export function NodeNetworkCard({ nodeId }: { nodeId: string }) {
  const { data: ingress } = useIngress()
  const { data: configs } = useListNodeNetworkConfigs()
  const member = ingress?.mesh.members.find((candidate) => candidate.labels[NODE_ID_LABEL] === nodeId) ?? null
  const publicAddress = configs?.configs.find((config) => config.nodeId === nodeId)?.publicAddress ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Waypoints className="size-4" />
            Network
          </span>
          <AuthDashboardNetworkMesh.Link className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground">
            Mesh <ArrowRight className="size-4" />
          </AuthDashboardNetworkMesh.Link>
        </CardTitle>
        <CardDescription>This node in the WireGuard mesh, as the node serving this page sees it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {member === null ? (
          <p className="text-muted-foreground">
            {ingress?.mesh.available === false
              ? 'The mesh agent of the node serving this page is not reachable.'
              : 'No mesh member carries this node’s id yet. A node labels itself once its API has started on it.'}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Mesh address</span>
              <Mono>{member.address}</Mono>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Link</span>
              <LinkPathBadge path={member.link.path} />
            </div>
            {member.self ? null : (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last handshake</span>
                <Age at={member.link.latestHandshakeAt} />
              </div>
            )}
          </>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Declared public address</span>
          {publicAddress === null ? <span className="text-muted-foreground">none</span> : <Mono>{publicAddress}</Mono>}
        </div>
      </CardContent>
    </Card>
  )
}
