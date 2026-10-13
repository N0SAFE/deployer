import type { ContractRouterClient, RouterContract } from "@orpc/contract";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";

import type { ServiceClient, ServiceClientBinder } from "./types";

/**
 * How a header is supplied for an outgoing service call.
 *
 * A function, not an object, because the headers are PER REQUEST: they carry the
 * caller's credentials, and the registry outlives any single request (see the note
 * on caching below). Reading them at call time is what keeps one client instance
 * usable by every caller without leaking one caller's session into another's call.
 */
export type ServiceRequestHeaderProvider = () => Record<string, string>;

/**
 * Resolves a service name to the origin it answers on.
 *
 * Injected rather than read from an env var here: the ADDRESS of a service is an
 * environment fact the application owns (`API_SERVICE_URLS`, compose service names,
 * a testcontainer port), and a package that guessed it would only work in one
 * deployment.
 */
export type ServiceOriginResolver = (service: string) => string;

/** What `forRoot` needs to address services. */
export type ServiceClientModuleOptions = {
	/** Where a service answers, given its name. */
	readonly resolveOrigin: ServiceOriginResolver;
	/** Headers to send on every call — read per request. */
	readonly headers?: ServiceRequestHeaderProvider;
}

/**
 * Builds and caches ONE client per service, and binds contracts onto them.
 *
 * ── WHY CLIENTS ARE CACHED AND HEADERS ARE NOT ──────────────────────────────
 * An oRPC link holds no request state of its own, so the same client can serve every
 * caller — building one per call would allocate a link and a transport per
 * procedure invocation, for nothing. What IS per-caller is the CREDENTIAL, so the
 * headers are read from a provider on each outgoing request instead of being baked
 * into the link at construction. That split is what makes the cache safe.
 *
 * ── WHY IT BINDS RATHER THAN EXPOSING A `get` ───────────────────────────────
 * A caller wants a client TYPED BY ITS CONTRACT. `bind(service, contract)` returns
 * exactly that (`ServiceClient<T>`), so a screen calling a service gets full
 * inference on the procedures without the registry ever knowing any contract — the
 * coupling this design keeps out.
 */
export class ServiceClientRegistry implements ServiceClientBinder {
	/**
	 * One client per (service, contract).
	 *
	 * ── WHY THE CONTRACT IS PART OF THE KEY ─────────────────────────────────
	 * One service answers on several contracts: the BFF binds `projectContract`,
	 * `serviceContract`, `domainContract` and `servicePreviewTopologyContract` all to
	 * `project`. Keyed by service alone, the second and later binds received the FIRST
	 * contract's client — so calling one of the second contract's own procedures threw
	 * `Expected procedure or contract path`, and calling one the first contract DID
	 * declare silently reached the wrong route.
	 *
	 * The inner map is a `WeakMap` keyed by the contract OBJECT, which is what makes
	 * this correct without leaking: a contract is a module-level singleton for the life
	 * of the process, so entries are never dropped while a client can still be reached,
	 * and a test that builds throwaway contracts does not accumulate them.
	 */
	private readonly clientsByService = new Map<string, WeakMap<object, object>>();
	private readonly origins = new Map<string, string>();

	constructor(private readonly options: ServiceClientModuleOptions) {}

	/** The bound client for `service`, driven (and typed) by `contract`. */
	bind<T extends RouterContract>(service: string, contract: T): ServiceClient<T> {
		const base = this.rawClientFor(service, contract);

		// The flattened names are provided as a Proxy over the SAME client rather than
		// as a copy: the client is itself a Proxy, so a property read already resolves
		// through the contract's tree. Wrapping it lets `client.findById` work without
		// the registry having to know which leaf names exist — `BaseClient` does that
		// walk, once, on the instance it hands to NestJS.
		const bound = new Proxy(base as unknown as ServiceClient<T>, {
			get: (target, property, receiver) => {
				if (property === "raw") return target;
				if (property === "service") return service;
				if (property === "contract") return contract;
				return Reflect.get(target, property, receiver) as unknown;
			},
		});

		return bound;
	}

	/** Every service this registry can reach, with where it expects to find it. */
	describe(): { service: string; origin: string }[] {
		const names = new Set<string>([...this.clientsByService.keys(), ...this.origins.keys()]);
		return [...names].map((service) => ({ service, origin: this.originFor(service) }));
	}

	private rawClientFor<T extends RouterContract>(
		service: string,
		contract: T,
	): ContractRouterClient<T> {
		let byContract = this.clientsByService.get(service);
		if (byContract === undefined) {
			byContract = new WeakMap<object, object>();
			this.clientsByService.set(service, byContract);
		}

		const existing = byContract.get(contract);
		if (existing !== undefined) {
			return existing as ContractRouterClient<T>;
		}

		const client = createORPCClient<ContractRouterClient<T>>(
			new OpenAPILink(contract, {
				origin: this.originFor(service),
				// ── WHY `fetch` AND NOT A `headers` OPTION ─────────────────────────
				// The client is CACHED above and outlives the request that created it. A
				// header set at construction would be whichever request happened to arrive
				// first, and every later caller would be served as that user. Reading the
				// headers inside `fetch` keeps one client per service while making the
				// CREDENTIALS per request.
				fetch: (request: RequestInfo | URL, init?: RequestInit) => {
					const extra = this.options.headers?.() ?? {};
					return fetch(request, {
						...init,
						headers: { ...(init?.headers as Record<string, string>), ...extra },
					});
				},
			}),
		);

		byContract.set(contract, client);
		return client;
	}

	private originFor(service: string): string {
		const cached = this.origins.get(service);
		if (cached !== undefined) return cached;

		const resolved = this.options.resolveOrigin(service);
		this.origins.set(service, resolved);
		return resolved;
	}
}
