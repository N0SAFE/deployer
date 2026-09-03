import { orpc } from '@/lib/orpc'

export const reachabilityEndpoints = {
  check: orpc.reachability.check,
  getConfig: orpc.reachability.getConfig,
  updateConfig: orpc.reachability.updateConfig,
  checkDomain: orpc.reachability.checkDomain,
  getPublicIp: orpc.reachability.getPublicIp,
  getNodeNetworkConfig: orpc.reachability.getNodeNetworkConfig,
  updateNodeNetworkConfig: orpc.reachability.updateNodeNetworkConfig,
  listNodeNetworkConfigs: orpc.reachability.listNodeNetworkConfigs,
  getTunnelHealth: orpc.reachability.getTunnelHealth,
  checkDomainGate: orpc.reachability.checkDomainGate,
  getPublicAccessPoint: orpc.reachability.getPublicAccessPoint,
  watchPublicAccessPoint: orpc.reachability.watchPublicAccessPoint,
} as const

export const reachabilityEndpointOperations = {
  // Queries are included so their keys are available to the invalidation config
  // (keys.getNodeNetworkConfig / checkDomainGate / getPublicIp / getPublicAccessPoint).
  getNodeNetworkConfig: reachabilityEndpoints.getNodeNetworkConfig,
  listNodeNetworkConfigs: reachabilityEndpoints.listNodeNetworkConfigs,
  checkDomainGate: reachabilityEndpoints.checkDomainGate,
  getPublicIp: reachabilityEndpoints.getPublicIp,
  getPublicAccessPoint: reachabilityEndpoints.getPublicAccessPoint,
  updateNodeNetworkConfig: reachabilityEndpoints.updateNodeNetworkConfig,
}

export type ReachabilityEndpoints = typeof reachabilityEndpoints
