import type { DomainRoutingService } from "@deployer/shared/core/modules/domain/services/domain-routing.service";
import { Context } from "effect";

/** Effect view of domain routing: what the preview lifecycle reads and writes. */
export type DomainRoutingShape = Pick<DomainRoutingService, "resolveServiceUrls" | "addPreviewRoute" | "removePreviewRoute">;

export class DomainRouting extends Context.Service<DomainRouting, DomainRoutingShape>()("fleet/DomainRouting") {}
