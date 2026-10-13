import type { ContractRouterClient, RouterContract } from "@orpc/contract";

import { collectContractLeaves, resolveAtPath } from "./contract-leaves";
import type { ServiceClientBinder } from "./types";

/**
 * A service client whose procedures are callable at the ROOT.
 *
 * ── WHAT A SUBCLASS DECLARES ────────────────────────────────────────────────
 * The contract, and nothing else:
 *
 * ```ts
 * @Injectable()
 * export class IdentityClient extends BaseClient<typeof identityContract> {
 *   constructor(binder: ServiceClientBinder) {
 *     super(binder, { service: "identity", contract: identityContract });
 *   }
 * }
 * ```
 *
 * Every procedure reaching it is then callable under its own name:
 *
 * ```ts
 * await this.identity.findById({ params: { id } });   // routes through user.findById
 * ```
 *
 * ...and the namespaced path stays available (`this.identity.user.findById(...)`),
 * so the flattening ADDS a short form rather than hiding the real tree.
 *
 * ── WHY THE PROCEDURES ARE COPIED ONTO THE INSTANCE ─────────────────────────
 * NestJS injects this object, so what must be callable is the INSTANCE. The base
 * therefore reads each leaf off the bound client at construction and defines it on
 * `this`. The alternative — a class-level Proxy — would make a missing procedure
 * surface as an `undefined` deep inside a handler instead of at the call site, and
 * would break the `instanceof` checks DI and the exception filters rely on.
 */
export abstract class BaseClient<T extends RouterContract = RouterContract> {
	/** The service this client reaches — for diagnostics and error messages. */
	public readonly service: string;

	/** The contract as declared — the flattening source, kept for introspection. */
	public readonly contract: T;

	/**
	 * The namespaced client, and the FLATTENED procedures.
	 *
	 * ── WHY THE DECLARATION IS MERGED THIS WAY ─────────────────────────────
	 * The constructor copies each procedure onto the instance, so at RUNTIME
	 * `client.list` is callable. TypeScript cannot see that from an assignment, so
	 * the flattened surface has to be declared — and it has to be declared on the
	 * CLASS, not computed here, because a class declaration cannot extend a mapped
	 * type over its own type parameter.
	 *
	 * `declare` (no initialiser) is what makes it a TYPE-only statement: it tells the
	 * compiler the property exists without emitting an assignment that would
	 * overwrite what the constructor already defined.
	 */
	declare readonly raw: ContractRouterClient<T>;

	protected constructor(
		binder: ServiceClientBinder,
		options: { service: string; contract: T },
	) {
		this.service = options.service;
		this.contract = options.contract;

		const bound = binder.bind(options.service, options.contract);
		// `binder.bind` is typed as the flattened client; `raw` is its namespaced form.
		// The assignment goes through the SAME type the interface declares, so no
		// assertion is needed here — the union direction is handled by the type itself.
		// `raw` is typed as a `declare` field above; the value is bound here.
		(this as { raw: unknown }).raw = bound.raw;

		// ── WHY `defineProperty` AND NOT AN ASSIGNMENT ──────────────────────────
		// Non-enumerable and non-writable. A client is injected into services that get
		// logged and spread; enumerable procedures would turn every `Object.keys` and
		// every serialisation of such a service into a several-hundred-entry dump. They
		// stay fully callable — they are simply not part of the object's "contents" as
		// far as reflection is concerned.
		for (const leaf of collectContractLeaves(options.contract)) {
			// ── WHY THE NAME IS APPENDED TO THE PATH ────────────────────────────────
			// `collectContractLeaves` records the path to the leaf's PARENT plus the
			// leaf's own name — that split is what lets the alias be defined under the
			// short name while the procedure is still resolved at its real route. So the
			// lookup needs `[...path, name]`; using the path alone resolves the PARENT
			// (a router object), the `typeof` check below then rejects it, and every alias
			// is silently missing. That is exactly the bug this line fixes.
			const procedure = resolveAtPath(bound, [...leaf.path, leaf.name]);

			// ── WHY THE CHECK IS "NOT UNDEFINED", NOT "IS A FUNCTION" ────────────────
			// An oRPC procedure is an OBJECT that happens to be callable: on the wire a
			// bound leaf reports `typeof === "object"` (the same way the client itself
			// reports `function` while being a Proxy). Requiring `function` therefore
			// rejected every leaf, and every alias was silently missing — which is what
			// the package's own test caught. What must be excluded is a leaf the bound
			// client does not implement (undefined); the call is what proves the rest.
			if (procedure === undefined || procedure === null) continue;

			Object.defineProperty(this, leaf.name, {
				value: (procedure as (...args: unknown[]) => unknown).bind(bound),
				enumerable: false,
				configurable: true,
				writable: false,
			});
		}
	}
}
