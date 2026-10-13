import { Module, Injectable, type DynamicModule } from "@nestjs/common";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import type { ContractRouterClient, RouterContract } from "@orpc/contract";

import { apiServiceUrl, type ApiServiceName } from "./service-address";

/**
 * Reaching another SERVICE over its contract.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * A service must not import another service's internals: that is what made the monolith a
 * monolith, and it is the coupling the split removes. But a service sometimes genuinely
 * needs a fact another owns — the project domain wants the DNS zones fleet holds, the
 * deployment workflow wants the source checkout fleet resolves. The sanctioned route is the
 * owner's CONTRACT, and this is the client for it.
 *
 * ── WHY `OpenAPILink` AND NOT `RPCLink` ─────────────────────────────────────
 * Services implement their contracts with `@Implement`, which serves each procedure at the
 * OpenAPI route its contract declares (`GET /project/…`) rather than at an RPC path.
 * `RPCLink` would build URLs no service answers — a mismatch that only shows up at runtime,
 * which is precisely the drift a shared transport exists to prevent. The BFF's client uses
 * the same link for the same reason.
 */
@Injectable()
export class ServiceClient {
	/**
	 * One client per (service, contract) pair.
	 *
	 * Keyed by the CONTRACT OBJECT rather than by name: two callers reaching the same
	 * service through different sub-contracts must not receive each other's client — a link
	 * built for one shape answers the other with a 404 rather than something actionable. A
	 * WeakMap makes that identity exact and lets a contract be collected with its client.
	 */
	private readonly clients = new WeakMap<object, Map<ApiServiceName, unknown>>();

	/**
	 * A client for `name`, typed to the contract the caller passes.
	 *
	 * Generic in the contract rather than fixed per service: a caller that imports
	 * `providersContract` gets inference on that call, while this class never has to know
	 * about any contract — the coupling that would otherwise make it a routing table.
	 */
	clientFor<TContract extends RouterContract>(
		name: ApiServiceName,
		contract: TContract,
	): ContractRouterClient<TContract> {
		const perContract = this.clients.get(contract) ?? new Map<ApiServiceName, unknown>();
		this.clients.set(contract, perContract);

		const existing = perContract.get(name);
		if (existing !== undefined) {
			return existing as ContractRouterClient<TContract>;
		}

		const client = createORPCClient<ContractRouterClient<TContract>>(
			new OpenAPILink(contract, { origin: apiServiceUrl(name) }),
		);
		perContract.set(name, client);
		return client;
	}
}

/**
 * Provides `ServiceClient`.
 *
 * Global because the dependency is a TRANSPORT, not a domain: a module that needs to reach
 * a peer should import it once rather than thread a provider through every domain module,
 * and there is nothing per-module to configure.
 */
@Module({})
export class ServiceClientModule {
	static forRoot(): DynamicModule {
		return {
			module: ServiceClientModule,
			global: true,
			providers: [ServiceClient],
			exports: [ServiceClient],
		};
	}
}
