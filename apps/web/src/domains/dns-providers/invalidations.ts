import type { InvalidationConfig } from '../shared/helpers'
import type { DnsProviderEndpoints } from './endpoints'

export const dnsProviderInvalidations: InvalidationConfig<DnsProviderEndpoints> = {
  list: ({ keys }) => [keys.list()],
  create: ({ keys }) => [keys.list()],
  update: ({ keys }) => [keys.list()],
  delete: ({ keys }) => [keys.list()],
  // Creating/removing a DNS record on a zone changes only that zone's records.
  cloudflareCreateRecord: ({ input, keys }) => {
    const c = (input ?? {}) as { params?: { providerId?: string; zoneId?: string } }
    const providerId = c.params?.providerId
    const zoneId = c.params?.zoneId
    if (!providerId || !zoneId) return []
    return [
      keys.cloudflareListRecords({ input: { params: { providerId, zoneId }, query: {} } }),
    ]
  },
  cloudflareDeleteRecord: ({ input, keys }) => {
    const c = (input ?? {}) as { params?: { providerId?: string; zoneId?: string } }
    const providerId = c.params?.providerId
    const zoneId = c.params?.zoneId
    if (!providerId || !zoneId) return []
    return [
      keys.cloudflareListRecords({ input: { params: { providerId, zoneId }, query: {} } }),
    ]
  },
  // Tunnel mutations refresh the tunnel list + per-tunnel detail.
  cloudflareCreateTunnel: ({ input, keys }) => {
    const c = (input ?? {}) as { params?: { providerId?: string } }
    const providerId = c.params?.providerId
    if (!providerId) return []
    return [keys.cloudflareListTunnels({ input: { params: { providerId } } })]
  },
  cloudflareDeleteTunnel: ({ input, keys }) => {
    const c = (input ?? {}) as { params?: { providerId?: string } }
    const providerId = c.params?.providerId
    if (!providerId) return []
    return [keys.cloudflareListTunnels({ input: { params: { providerId } } })]
  },
}
