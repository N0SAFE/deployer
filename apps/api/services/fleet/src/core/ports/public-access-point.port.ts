import type { PublicAccessPointService } from "@deployer/shared/core/modules/reachability/services/public-access-point.service";
import { Context } from "effect";

/** Effect view of the node's public access point: the live-checked address the node is reached at. */
export type PublicAccessPointShape = Pick<PublicAccessPointService, "getAccessPoint">;

export class PublicAccessPoint extends Context.Service<PublicAccessPoint, PublicAccessPointShape>()(
	"fleet/PublicAccessPoint",
) {}
