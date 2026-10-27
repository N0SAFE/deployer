/**
 * GENERATED — the `user` surface, delegated to `identity`.
 *
 * Every method here is a CALL ON A TYPED CLIENT, not a relayed request: the input the
 * handler receives is the one the contract declares, and the client accepts exactly that
 * type. The BFF is a CLIENT of the service — which is what lets the orchestrators call
 * several and join the answers, and what the removed proxy middleware could not do,
 * because it relayed bytes it never parsed.
 *
 * ── WHY THERE IS NO `requireAuth()` HERE ────────────────────────────────────
 * Authorization is a property of the PROCEDURE, and the service enforces it on the leg it
 * receives (it applies `requireAuth()`, `requireMesh()` and role gates to the procedures
 * that need them). Re-applying a blanket session requirement at the BFF would BREAK the
 * procedures that are legitimately public — the health probes, the mesh endpoints, the
 * setup surface — and would put one policy in two places, where the copy that drifts is
 * the one nobody reads. The caller's credentials still travel (see `service-auth-context`),
 * so the service decides with the real session in hand.
 *
 * ── WHY THE CLIENT BINDS THE NAMESPACE CONTRACT ─────────────────────────────
 * `clients.for(service, <namespaceContract>)` — not the service's combined contract. The
 * combined one puts `list`/`findById`/`create`/`update`/`delete` on two namespaces at once
 * (project and service both declare them), so its client omits those from the root type and
 * `this.client.list(...)` would not compile. Binding the namespace keeps every call
 * unambiguous by construction, with no aliasing rules to remember.
 *
 * Regenerate with `scripts/gen-bff-delegation.py`; do not hand-edit.
 */

import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { userContract } from "@deployer/identity-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class UserDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("identity", userContract);
	}

	@Implement(userContract.list)
	list() {
		return implement(userContract.list).handler(({ input }) => this.client.list(input));
	}

	@Implement(userContract.findById)
	findById() {
		return implement(userContract.findById).handler(({ input }) => this.client.findById(input));
	}

	@Implement(userContract.create)
	create() {
		return implement(userContract.create).handler(({ input }) => this.client.create(input));
	}

	@Implement(userContract.update)
	update() {
		return implement(userContract.update).handler(({ input }) => this.client.update(input));
	}

	@Implement(userContract.delete)
	delete() {
		return implement(userContract.delete).handler(({ input }) => this.client.delete(input));
	}

	@Implement(userContract.checkEmail)
	checkEmail() {
		return implement(userContract.checkEmail).handler(({ input }) => this.client.checkEmail(input));
	}

	@Implement(userContract.count)
	count() {
		return implement(userContract.count).handler(({ input }) => this.client.count(input));
	}
}
