'use client'

import { Copy, Layers, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState, StatusBadge } from '@/components/dashboard'
import { kindBadgeVariant, type ProjectEnvironment } from './types'

/** Environments list. Scrolls inside its card at narrow widths; status is badge text + icon. */
export function EnvironmentsTable({
  environments,
  statusById,
  refreshing,
  onRefreshStatus,
  onEdit,
  onClone,
  onDelete,
  onCreate,
}: {
  environments: readonly ProjectEnvironment[]
  statusById: ReadonlyMap<string, string>
  refreshing: boolean
  onRefreshStatus: (env: ProjectEnvironment) => void
  onEdit: (env: ProjectEnvironment) => void
  onClone: (env: ProjectEnvironment) => void
  onDelete: (env: ProjectEnvironment) => void
  onCreate: () => void
}) {
  if (environments.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No environments yet"
        description="A project deploys into environments (production, staging, a preview per branch). Create the first one, then choose which services run in it."
        action={{ label: 'Create environment', onClick: onCreate }}
      />
    )
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-40 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {environments.map((env) => {
            const liveStatus = statusById.get(env.id) ?? env.status
            return (
              <TableRow key={env.id}>
                <TableCell className="font-medium">{env.name}</TableCell>
                <TableCell><Badge variant={kindBadgeVariant(env.kind)}>{env.kind}</Badge></TableCell>
                <TableCell><Badge variant="outline">{env.type ?? '—'}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={liveStatus} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title="Refresh status"
                      aria-label={`Refresh status of ${env.name}`}
                      disabled={refreshing}
                      onClick={() => { onRefreshStatus(env) }}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => { onEdit(env) }} title="Edit" aria-label={`Edit ${env.name}`}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => { onClone(env) }} title="Clone" aria-label={`Clone ${env.name}`}><Copy className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => { onDelete(env) }} title="Delete" aria-label={`Delete ${env.name}`}><Trash2 className="size-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
