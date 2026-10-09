import type { DockerNetwork } from '@repo/contracts-entities'

/** Docker's predefined networks. The engine refuses to remove them. */
const BUILT_IN_NETWORK_NAMES: ReadonlySet<string> = new Set(['bridge', 'host', 'none'])

export function isBuiltInNetwork(name: string): boolean {
  return BUILT_IN_NETWORK_NAMES.has(name)
}

export type NetworkView = 'all' | 'bridge' | 'with-containers' | 'unused'
export type NetworkSortKey = 'name' | 'containers' | 'driver'

export function filterNetworks(
  networks: readonly DockerNetwork[],
  { query, view }: { query: string; view: NetworkView },
): DockerNetwork[] {
  const needle = query.trim().toLowerCase()
  return networks.filter((network) => {
    if (view === 'bridge' && network.driver !== 'bridge') return false
    if (view === 'with-containers' && network.containerIds.length === 0) return false
    if (view === 'unused' && network.containerIds.length > 0) return false
    if (!needle) return true
    return (
      network.name.toLowerCase().includes(needle)
      || network.id.toLowerCase().startsWith(needle)
      || (network.subnet ?? '').includes(needle)
      || network.driver.includes(needle)
    )
  })
}

/** Plain-language observations about a network, derived only from what the engine reported. */
export function describeNetwork(network: Pick<DockerNetwork, 'name' | 'gateway' | 'subnet' | 'containerIds' | 'internal'>): string[] {
  const notes: string[] = []
  if (isBuiltInNetwork(network.name)) notes.push('Built-in network: Docker creates it and does not allow removing it.')
  if (!network.gateway) notes.push('No gateway reported: containers may have no route to other networks.')
  if (!network.subnet) notes.push('No subnet reported: the engine is not assigning addresses from an IPAM pool.')
  if (network.containerIds.length === 0) notes.push('No containers are attached to this network.')
  if (network.internal) notes.push('Internal network: containers on it cannot reach the outside world.')
  return notes
}
