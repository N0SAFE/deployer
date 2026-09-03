import { orpc } from '@/lib/orpc'

export const dnsProviderEndpoints = {
  list: orpc.providers.dns.list,
  create: orpc.providers.dns.create,
  update: orpc.providers.dns.update,
  delete: orpc.providers.dns.delete,
  checkState: orpc.providers.dns.checkState,
  cloudflareListZones: orpc.providers.dns.cloudflare.listZones,
  cloudflareListRecords: orpc.providers.dns.cloudflare.listRecords,
  cloudflareCheckRecord: orpc.providers.dns.cloudflare.checkRecord,
  cloudflareCreateRecord: orpc.providers.dns.cloudflare.createRecord,
  cloudflareDeleteRecord: orpc.providers.dns.cloudflare.deleteRecord,
  cloudflareListTunnels: orpc.providers.dns.cloudflare.listTunnels,
  cloudflareGetTunnel: orpc.providers.dns.cloudflare.getTunnel,
  cloudflareCreateTunnel: orpc.providers.dns.cloudflare.createTunnel,
  cloudflareDeleteTunnel: orpc.providers.dns.cloudflare.deleteTunnel,
  cloudflareGetTunnelToken: orpc.providers.dns.cloudflare.getTunnelToken,
} as const

export const dnsProviderEndpointOperations = {
  list: dnsProviderEndpoints.list,
  create: dnsProviderEndpoints.create,
  update: dnsProviderEndpoints.update,
  delete: dnsProviderEndpoints.delete,
  cloudflareCreateRecord: dnsProviderEndpoints.cloudflareCreateRecord,
  cloudflareDeleteRecord: dnsProviderEndpoints.cloudflareDeleteRecord,
  cloudflareCreateTunnel: dnsProviderEndpoints.cloudflareCreateTunnel,
  cloudflareDeleteTunnel: dnsProviderEndpoints.cloudflareDeleteTunnel,
  // Query endpoints referenced by the invalidation config (keys.cloudflareList*)
  // — they must be part of the record so getKeysRetrieval exposes their key fns.
  cloudflareListRecords: dnsProviderEndpoints.cloudflareListRecords,
  cloudflareListTunnels: dnsProviderEndpoints.cloudflareListTunnels,
  cloudflareListZones: dnsProviderEndpoints.cloudflareListZones,
  cloudflareGetTunnelToken: dnsProviderEndpoints.cloudflareGetTunnelToken,
}

export type DnsProviderEndpoints = typeof dnsProviderEndpoints
