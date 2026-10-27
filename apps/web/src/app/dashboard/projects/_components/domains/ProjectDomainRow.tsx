'use client'

import { useEffect } from 'react'
import { CircleAlert, CircleCheck, CircleX, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { TableCell, TableRow } from '@deployer/ui/components/shadcn/table'
import { StatusBadge } from '@/components/dashboard'
import { useDomainReachabilityCheck } from '@/domains/reachability/hooks'
import { RelativeTime } from '../workload/RelativeTime'

export interface ProjectDomain {
  id: string
  domain: string
  verificationStatus: string
  isPrimary: boolean
  createdAt: Date | string
}

/** One domain. Owns its own reachability check (runs on mount, re-run on demand). */
export function ProjectDomainRow({ domain, onRemove }: { domain: ProjectDomain; onRemove: (domain: ProjectDomain) => void }) {
  const check = useDomainReachabilityCheck()
  const { mutate } = check
  const name = domain.domain

  useEffect(() => { mutate({ domain: name }) }, [mutate, name])

  let reach: { variant: 'outline' | 'default' | 'destructive'; icon: typeof Loader2; label: string; spin?: boolean }
  if (check.isError) reach = { variant: 'outline', icon: CircleAlert, label: 'Check failed' }
  else if (check.data) {
    reach = check.data.dnsMatch === true && check.data.httpReachable
      ? { variant: 'default', icon: CircleCheck, label: 'Reachable' }
      : { variant: 'destructive', icon: CircleX, label: 'Unreachable' }
  } else reach = { variant: 'outline', icon: Loader2, label: 'Checking…', spin: true }
  const ReachIcon = reach.icon

  return (
    <TableRow>
      <TableCell className="font-mono text-sm font-medium">{name}</TableCell>
      <TableCell><StatusBadge status={domain.verificationStatus} /></TableCell>
      <TableCell>
        <Badge variant={reach.variant} className="gap-1" title={check.isError ? 'The reachability probe itself failed; try again.' : undefined}>
          <ReachIcon className={reach.spin ? 'size-3 animate-spin motion-reduce:animate-none' : 'size-3'} aria-hidden />
          {reach.label}
        </Badge>
      </TableCell>
      <TableCell>{domain.isPrimary ? <Badge variant="secondary">Primary</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="text-sm text-muted-foreground"><RelativeTime value={domain.createdAt} /></TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="size-8" disabled={check.isPending} onClick={() => { mutate({ domain: name }) }} title="Check reachability" aria-label={`Check reachability of ${name}`}>
            <RefreshCw className={check.isPending ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'} />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => { onRemove(domain) }} title="Remove" aria-label={`Remove ${name}`}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
