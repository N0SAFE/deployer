/**
 * GENERATED — the `cluster` surface, delegated to `fleet`.
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

import { clusterContract } from "@deployer/fleet-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class ClusterDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("fleet", clusterContract);
	}

	@Implement(clusterContract.getSnapshot)
	getSnapshot() {
		return implement(clusterContract.getSnapshot).handler(({ input }) => this.client.getSnapshot(input));
	}

	@Implement(clusterContract.streamSnapshot)
	streamSnapshot() {
		return implement(clusterContract.streamSnapshot).handler(({ input }) => this.client.streamSnapshot(input));
	}

	@Implement(clusterContract.listNodes)
	listNodes() {
		return implement(clusterContract.listNodes).handler(({ input }) => this.client.listNodes(input));
	}

	@Implement(clusterContract.streamNodes)
	streamNodes() {
		return implement(clusterContract.streamNodes).handler(({ input }) => this.client.streamNodes(input));
	}

	@Implement(clusterContract.getMaster)
	getMaster() {
		return implement(clusterContract.getMaster).handler(({ input }) => this.client.getMaster(input));
	}

	@Implement(clusterContract.streamMaster)
	streamMaster() {
		return implement(clusterContract.streamMaster).handler(({ input }) => this.client.streamMaster(input));
	}

	@Implement(clusterContract.updateNode)
	updateNode() {
		return implement(clusterContract.updateNode).handler(({ input }) => this.client.updateNode(input));
	}

	@Implement(clusterContract.listServices)
	listServices() {
		return implement(clusterContract.listServices).handler(({ input }) => this.client.listServices(input));
	}

	@Implement(clusterContract.streamServices)
	streamServices() {
		return implement(clusterContract.streamServices).handler(({ input }) => this.client.streamServices(input));
	}

	@Implement(clusterContract.listTasks)
	listTasks() {
		return implement(clusterContract.listTasks).handler(({ input }) => this.client.listTasks(input));
	}

	@Implement(clusterContract.streamTasks)
	streamTasks() {
		return implement(clusterContract.streamTasks).handler(({ input }) => this.client.streamTasks(input));
	}

	@Implement(clusterContract.getNodeResources)
	getNodeResources() {
		return implement(clusterContract.getNodeResources).handler(({ input }) => this.client.getNodeResources(input));
	}

	@Implement(clusterContract.streamNodeResources)
	streamNodeResources() {
		return implement(clusterContract.streamNodeResources).handler(({ input }) => this.client.streamNodeResources(input));
	}

	@Implement(clusterContract.getSwarmConfig)
	getSwarmConfig() {
		return implement(clusterContract.getSwarmConfig).handler(({ input }) => this.client.getSwarmConfig(input));
	}

	@Implement(clusterContract.setSwarmConfig)
	setSwarmConfig() {
		return implement(clusterContract.setSwarmConfig).handler(({ input }) => this.client.setSwarmConfig(input));
	}
}
