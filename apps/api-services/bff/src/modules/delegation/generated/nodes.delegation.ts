/**
 * GENERATED — the `nodes` surface, delegated to `fleet`.
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

import { nodesContract } from "@deployer/fleet-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class NodesDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("fleet", nodesContract);
	}

	@Implement(nodesContract.listServers)
	listServers() {
		return implement(nodesContract.listServers).handler(({ input }) => this.client.listServers(input));
	}

	@Implement(nodesContract.setServerCapacity)
	setServerCapacity() {
		return implement(nodesContract.setServerCapacity).handler(({ input }) => this.client.setServerCapacity(input));
	}

	@Implement(nodesContract.listAllocations)
	listAllocations() {
		return implement(nodesContract.listAllocations).handler(({ input }) => this.client.listAllocations(input));
	}

	@Implement(nodesContract.listMyAllocations)
	listMyAllocations() {
		return implement(nodesContract.listMyAllocations).handler(({ input }) => this.client.listMyAllocations(input));
	}

	@Implement(nodesContract.upsertAllocation)
	upsertAllocation() {
		return implement(nodesContract.upsertAllocation).handler(({ input }) => this.client.upsertAllocation(input));
	}

	@Implement(nodesContract.deleteAllocation)
	deleteAllocation() {
		return implement(nodesContract.deleteAllocation).handler(({ input }) => this.client.deleteAllocation(input));
	}

	@Implement(nodesContract.checkMyAdmission)
	checkMyAdmission() {
		return implement(nodesContract.checkMyAdmission).handler(({ input }) => this.client.checkMyAdmission(input));
	}

	@Implement(nodesContract.createMyAdmissionRequest)
	createMyAdmissionRequest() {
		return implement(nodesContract.createMyAdmissionRequest).handler(({ input }) => this.client.createMyAdmissionRequest(input));
	}

	@Implement(nodesContract.listMyAdmissionRequests)
	listMyAdmissionRequests() {
		return implement(nodesContract.listMyAdmissionRequests).handler(({ input }) => this.client.listMyAdmissionRequests(input));
	}

	@Implement(nodesContract.listAdmissionRequests)
	listAdmissionRequests() {
		return implement(nodesContract.listAdmissionRequests).handler(({ input }) => this.client.listAdmissionRequests(input));
	}

	@Implement(nodesContract.resolveAdmissionRequest)
	resolveAdmissionRequest() {
		return implement(nodesContract.resolveAdmissionRequest).handler(({ input }) => this.client.resolveAdmissionRequest(input));
	}
}
