/**
 * GENERATED — the `service` surface, delegated to `project`.
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

import { serviceContract } from "@deployer/project-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class ServiceDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("project", serviceContract);
	}

	@Implement(serviceContract.crud.list)
	crud_list() {
		return implement(serviceContract.crud.list).handler(({ input }) => this.client.crud.list(input));
	}

	@Implement(serviceContract.crud.findById)
	crud_findById() {
		return implement(serviceContract.crud.findById).handler(({ input }) => this.client.crud.findById(input));
	}

	@Implement(serviceContract.crud.create)
	crud_create() {
		return implement(serviceContract.crud.create).handler(({ input }) => this.client.crud.create(input));
	}

	@Implement(serviceContract.crud.update)
	crud_update() {
		return implement(serviceContract.crud.update).handler(({ input }) => this.client.crud.update(input));
	}

	@Implement(serviceContract.crud.delete)
	crud_delete() {
		return implement(serviceContract.crud.delete).handler(({ input }) => this.client.crud.delete(input));
	}

	@Implement(serviceContract.crud.children)
	crud_children() {
		return implement(serviceContract.crud.children).handler(({ input }) => this.client.crud.children(input));
	}

	@Implement(serviceContract.crud.subtree)
	crud_subtree() {
		return implement(serviceContract.crud.subtree).handler(({ input }) => this.client.crud.subtree(input));
	}

	@Implement(serviceContract.lifecycle.toggleActive)
	lifecycle_toggleActive() {
		return implement(serviceContract.lifecycle.toggleActive).handler(({ input }) => this.client.lifecycle.toggleActive(input));
	}

	@Implement(serviceContract.dependencies.list)
	dependencies_list() {
		return implement(serviceContract.dependencies.list).handler(({ input }) => this.client.dependencies.list(input));
	}

	@Implement(serviceContract.dependencies.add)
	dependencies_add() {
		return implement(serviceContract.dependencies.add).handler(({ input }) => this.client.dependencies.add(input));
	}

	@Implement(serviceContract.dependencies.remove)
	dependencies_remove() {
		return implement(serviceContract.dependencies.remove).handler(({ input }) => this.client.dependencies.remove(input));
	}

	@Implement(serviceContract.streams.query)
	streams_query() {
		return implement(serviceContract.streams.query).handler(({ input }) => this.client.streams.query(input));
	}

	@Implement(serviceContract.network.get)
	network_get() {
		return implement(serviceContract.network.get).handler(({ input }) => this.client.network.get(input));
	}

	@Implement(serviceContract.network.update)
	network_update() {
		return implement(serviceContract.network.update).handler(({ input }) => this.client.network.update(input));
	}

	@Implement(serviceContract.network.provisionRecord)
	network_provisionRecord() {
		return implement(serviceContract.network.provisionRecord).handler(({ input }) => this.client.network.provisionRecord(input));
	}
}
