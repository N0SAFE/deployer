'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { StatusBadge } from '@/components/dashboard'
import type { MeshDoorView } from '@repo/api-contracts/modules/reachability/index'
import { Mono } from './network-copy'

const DOOR_LANE: Record<MeshDoorView['lane'], string> = {
  local: 'Local (loopback)',
  private: 'Private (mesh address)',
  lan: 'Private (LAN address)',
}

/**
 * The listeners this node's mesh agent runs in front of Traefik. A door is the
 * only thing that binds a host address — Traefik itself publishes nothing unless
 * an inbound edge asks for it.
 */
export function DoorsTable({ doors }: { doors: MeshDoorView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lane</TableHead>
          <TableHead title="The host address and port the door listens on.">Binds</TableHead>
          <TableHead>State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {doors.map((door) => (
          <TableRow key={door.container}>
            <TableCell>{DOOR_LANE[door.lane]}</TableCell>
            <TableCell>
              <Mono>{`${door.bindAddress}:${String(door.port)}`}</Mono>
            </TableCell>
            <TableCell>
              <StatusBadge status={door.state === 'running' ? 'running' : door.state === 'failed' ? 'failed' : 'pending'}>{door.state}</StatusBadge>
              {door.detail !== null ? <p className="mt-1 text-xs text-muted-foreground">{door.detail}</p> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
