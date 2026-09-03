'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { dnsProviderEndpoints, dnsProviderEndpointOperations } from './endpoints'
import { wrapWithInvalidations } from '../shared/helpers'
import { dnsProviderInvalidations } from './invalidations'

const enhancedDnsProviders = wrapWithInvalidations(dnsProviderEndpointOperations, dnsProviderInvalidations as never)

// ─── Provider app CRUD ──────────────────────────────────────────────────

export function useDNSProviders() {
  return useQuery(
    dnsProviderEndpoints.list.queryOptions({ input: {} }),
  )
}

export function useCreateDNSProvider() {
  return useMutation(
    dnsProviderEndpoints.create.mutationOptions({
      onSuccess: enhancedDnsProviders.create.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateDNSProvider() {
  return useMutation(
    dnsProviderEndpoints.update.mutationOptions({
      onSuccess: enhancedDnsProviders.update.withInvalidationOnSuccess(),
    }),
  )
}

export function useDeleteDNSProvider() {
  return useMutation(
    dnsProviderEndpoints.delete.mutationOptions({
      onSuccess: enhancedDnsProviders.delete.withInvalidationOnSuccess(),
    }),
  )
}

/** Force a live runtime re-check of a provider app's state. */
export function useCheckProviderState() {
  return useMutation(dnsProviderEndpoints.checkState.mutationOptions())
}

// ─── Cloudflare Zones / Records ─────────────────────────────────────────

/** Query the zones a provider token can manage. Enabled only when a provider is selected. */
export function useCloudflareZones(providerId?: string) {
  return useQuery({
    ...dnsProviderEndpoints.cloudflareListZones.queryOptions({
      input: { params: { providerId: providerId ?? '' } },
    }),
    enabled: !!providerId,
  })
}

/** Query the DNS records of a provider zone, filterable + paginated. */
const CLOUDFLARE_RECORD_TYPES = ['A', 'AAAA', 'CAA', 'CERT', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'LOC', 'MX', 'NAPTR', 'NS', 'OPENPGPKEY', 'PTR', 'SMIMEA', 'SRV', 'SVCB', 'TLSA', 'TXT', 'URI'] as const

export function useCloudflareRecords(
  providerId: string | undefined,
  zoneId: string | undefined,
  filters?: { type?: (typeof CLOUDFLARE_RECORD_TYPES)[number]; name?: string; page?: number; pageSize?: number },
) {
  return useQuery({
    ...dnsProviderEndpoints.cloudflareListRecords.queryOptions({
      input: {
        params: { providerId: providerId ?? '', zoneId: zoneId ?? '' },
        query: {
          type: filters?.type,
          name: filters?.name,
          page: filters?.page,
          pageSize: filters?.pageSize,
        },
      },
    }),
    enabled: !!providerId && !!zoneId,
  })
}

/** One-shot zone fetch (mutation form, e.g. inside a dialog submit). */
export function useCloudflareListZones() {
  return useMutation(dnsProviderEndpoints.cloudflareListZones.mutationOptions())
}

export function useCloudflareCheckRecord() {
  return useMutation(dnsProviderEndpoints.cloudflareCheckRecord.mutationOptions())
}

/** Create a DNS record on a Cloudflare zone; invalidates the zone's record list. */
export function useCloudflareCreateRecord() {
  return useMutation(
    dnsProviderEndpoints.cloudflareCreateRecord.mutationOptions({
      onSuccess: enhancedDnsProviders.cloudflareCreateRecord.withInvalidationOnSuccess(),
    }),
  )
}

/** Delete a DNS record on a Cloudflare zone. */
export function useCloudflareDeleteRecord() {
  return useMutation(
    dnsProviderEndpoints.cloudflareDeleteRecord.mutationOptions({
      onSuccess: enhancedDnsProviders.cloudflareDeleteRecord.withInvalidationOnSuccess(),
    }),
  )
}

// ─── Cloudflare Tunnels ─────────────────────────────────────────────────

export function useCloudflareTunnels(providerId?: string) {
  return useQuery({
    ...dnsProviderEndpoints.cloudflareListTunnels.queryOptions({
      input: { params: { providerId: providerId ?? '' } },
    }),
    enabled: !!providerId,
  })
}

export function useCloudflareTunnel(providerId?: string, tunnelId?: string) {
  return useQuery({
    ...dnsProviderEndpoints.cloudflareGetTunnel.queryOptions({
      input: { params: { providerId: providerId ?? '', id: tunnelId ?? '' } },
    }),
    enabled: !!providerId && !!tunnelId,
  })
}

/** Auto-setup a tunnel on a Cloudflare app (creates tunnel + token + optional CNAME). */
export function useCloudflareCreateTunnel() {
  return useMutation(
    dnsProviderEndpoints.cloudflareCreateTunnel.mutationOptions({
      onSuccess: enhancedDnsProviders.cloudflareCreateTunnel.withInvalidationOnSuccess(),
    }),
  )
}

export function useCloudflareDeleteTunnel() {
  return useMutation(
    dnsProviderEndpoints.cloudflareDeleteTunnel.mutationOptions({
      onSuccess: enhancedDnsProviders.cloudflareDeleteTunnel.withInvalidationOnSuccess(),
    }),
  )
}

export function useCloudflareGetTunnelToken() {
  return useMutation(dnsProviderEndpoints.cloudflareGetTunnelToken.mutationOptions())
}
