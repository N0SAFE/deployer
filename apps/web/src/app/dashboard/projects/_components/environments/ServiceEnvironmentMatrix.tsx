'use client'

import { Layers } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { EmptyState } from '@/components/dashboard'
import { envLinkKey, kindBadgeVariant, type ProjectEnvironment, type ProjectServiceRow, type ServiceEnvLink } from './types'

/** Service × environment switches. Tri-state: no link row = never configured, on, deliberately off. */
export function ServiceEnvironmentMatrix({
  environments,
  services,
  links,
  pendingKeys,
  onToggle,
}: {
  environments: readonly ProjectEnvironment[]
  services: readonly ProjectServiceRow[]
  links: ReadonlyMap<string, ServiceEnvLink>
  pendingKeys: ReadonlySet<string>
  onToggle: (serviceId: string, environmentId: string, enabled: boolean) => void
}) {
  if (environments.length === 0 || services.length === 0) {
    return (
      <EmptyState
        compact
        icon={Layers}
        title={environments.length === 0 ? 'No environments to place services in' : 'No services in this project yet'}
        description={environments.length === 0 ? 'Create an environment above, then choose which services deploy in it.' : 'Add a service to this project, then choose which environments it deploys to.'}
      />
    )
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-45">Service</TableHead>
            {environments.map((env) => (
              <TableHead key={env.id} className="text-center">
                <div className="flex flex-col items-center gap-1">
                  <span>{env.name}</span>
                  <Badge variant={kindBadgeVariant(env.kind)}>{env.kind}</Badge>
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((svc) => (
            <TableRow key={svc.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{svc.name}</span>
                  {svc.parentId ? <Badge variant="outline">sub-service</Badge> : null}
                </div>
              </TableCell>
              {environments.map((env) => {
                const cellKey = envLinkKey(svc.id, env.id)
                const link = links.get(cellKey)
                // No link row → never configured; isEnabled false → deliberately off.
                // Collapsing the two made every unconfigured cell render as ACTIVE.
                const isConfigured = link !== undefined
                return (
                  <TableCell key={env.id} className="text-center">
                    <Switch
                      checked={link?.isEnabled === true}
                      onCheckedChange={(v) => { onToggle(svc.id, env.id, v) }}
                      disabled={pendingKeys.has(cellKey)}
                      aria-label={isConfigured ? `${svc.name} in ${env.name}` : `${svc.name} in ${env.name} — not configured`}
                      title={isConfigured ? undefined : 'Not configured — turn on to enable'}
                      className={isConfigured ? undefined : 'opacity-40'}
                    />
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
