import { defineInvalidations, type InvalidationConfig } from '../shared/helpers'
import { reachabilityEndpointOperations } from './endpoints'

type ReachabilityOperations = typeof reachabilityEndpointOperations

export const reachabilityInvalidations: ReturnType<
  typeof defineInvalidations<ReachabilityOperations, InvalidationConfig<ReachabilityOperations>>
> = defineInvalidations(reachabilityEndpointOperations, {
  // When node network config changes, the domain gate + config + public IP +
  // the public access point all refresh.
  updateNodeNetworkConfig: ({ keys }) => [
    keys.getNodeNetworkConfig({ input: { nodeId: undefined } }),
    keys.listNodeNetworkConfigs({ input: {} }),
    keys.checkDomainGate({ input: {} }),
    keys.getPublicIp({ input: {} }),
    keys.getPublicAccessPoint({ input: {} }),
  ],
  // Changing a lane can start or stop the edge connector, open or close inbound
  // ports, and change where the console answers — so the ingress state, the
  // domain gate and the derived public access point all become stale at once.
  updateIngress: ({ keys }) => [
    keys.getIngress({ input: {} }),
    keys.checkDomainGate({ input: {} }),
    keys.getPublicAccessPoint({ input: {} }),
  ],
  // Tearing the public edge down removes it on its provider and turns the public
  // lane off.
  teardownPublicEdge: ({ keys }) => [
    keys.getIngress({ input: {} }),
    keys.checkDomainGate({ input: {} }),
    keys.getPublicAccessPoint({ input: {} }),
  ],
  // A revoked member leaves the roster on the next gossip round.
  revokeMeshMember: ({ keys }) => [keys.getIngress({ input: {} })],
})
