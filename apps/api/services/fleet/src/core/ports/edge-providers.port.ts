import type { EdgeProviderRegistry } from "@deployer/shared/core/modules/edge/edge-provider.registry";
import { Context } from "effect";

/** Effect view of the edge provider registry: only what the DNS providers read. */
export type EdgeProvidersShape = Pick<EdgeProviderRegistry, "accountsInUse">;

export class EdgeProviders extends Context.Service<EdgeProviders, EdgeProvidersShape>()(
	"fleet/EdgeProviders",
) {}
