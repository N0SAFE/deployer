import { Inject, Injectable, type Type } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { Context } from "effect";

import { isMeshController, MeshController, type MeshProcedureMeta } from "./mesh-controller";
import { MESH_TRANSPORT_OPTIONS, type MeshRouter, type MeshTransportOptions } from "./mesh-transport.options";

export type MeshRouters = {
	/** Served on the peer door: every contract group except `node`. */
	readonly peer: MeshRouter;
	/**
	 * Served on the local service door: only the procedures the module allowlists (`serviceProcedures`), so a service on
	 * the node cannot rotate the credential, issue a join token or configure the node. Without an allowlist it is the full
	 * local router, which is the pre-split behaviour.
	 */
	readonly node: MeshRouter;
	/** Served on the local admin door: every procedure the agent serves locally (the service ones plus the admin-only). */
	readonly admin: MeshRouter;
};

/** The routers, as an Effect service: consumers yield them instead of calling the resolver themselves. */
export class MeshRoutersService extends Context.Service<MeshRoutersService, MeshRouters>()("mesh/Routers") {}

/**
 * Builds the two mesh routers from the classes that extend `MeshController`.
 *
 * Only controllers are read. A mesh procedure class is declared in `controllers` (and mounts no HTTP route, because it
 * has no `@Implement`) precisely so the endpoint-requirement audit sees it like any other controller: the `R` of every
 * method named in its `static procedures` is checked at the root by `assertRequirementsMet`. Each declared method is
 * called once to obtain its procedure, and the result is placed at `router[door][group][key]`. Every contract procedure
 * must then be reachable, or the boot fails naming it.
 */
@Injectable()
export class MeshRouterResolver {
	constructor(
		private readonly discovery: DiscoveryService,
		@Inject(MESH_TRANSPORT_OPTIONS) private readonly options: MeshTransportOptions,
	) {}

	resolve(): MeshRouters {
		const peer: MeshRouter = {};
		const node: MeshRouter = {};
		const seen = new Set<string>();
		const read = new Set<Type<unknown>>();

		// A mesh procedure class must be a CONTROLLER (and not a provider): that is what puts its methods' requirements
		// under `assertRequirementsMet`. Declaring one as a provider is a boot error, not a silent gap in the gate.
		for (const wrapper of this.discovery.getProviders()) {
			const metatype = wrapper.metatype as Type<unknown> | null;
			if (metatype !== null && isMeshController(metatype)) {
				throw new Error(
					`${metatype.name} extends MeshController but is a provider; declare it in this module's "controllers" (without @Implement) so the requirement gate audits it`,
				);
			}
		}

		for (const wrapper of this.discovery.getControllers()) {
			const metatype = wrapper.metatype as Type<unknown> | null;
			if (metatype === null || !isMeshController(metatype)) continue;
			if (read.has(metatype)) continue;
			read.add(metatype);

			if (!(wrapper.isDependencyTreeStatic?.() ?? true) || wrapper.instance === null) {
				throw new Error(
					`${metatype.name} extends MeshController but is not a singleton controller: a mesh procedure class holds no request state`,
				);
			}

			const router = (meta: MeshProcedureMeta) => (meta.door === "peer" ? peer : node);
			const instance = wrapper.instance as Record<string, unknown>;
			const declared = (metatype as unknown as typeof MeshController).procedures ?? {};
			if (Object.keys(declared).length === 0) {
				throw new Error(
					`${metatype.name} extends MeshController but declares no procedures: add static readonly procedures = declareProcedures({ … })`,
				);
			}
			for (const [method, meta] of Object.entries(declared)) {
				this.place(instance, metatype.name, method, { ...meta, key: meta.key ?? method }, router(meta), seen);
			}
		}

		const localRouter: MeshRouter = { ...peer };
		for (const [group, procedures] of Object.entries(node)) {
			const collided = Object.keys(procedures).filter((key) => localRouter[group]?.[key] !== undefined);
			if (collided.length > 0) {
				throw new Error(
					`The node door redeclares ${collided.map((key) => `${group}.${key}`).join(", ")}: a node procedure cannot shadow a peer one`,
				);
			}
			localRouter[group] = { ...localRouter[group], ...procedures };
		}

		this.validate(peer, "peer", ["node"]);
		this.validate(localRouter, "admin", []);

		return { peer, node: this.serviceRouter(localRouter), admin: localRouter };
	}

	/**
	 * The service door: the allowlisted local procedures, and nothing else. An id that the agent does not serve is a boot
	 * error — a typo would otherwise leave a caller with a door that answers NOT_FOUND at runtime.
	 */
	private serviceRouter(local: MeshRouter): MeshRouter {
		const allowed = this.options.serviceProcedures;
		if (allowed === undefined) return local;
		const service: MeshRouter = {};
		for (const id of allowed) {
			const separator = id.indexOf(".");
			const group = id.slice(0, separator);
			const key = id.slice(separator + 1);
			const procedure = separator === -1 ? undefined : local[group]?.[key];
			if (procedure === undefined) {
				throw new Error(
					`serviceProcedures names ${id}, which no MeshController declares: list "group.key" of a procedure in a class's static procedures`,
				);
			}
			service[group] = { ...service[group], [key]: procedure };
		}
		return service;
	}

	/** Calls the method once and stores the procedure it returns, refusing a key served twice. */
	private place(
		instance: Record<string, unknown>,
		className: string,
		method: string,
		meta: MeshProcedureMeta,
		router: MeshRouter,
		seen: Set<string>,
	): void {
		const key = meta.key ?? method;
		const id = `${meta.door}/${meta.group}/${key}`;
		if (seen.has(id)) throw new Error(`The mesh transport serves ${id} twice: check ${className}.${method}`);
		seen.add(id);

		const procedure = instance[method];
		if (typeof procedure !== "function") {
			throw new Error(`${className}.${method} is declared in static procedures but is not a method`);
		}
		const group = router[meta.group] ?? {};
		router[meta.group] = group;
		group[key] = (procedure as () => unknown).call(instance);
	}

	/**
	 * A procedure declared in the contract but absent from a router is unreachable, and nothing says so at runtime: fail
	 * at boot with its door and name.
	 */
	private validate(router: MeshRouter, door: string, skip: readonly string[]): void {
		for (const [group, procedures] of Object.entries(this.options.contract)) {
			if (skip.includes(group) || typeof procedures !== "object" || procedures === null) continue;
			const served = router[group];
			const missing = Object.keys(procedures).filter((key) => typeof served?.[key] !== "object");
			if (missing.length === 0) continue;
			throw new Error(
				`The ${door} door serves no ${missing.map((key) => `${group}.${key}`).join(", ")}: declare it in the static procedures of a MeshController class listed in this module's "controllers"`,
			);
		}
	}
}
