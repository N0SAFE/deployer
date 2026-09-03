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
}
