import { Context } from "effect";

import type { IngressLanesServiceShape } from "@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service";

/** Effect view of the stack's ingress lanes: only what the DNS providers read. */
export type IngressLanesShape = Pick<IngressLanesServiceShape, "getLanes">;

export class IngressLanes extends Context.Service<IngressLanes, IngressLanesShape>()(
	"fleet/IngressLanes",
) {}
