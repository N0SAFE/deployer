'use client'

import { useMemo } from 'react'
import { Globe } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import { useAddServiceDomain, useProjectDomains, useRemoveServiceDomain, useServiceDomains } from '@/domains/domain/hooks'
import { AddDomainEntryForm } from './service-domains/AddDomainEntryForm'
import { DomainEntryRow } from './service-domains/DomainEntryRow'
import type { ServiceDomainEntry } from './service-domains/domain-url'
import { InlineError } from './workload/WorkloadStates'

export type { ServiceDomainEntry }

interface ServiceDomainConfigProps {
  projectId: string
  /** When provided, the component manages real mappings via the API (connected mode). */
  serviceId?: string
  /** Controlled mode (e.g. creation wizard): entries are managed by the parent. */
  value?: ServiceDomainEntry[]
  onChange?: (entries: ServiceDomainEntry[]) => void
  disabled?: boolean
}

interface DisplayEntry {
  key: string
  domainName: string
  subdomain: string | null
  basePath: string | null
  isPrimary: boolean
  sslEnabled: boolean
  sslProvider: string
  remove: () => void
}

const errDescription = (err: unknown): string => (isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE)

export function ServiceDomainConfig({ projectId, serviceId, value, onChange, disabled }: ServiceDomainConfigProps) {
  const projectDomainsQuery = useProjectDomains(projectId)
  const { data: serviceDomainsData } = useServiceDomains(serviceId ?? '')
  const addServiceDomain = useAddServiceDomain()
  const removeServiceDomain = useRemoveServiceDomain()

  const isControlled = serviceId === undefined
  const projectDomains = useMemo(() => projectDomainsQuery.data ?? [], [projectDomainsQuery.data])
  const connectedMappings = useMemo(() => (isControlled ? [] : (serviceDomainsData ?? [])), [isControlled, serviceDomainsData])

  const existingProjectDomainIds = useMemo(() => {
    const source = isControlled ? (value ?? []) : connectedMappings
    return new Set(source.map((e) => e.projectDomainId))
  }, [isControlled, value, connectedMappings])

  const domainNameById = useMemo(() => new Map(projectDomains.map((d) => [d.id, d.domain])), [projectDomains])

  const addControlled = (entry: ServiceDomainEntry) => { onChange?.([...(value ?? []), entry]) }

  const addConnected = (entry: ServiceDomainEntry) => {
    if (!serviceId) return
    void addServiceDomain
      .mutateAsync({
        params: { serviceId },
        body: {
          projectDomainId: entry.projectDomainId,
          subdomain: entry.subdomain,
          basePath: entry.basePath,
          isPrimary: entry.isPrimary,
          sslEnabled: entry.sslEnabled,
          sslProvider: 'letsencrypt',
        },
      })
      .then(() => { toast.success('Domain attached to service') })
      .catch((err: unknown) => { toast.error('Failed to attach domain', { description: errDescription(err) }) })
  }

  const removeConnected = (mappingId: string) => {
    if (!serviceId) return
    void removeServiceDomain
      .mutateAsync({ params: { serviceId, mappingId } })
      .then(() => { toast.success('Domain removed from service') })
      .catch((err: unknown) => { toast.error('Failed to remove domain', { description: errDescription(err) }) })
  }

  if (projectDomainsQuery.isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading domains" className="space-y-2">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    )
  }
  if (projectDomainsQuery.error) {
    return <InlineError title="Could not load this project's domains" error={projectDomainsQuery.error} onRetry={() => { void projectDomainsQuery.refetch() }} />
  }

  const entries: DisplayEntry[] = isControlled
    ? (value ?? []).map((e, i) => ({
        key: `entry-${String(i)}`,
        domainName: domainNameById.get(e.projectDomainId) ?? 'unknown domain',
        subdomain: e.subdomain,
        basePath: e.basePath,
        isPrimary: e.isPrimary,
        sslEnabled: e.sslEnabled,
        sslProvider: 'letsencrypt',
        remove: () => { onChange?.((value ?? []).filter((_, idx) => idx !== i)) },
      }))
    : connectedMappings.map((m) => ({
        key: m.id,
        domainName: domainNameById.get(m.projectDomainId) ?? 'unknown domain',
        subdomain: m.subdomain,
        basePath: m.basePath,
        isPrimary: m.isPrimary,
        sslEnabled: m.sslEnabled,
        sslProvider: m.sslProvider,
        remove: () => { removeConnected(m.id) },
      }))

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <Alert>
          <Globe className="size-4" />
          <AlertTitle>No domains bound yet</AlertTitle>
          <AlertDescription>
            Bind a project domain below to expose this service on a public URL. Subdomains are
            constrained by the domain&apos;s configuration.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <DomainEntryRow
              key={e.key}
              domainName={e.domainName}
              subdomain={e.subdomain}
              basePath={e.basePath}
              isPrimary={e.isPrimary}
              sslEnabled={e.sslEnabled}
              sslProvider={e.sslProvider}
              onRemove={e.remove}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      <AddDomainEntryForm
        projectDomains={projectDomains}
        existingProjectDomainIds={existingProjectDomainIds}
        onAdd={isControlled ? addControlled : addConnected}
        disabled={disabled}
      />
    </div>
  )
}
