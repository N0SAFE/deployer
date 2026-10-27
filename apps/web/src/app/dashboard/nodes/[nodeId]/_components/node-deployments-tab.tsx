'use client'

import { ArrowRight, Rocket } from 'lucide-react'
import { AuthDashboardDeployments } from '@/routes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState, StatusBadge } from '@/components/dashboard'
import { Age } from '../../../network/_components/network-copy'
import { CopyButton } from '../../../network/_components/copy-button'

export interface DeploymentRow {
  id: string
  serviceId: string
  status: string
  environment?: string | null
  deployStartedAt?: string | null
  createdAt?: string | null
}

export function NodeDeploymentsTab({ deployments }: { deployments: readonly DeploymentRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <span>Deployments on this node</span>
          <AuthDashboardDeployments.Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            All deployments <ArrowRight className="size-3.5" />
          </AuthDashboardDeployments.Link>
        </CardTitle>
        <CardDescription>The 10 most recent deployments that ran here.</CardDescription>
      </CardHeader>
      <CardContent>
        {deployments.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No deployments on this node yet"
            description="Deployments appear here once a service is scheduled onto this node."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deployment</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 font-mono text-xs">
                      {d.id.slice(0, 8)}
                      <CopyButton value={d.id} label={`Copy deployment id ${d.id}`} />
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{d.serviceId}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.environment ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <Age at={d.deployStartedAt ?? d.createdAt ?? null} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
