import { Context } from "effect";

import type { EdgeProviderRegistryShape } from "@deployer/shared/core/modules/edge/edge-provider.registry";

/** Effect view of the edge provider registry: only what the DNS providers read. */
export type EdgeProvidersShape = Pick<EdgeProviderRegistryShape, "accountsInUse">;

export class EdgeProviders extends Context.Service<EdgeProviders, EdgeProvidersShape>()(
	"fleet/EdgeProviders",
) {}
