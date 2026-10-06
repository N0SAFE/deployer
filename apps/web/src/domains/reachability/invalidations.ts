import { reachabilityEndpoints } from './endpoints'
import type { InvalidationConfig } from '../shared/helpers'

type ReachabilityEndpoints = typeof reachabilityEndpoints

export const reachabilityInvalidations: InvalidationConfig<ReachabilityEndpoints> = {
  // When node network config changes, the domain gate + config + public IP +
  // the public access point all refresh.
  updateNodeNetworkConfig: ({ keys }) => [
    keys.getNodeNetworkConfig({ input: { nodeId: undefined } }),
    keys.listNodeNetworkConfigs({ input: {} }),
    keys.checkDomainGate({ input: {} }),
    keys.getPublicIp({ input: {} }),
    keys.getPublicAccessPoint({ input: {} }),
  ],
  // Switching the edge mode changes whether the ingress publishes a port AND
  // whether a tunnel connector runs, so the edge, its health, and the derived
  // access point all become stale at once.
  setStackEdgeMode: ({ keys }) => [
    keys.getStackEdge({ input: {} }),
    keys.getTunnelHealth({ input: {} }),
    keys.checkDomainGate({ input: {} }),
    keys.getPublicAccessPoint({ input: {} }),
    keys.getNodeNetworkConfig({ input: { nodeId: undefined } }),
  ],
  // Deleting the tunnel drops the edge back to `direct` reachability.
  clearStackEdgeTunnel: ({ keys }) => [
    keys.getStackEdge({ input: {} }),
    keys.getTunnelHealth({ input: {} }),
    keys.checkDomainGate({ input: {} }),
    keys.getPublicAccessPoint({ input: {} }),
  ],
}
