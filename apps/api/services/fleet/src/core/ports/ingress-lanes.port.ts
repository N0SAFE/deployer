import type { IngressLanesService } from "@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service";
import { Context } from "effect";

/** Effect view of the stack's ingress lanes: only what the DNS providers read. */
export type IngressLanesShape = Pick<IngressLanesService, "getLanes">;

export class IngressLanes extends Context.Service<IngressLanes, IngressLanesShape>()(
	"fleet/IngressLanes",
) {}
