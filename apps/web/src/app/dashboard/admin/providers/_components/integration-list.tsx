'use client'

import type { ComponentType, ReactNode } from 'react'
import { useMemo } from 'react'
import { ArrowRight, Cloud, Code2, Container, Globe, GitFork, Shield, type LucideIcon } from 'lucide-react'
import { buttonVariants } from '@repo/ui/components/shadcn/button'
import { Card, CardContent } from '@repo/ui/components/shadcn/card'
import { cn } from '@/lib/utils'
import {
  AuthDashboardAdminProvidersCodeDockerHub,
  AuthDashboardAdminProvidersCodeGithub,
  AuthDashboardAdminProvidersCodeGitlab,
  AuthDashboardAdminProvidersDnsCloudflare,
  AuthDashboardAdminProvidersDnsGoogleDns,
  AuthDashboardAdminProvidersDnsRoute53,
  AuthDashboardNetworkIngress,
} from '@/routes'
import { useGitHubApps } from '@/domains/github-apps/hooks'
import { useGitlabApps } from '@/domains/gitlab/hooks'
import { useDNSProviders } from '@/domains/dns-providers/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import {
  deriveDnsAppStatus,
  deriveStoredCredentialStatus,
  summarizeAccounts,
  unavailableStatus,
  type IntegrationCta,
  type IntegrationStatus,
} from '../_lib/provider-status'
import { IntegrationStatusBadge } from './status-line'
import { ProviderLoadError } from './states'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

interface RouteLike {
  (): string
  Link: ComponentType<{ className?: string; children?: ReactNode }>
}

export type IntegrationGroup = 'code' | 'dns'

interface IntegrationDef {
  id: string
  group: IntegrationGroup
  name: string
  icon: LucideIcon
  /** What connecting this unlocks, in the operator's words. */
  enables: ReactNode
  route: RouteLike
}

const CTA_LABEL: Record<IntegrationCta, string> = {
  connect: 'Connect',
  review: 'Review',
  fix: 'Fix connection',
  manage: 'Manage',
  details: 'Details',
}

function Row({ def, status, loading }: { def: IntegrationDef; status: IntegrationStatus | null; loading: boolean }) {
  const Icon = def.icon
  const RouteLink = def.route.Link
  const primary = status?.cta === 'connect' || status?.cta === 'fix'
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{def.name}</h3>
            {loading ? <Skeleton className="h-5 w-28" /> : status ? <IntegrationStatusBadge status={status} /> : null}
          </div>
          <p className="text-sm text-muted-foreground">{def.enables}</p>
          {status ? <p className="text-sm text-muted-foreground">{status.detail}</p> : null}
        </div>
        <RouteLink
          className={cn(buttonVariants({ size: 'sm', variant: primary ? 'default' : 'outline' }), 'shrink-0')}
        >
          {status ? CTA_LABEL[status.cta] : 'Open'}
          <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
          <span className="sr-only"> {def.name}</span>
        </RouteLink>
      </CardContent>
    </Card>
  )
}

const DEFS: readonly IntegrationDef[] = [
  {
    id: 'github',
    group: 'code',
    name: 'GitHub',
    icon: GitFork,
    enables: 'Deploy services from your repositories, receive push webhooks and get a preview per branch or pull request.',
    route: AuthDashboardAdminProvidersCodeGithub,
  },
  {
    id: 'gitlab',
    group: 'code',
    name: 'GitLab',
    icon: Code2,
    enables: 'Deploy services from GitLab.com or a self-hosted GitLab with an access token.',
    route: AuthDashboardAdminProvidersCodeGitlab,
  },
  {
    id: 'docker-hub',
    group: 'code',
    name: 'Docker Hub',
    icon: Container,
    enables: 'Pull private images from Docker Hub or another registry (planned).',
    route: AuthDashboardAdminProvidersCodeDockerHub,
  },
  {
    id: 'cloudflare',
    group: 'dns',
    name: 'Cloudflare',
    icon: Cloud,
    enables: (
      <>
        DNS records for your domains and Cloudflare Tunnels. The Cloudflare Tunnel public edge runs on one of these accounts — set that
        up in{' '}
        <AuthDashboardNetworkIngress.Link className="font-medium text-primary hover:underline">Network → Ingress &amp; edge</AuthDashboardNetworkIngress.Link>.
      </>
    ),
    route: AuthDashboardAdminProvidersDnsCloudflare,
  },
  {
    id: 'route53',
    group: 'dns',
    name: 'AWS Route 53',
    icon: Globe,
    enables: 'DNS records for domains hosted in Route 53 (planned).',
    route: AuthDashboardAdminProvidersDnsRoute53,
  },
  {
    id: 'google-dns',
    group: 'dns',
    name: 'Google Cloud DNS',
    icon: Shield,
    enables: 'DNS records for zones hosted in Google Cloud DNS (planned).',
    route: AuthDashboardAdminProvidersDnsGoogleDns,
  },
]

