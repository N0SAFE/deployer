import { Badge } from '@repo/ui/components/shadcn/badge'

interface NetworkItem {
  networkId: string
  name: string
  driver: string
  scope: string
  ipv4: string | null
  gateway: string | null
  dnsServers: string[]
  dnsSearch: string[]
}

interface DockerContainerNetworkTabProps {
  networks: NetworkItem[]
  portMappings: Array<{
    hostIp: string
    hostPort: number | null
    containerPort: number
    protocol: string
  }>
}

export function DockerContainerNetworkTab({ networks, portMappings }: DockerContainerNetworkTabProps) {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded border p-3">
        <p className="text-xs text-muted-foreground">Port mappings</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {portMappings.map((port) => (
            <Badge key={`${port.containerPort}-${port.protocol}-${String(port.hostPort)}`} variant="outline">
              {port.hostIp}:{port.hostPort ?? '—'} → {port.containerPort}/{port.protocol}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {networks.map((network) => (
          <div key={network.networkId} className="rounded border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium">{network.name}</p>
              <Badge variant="outline">{network.driver}/{network.scope}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">IPv4:</span> {network.ipv4 ?? '—'}</div>
              <div><span className="text-muted-foreground">Gateway:</span> {network.gateway ?? '—'}</div>
              <div><span className="text-muted-foreground">DNS:</span> {network.dnsServers.join(', ')}</div>
              <div><span className="text-muted-foreground">Search:</span> {network.dnsSearch.join(', ')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}