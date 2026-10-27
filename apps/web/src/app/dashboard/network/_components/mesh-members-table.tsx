'use client'

import { useState } from 'react'
import { Laptop, Server, UserX } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import type { MeshMemberView } from '@deployer/fleet-contracts/modules/reachability/index'
import { useRevokeMeshMember } from '@/domains/reachability/hooks'
import { AuthDashboardNodesNodeId } from '@/routes'
import { Age, LinkPathBadge, Mono } from './network-copy'
import { CopyButton } from './copy-button'
import { useNetworkAction } from './use-network-action'

/** Label a node member carries with its platform node id (mirrors `MEMBER_LABEL_NODE_ID`). */
const NODE_ID_LABEL = 'deployer.node-id'

/**
 * Every member of the mesh as THIS node sees it: its address, the path its
 * WireGuard link takes, and when the last handshake happened. Peer-equal — there
 * is no "master" column, because there is no master: any member can admit or
 * revoke another.
 */
export function MeshMembersTable({ members, canRevoke }: { members: MeshMemberView[]; canRevoke: boolean }) {
  const [revoking, setRevoking] = useState<MeshMemberView | null>(null)
  // This node first, then active members, then the ones that left; by name within each group.
  const rank = (m: MeshMemberView) => (m.self ? 0 : m.state === 'active' ? 1 : 2)
  const sorted = [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Mesh address</TableHead>
            <TableHead title="How traffic from this node reaches the member: direct, connecting, relayed or waiting.">Link path</TableHead>
            <TableHead title="The last time the two WireGuard peers completed a key exchange. A fresh one means the link is up.">Last handshake</TableHead>
            <TableHead>Reached at</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((member) => {
            const nodeId = member.labels[NODE_ID_LABEL]
            const Icon = member.kind === 'node' ? Server : Laptop
            return (
              <TableRow key={member.memberId} className={member.state === 'left' ? 'opacity-50' : undefined}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    {nodeId === undefined ? (
                      <span className="font-medium">{member.name}</span>
                    ) : (
                      <AuthDashboardNodesNodeId.Link nodeId={nodeId} className="font-medium hover:underline">
                        {member.name}
                      </AuthDashboardNodesNodeId.Link>
                    )}
                    {member.self ? <Badge variant="secondary">this node</Badge> : null}
                    {member.kind === 'operator' ? <Badge variant="outline">operator</Badge> : null}
                    {member.state === 'left' ? (
                      <Badge variant="outline" title="Revoked or left the mesh; kept in the roster so it cannot rejoin unnoticed.">left</Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    {member.memberId}
                    <CopyButton value={member.memberId} label={`Copy member id of ${member.name}`} />
                  </div>
                </TableCell>
                <TableCell>
                  <Mono>{member.address}</Mono>
                </TableCell>
                <TableCell>
                  <LinkPathBadge path={member.link.path} />
                </TableCell>
                <TableCell>{member.self ? <span className="text-muted-foreground">—</span> : <Age at={member.link.latestHandshakeAt} />}</TableCell>
                <TableCell className="max-w-64">
                  {member.link.endpoint !== null ? (
                    <Mono>{member.link.endpoint}</Mono>
                  ) : member.endpoints.length > 0 ? (
                    <span className="text-xs text-muted-foreground" title={member.endpoints.map((e) => `${e.kind} ${e.address}`).join('\n')}>
                      {member.endpoints.length} candidate{member.endpoints.length === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canRevoke && !member.self && member.state === 'active' ? (
                    <Button variant="ghost" size="sm" onClick={() => { setRevoking(member); }}>
                      <UserX className="size-4" />
                      Revoke
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <RevokeMemberDialog member={revoking} onClose={() => { setRevoking(null); }} />
    </>
  )
}

function RevokeMemberDialog({ member, onClose }: { member: MeshMemberView | null; onClose: () => void }) {
  const revoke = useRevokeMeshMember()
  const { run } = useNetworkAction()
  const [reason, setReason] = useState('')

  const submit = async () => {
    if (member === null) return
    const ok = await run(`Revoked ${member.name}`, () => revoke.mutateAsync({ memberId: member.memberId, reason: reason.trim() }))
    if (ok) {
      setReason('')
      onClose()
    }
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {member?.name}?</DialogTitle>
          <DialogDescription>
            Every member drops it on the next gossip round and stops accepting its WireGuard key. It cannot come back
            without a new admission. Use this for a node that is gone for good or an operator machine that was lost.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="revoke-reason">Reason (kept in the signed revocation)</Label>
          <Input id="revoke-reason" value={reason} onChange={(event) => { setReason(event.target.value); }} placeholder="Decommissioned" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={reason.trim() === '' || revoke.isPending} onClick={() => void submit()}>
            Revoke member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
