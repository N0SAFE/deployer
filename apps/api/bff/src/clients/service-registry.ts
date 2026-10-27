import { Injectable } from "@nestjs/common";

import {
	ServiceClientRegistry as PackageRegistry,
	type ServiceClient,
	type ServiceClientModuleOptions,
} from "@deployer/nest-service-client";
import type { RouterContract } from "@orpc/contract";

import { API_SERVICES, apiServiceUrl, type ApiServiceName } from "@deployer/shared/server";
import { serviceAuthHeaders } from "./service-auth-context";

/**
 * How the BFF reaches a service.
 *
 * ── WHY THIS IS THE APPLICATION'S AND NOT THE PACKAGE'S ─────────────────────
 * The package knows HOW to call a service (bind a contract, attach headers, cache
 * one client per service). It cannot know WHICH services exist or WHERE they answer
 * — that is this deployment's business, and it lives in `API_SERVICES`, the same
 * catalog the services are STARTED from. Keeping the two together is what makes it
 * impossible for a service to be listening on one address and called on another.
 */
export const bffServiceClientOptions: ServiceClientModuleOptions = {
	resolveOrigin: (service) => apiServiceUrl(service as ApiServiceName),
	// Per request, not at construction: the credentials belong to the CALLER, and the
	// client instances are cached across requests.
	headers: () => serviceAuthHeaders(),
};

/**
 * The BFF's binding of its own service catalog to the shared client registry.
 *
 * ── WHY AN ADAPTER AND NOT THE PACKAGE CLASS DIRECTLY ───────────────────────
 * Two reasons, both about the vocabulary of THIS codebase:
 *
 *   1. `API_SERVICES` is the authoritative list of services, and it is typed
 *      (`ApiServiceName`). Narrowing the package's `string` to that union here means
 *      a typo'd service name is a compile error in the BFF rather than a runtime
 *      404 from an origin nobody serves.
 *   2. `describe()` reports the catalog's OWN descriptions, which the package has no
 *      way to know.
 *
 * Injection is unchanged: a client injects the package's registry token and receives
 * this, because it extends it.
 */
@Injectable()
export class ServiceClientRegistry extends PackageRegistry {
	constructor() {
		super(bffServiceClientOptions);
	}

	/**
	 * The client for `name`, typed by `contract`.
	 *
	 * Kept as the PRIMARY API for callers that reach a service with a contract they
	 * already hold — a composer that needs one procedure and no dedicated client
	 * class. A module that reaches the same service from many places should declare a
	 * `BaseClient` subclass instead, so the service/contract pairing is written once.
	 */
	for<TContract extends RouterContract>(
		name: ApiServiceName,
		contract: TContract,
	): ServiceClient<TContract> {
		return this.bind(name, contract);
	}

	/**
	 * Every service the catalog declares, with where it is expected to answer.
	 *
	 * The shape is the BASE class's (`{ service, origin }`) because an override must
	 * remain assignable to what it overrides. The catalog's own descriptions are
	 * exposed separately by `describeCatalog()`, so a caller that wants the human
	 * wording asks for it rather than the base method being widened for everyone.
	 */
	describeCatalog(): { name: ApiServiceName; url: string; description: string }[] {
		return (Object.keys(API_SERVICES) as ApiServiceName[]).map((name) => ({
			name,
			url: apiServiceUrl(name),
			description: API_SERVICES[name].description,
		}));
	}
}
