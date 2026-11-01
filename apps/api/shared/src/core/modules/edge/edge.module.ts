/**
 * CoreEdgeModule — the edge-provider plugin point.
 *
 * Holds the registry every provider registers into, the per-provider replicated
 * state store, and the providers that need nothing but the nodes (`direct`).
 * Providers that need an account live with that account's integration (the
 * Cloudflare Tunnel provider lives in the providers module, next to the Cloudflare
 * DNS provider) and register themselves — this module never imports them.
 *
 * Global because the registry is read by the ingress supervisors, the
 * reachability core and the Edge API alike.
 */

import { createGlobalModule } from "@deployer/nest-effect";

import { MeshNodeModule } from "../mesh-node/mesh-node.module";
import { EdgeProviderRegistry } from "./edge-provider.registry";
import { EdgeStateStore } from "./edge-state.store";
import { DirectEdgeProvider } from "./providers/direct.edge-provider";

export const CoreEdgeModule = createGlobalModule({
	imports: [MeshNodeModule],
	providers: [EdgeProviderRegistry, EdgeStateStore, DirectEdgeProvider],
	exports: [EdgeProviderRegistry, EdgeStateStore],
});