const DOCKER_HUB_STATUS = unavailableStatus('The platform cannot store registry credentials yet, so nothing can be connected.')
const ROUTE53_STATUS = unavailableStatus('Only Cloudflare is implemented for DNS today; Route 53 accounts cannot be connected yet.')
const GOOGLE_DNS_STATUS = unavailableStatus('Only Cloudflare is implemented for DNS today; Cloud DNS accounts cannot be connected yet.')

/** Every integration of a group with its live connection status and one primary action. */
export function IntegrationList({ group }: { group: IntegrationGroup }) {
  const github = useGitHubApps()
  const gitlab = useGitlabApps()
  const dns = useDNSProviders()

  const statuses = useMemo<Record<string, IntegrationStatus | null>>(() => {
    const dnsApps = dns.data?.providers ?? []
    const dnsStatus = (type: string): IntegrationStatus | null =>
      dns.data ? summarizeAccounts(dnsApps.filter((p) => p.providerType === type).map(deriveDnsAppStatus)) : null
    return {
      github: github.data ? deriveStoredCredentialStatus(github.data.apps) : null,
      gitlab: gitlab.data ? deriveStoredCredentialStatus(gitlab.data.apps) : null,
      'docker-hub': DOCKER_HUB_STATUS,
      cloudflare: dnsStatus('cloudflare'),
      route53: ROUTE53_STATUS,
      'google-dns': GOOGLE_DNS_STATUS,
    }
  }, [github.data, gitlab.data, dns.data])

  const queries = group === 'code' ? [github, gitlab] : [dns]
  const failed = queries.find((q) => q.error)
  const loadingOf = (id: string) =>
    (id === 'github' && github.isLoading) || (id === 'gitlab' && gitlab.isLoading) || (id === 'cloudflare' && dns.isLoading)

  return (
    <div className="space-y-3">
      {failed ? (
        <ProviderLoadError
          what="connection status"
          message={getErrorMessage(failed.error, 'The API did not answer. Statuses below may be out of date.')}
          onRetry={() => { queries.forEach((q) => void q.refetch()); }}
        />
      ) : null}
      {DEFS.filter((d) => d.group === group).map((def) => (
        <Row key={def.id} def={def} status={statuses[def.id] ?? null} loading={loadingOf(def.id)} />
      ))}
    </div>
  )
}

/** Counts used by the hub's one-line summary. */
export function useIntegrationSummary(): { connected: number; attention: number; total: number; loading: boolean } {
  const github = useGitHubApps()
  const gitlab = useGitlabApps()
  const dns = useDNSProviders()
  return useMemo(() => {
    const dnsApps = dns.data?.providers ?? []
    const per = [summarizeAccounts(dnsApps.filter((p) => p.providerType === 'cloudflare').map(deriveDnsAppStatus))]
    const all = [
      deriveStoredCredentialStatus(github.data?.apps ?? []),
      deriveStoredCredentialStatus(gitlab.data?.apps ?? []),
      ...per,
    ]
    return {
      connected: all.filter((s) => s.status === 'connected').length,
      attention: all.filter((s) => s.status === 'error' || s.status === 'unknown').length,
      total: all.length,
      loading: github.isLoading || gitlab.isLoading || dns.isLoading,
    }
  }, [github.data, github.isLoading, gitlab.data, gitlab.isLoading, dns.data, dns.isLoading])
}
