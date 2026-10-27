'use client'

import { Network } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { EmptyState, PageHeader } from '@/components/dashboard'
import { AuthDashboardAdminProvidersDns } from '@/routes'
import { DnsRecordsTable } from '../_components/dns-records-table'
import { WithIngress } from '../_components/ingress-query-state'
import { Mono } from '../_components/network-copy'

/**
 * Network DNS — the records the lanes need, kept apart from ingress on purpose:
 * ingress decides how a packet reaches Traefik, DNS decides where a NAME points.
 *
 *   public    whatever the edge provider asks for (a CNAME to a tunnel, A records…)
 *   private   *.<private domain> → every node's mesh address (real domains only)
 *   local     nothing — *.localhost always resolves to loopback
 */
export default function NetworkDnsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Network"
        title="DNS"
        description="Records the lanes need, converged through whichever DNS provider account owns each zone. A record no provider can write is listed as manual, with exactly what to create."
      />
      <WithIngress>
        {(ingress) => (
          <Card>
            <CardHeader>
              <CardTitle>Lane records</CardTitle>
              <CardDescription>
                Reconciled when the lanes change and every 10 minutes (mesh and public addresses move as nodes come and go).
                Accounts are managed under{' '}
                <AuthDashboardAdminProvidersDns.Link className="underline">DNS providers</AuthDashboardAdminProvidersDns.Link>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ingress.dns.length === 0 ? (
                <EmptyState
                  icon={Network}
                  title="No record needed"
                  description={
                    ingress.lanes.public === null && !ingress.lanes.private.enabled
                      ? 'Only the local lane is on, and *.localhost resolves to loopback by itself.'
                      : 'The enabled lanes need no public record yet (a private domain under a reserved suffix such as .internal resolves on the mesh, and an edge that is not provisioned asks for nothing).'
                  }
                  compact
                />
              ) : (
                <DnsRecordsTable records={ingress.dns} />
              )}
              {ingress.lanes.private.enabled ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Private domain <Mono>{ingress.lanes.private.domain}</Mono>: members resolve it through the mesh; nothing about
                  it is published unless it is a real, publicly delegated domain.
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}
      </WithIngress>
    </div>
  )
}
