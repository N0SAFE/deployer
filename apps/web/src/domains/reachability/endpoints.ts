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
  checkDomainGate: orpc.reachability.checkDomainGate,
  getPublicAccessPoint: orpc.reachability.getPublicAccessPoint,
  watchPublicAccessPoint: orpc.reachability.watchPublicAccessPoint,
  getIngress: orpc.reachability.getIngress,
  updateIngress: orpc.reachability.updateIngress,
  teardownPublicEdge: orpc.reachability.teardownPublicEdge,
  revokeMeshMember: orpc.reachability.revokeMeshMember,
} as const

export const reachabilityEndpointOperations = {
  // Queries are included so their keys are available to the invalidation config
  // (keys.getNodeNetworkConfig / checkDomainGate / getPublicIp / getPublicAccessPoint / getIngress).
  getNodeNetworkConfig: reachabilityEndpoints.getNodeNetworkConfig,
  listNodeNetworkConfigs: reachabilityEndpoints.listNodeNetworkConfigs,
  checkDomainGate: reachabilityEndpoints.checkDomainGate,
  getPublicIp: reachabilityEndpoints.getPublicIp,
  getPublicAccessPoint: reachabilityEndpoints.getPublicAccessPoint,
  getIngress: reachabilityEndpoints.getIngress,
  updateNodeNetworkConfig: reachabilityEndpoints.updateNodeNetworkConfig,
  updateIngress: reachabilityEndpoints.updateIngress,
  teardownPublicEdge: reachabilityEndpoints.teardownPublicEdge,
  revokeMeshMember: reachabilityEndpoints.revokeMeshMember,
} as const

export type ReachabilityEndpoints = typeof reachabilityEndpoints
