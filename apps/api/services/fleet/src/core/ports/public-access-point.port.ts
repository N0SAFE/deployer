import { Context } from "effect";

import type { PublicAccessPointServiceShape } from "@deployer/shared/core/modules/reachability/services/public-access-point.service";

/** Effect view of the node's public access point: the live-checked address the node is reached at. */
export type PublicAccessPointShape = Pick<PublicAccessPointServiceShape, "getAccessPoint">;

export class PublicAccessPoint extends Context.Service<PublicAccessPoint, PublicAccessPointShape>()(
	"fleet/PublicAccessPoint",
) {}
