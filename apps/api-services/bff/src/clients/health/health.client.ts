import { Injectable } from "@nestjs/common";
import type { ContractRouterClient } from "@orpc/contract";

import { BaseClient, type FlatLeaves } from "@deployer/nest-service-client";
import { healthContract } from "@deployer/health-contracts";
import { ServiceClientRegistry } from "../service-registry";

/**
 * The health service, with its procedures callable at the ROOT.
 *
 * Bound to the service's combined contract, so `check` and `detailed` are reachable as
 * `this.health.check(...)` — the same short form every other client offers.
 */
export interface HealthClient
	extends FlatLeaves<ContractRouterClient<typeof healthContract>> {}

@Injectable()
export class HealthClient extends BaseClient<typeof healthContract> {
	constructor(binder: ServiceClientRegistry) {
		super(binder, { service: "health", contract: healthContract });
	}
}

const healthClient = new HealthClient(new ServiceClientRegistry());
