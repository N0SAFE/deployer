import { Context } from 'effect'

import type { NodeDoorClient } from '@deployer/mesh-client'
import type { HostnameService } from '@deployer/shared/core/modules/platform-ingress/services/hostname.service'

/**
 * The two collaborators of the reachability use cases that are **not** Effect tags.
 *
 * Everything else those use cases yield comes straight from `@deployer/shared` as the real tag
 * (`IngressLanesService`, `EdgeProviderRegistry`, `PublicEdgeService`, `ReachabilityService`,
 * `PublicAccessPointService`, `EgressService`, `TraefikConfigRefresher`) — a port wrapping a tag that is
 * already a tag is dead weight, so those were deleted on 2026-11-07.
 *
 * - `NodeAgentPort`: the node door client is a plain object built from the environment
 *   (`nodeDoorFromEnv`), so it needs a tag of its own before an Effect can yield it.
 * - `HostnamesPort`: `HostnameService` is an abstract class implemented by several providers, not a tag.
 */
export class NodeAgentPort extends Context.Service<
    NodeAgentPort,
    NodeDoorClient
>()('fleet/NodeAgentPort') {}
export class HostnamesPort extends Context.Service<
    HostnamesPort,
    HostnameService
>()('fleet/HostnamesPort') {}
