/**
 * GENERATED — the `reachability` surface, delegated to `fleet`.
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

import { reachabilityContract } from "@deployer/fleet-contracts";
import { checkDomainGateContract } from "@deployer/fleet-contracts";
import { checkDomainReachabilityContract } from "@deployer/fleet-contracts";
import { checkReachabilityContract } from "@deployer/fleet-contracts";
import { getIngressContract } from "@deployer/fleet-contracts";
import { getNodeNetworkConfigContract } from "@deployer/fleet-contracts";
import { getPublicAccessPointContract } from "@deployer/fleet-contracts";
import { getPublicIpContract } from "@deployer/fleet-contracts";
import { getReachabilityConfigContract } from "@deployer/fleet-contracts";
import { listNodeNetworkConfigsContract } from "@deployer/fleet-contracts";
import { revokeMeshMemberContract } from "@deployer/fleet-contracts";
import { teardownPublicEdgeContract } from "@deployer/fleet-contracts";
import { updateIngressContract } from "@deployer/fleet-contracts";
import { updateNodeNetworkConfigContract } from "@deployer/fleet-contracts";
import { updateReachabilityConfigContract } from "@deployer/fleet-contracts";
import { watchPublicAccessPointContract } from "@deployer/fleet-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class ReachabilityDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("fleet", reachabilityContract);
	}

	@Implement(checkReachabilityContract)
	check() {
		return implement(checkReachabilityContract).handler(({ input }) => this.client.check(input));
	}

	@Implement(getReachabilityConfigContract)
	getConfig() {
		return implement(getReachabilityConfigContract).handler(({ input }) => this.client.getConfig(input));
	}

	@Implement(updateReachabilityConfigContract)
	updateConfig() {
		return implement(updateReachabilityConfigContract).handler(({ input }) => this.client.updateConfig(input));
	}

	@Implement(checkDomainReachabilityContract)
	checkDomain() {
		return implement(checkDomainReachabilityContract).handler(({ input }) => this.client.checkDomain(input));
	}

	@Implement(getPublicIpContract)
	getPublicIp() {
		return implement(getPublicIpContract).handler(({ input }) => this.client.getPublicIp(input));
	}

	@Implement(getNodeNetworkConfigContract)
	getNodeNetworkConfig() {
		return implement(getNodeNetworkConfigContract).handler(({ input }) => this.client.getNodeNetworkConfig(input));
	}

	@Implement(updateNodeNetworkConfigContract)
	updateNodeNetworkConfig() {
		return implement(updateNodeNetworkConfigContract).handler(({ input }) => this.client.updateNodeNetworkConfig(input));
	}

	@Implement(listNodeNetworkConfigsContract)
	listNodeNetworkConfigs() {
		return implement(listNodeNetworkConfigsContract).handler(({ input }) => this.client.listNodeNetworkConfigs(input));
	}

	@Implement(checkDomainGateContract)
	checkDomainGate() {
		return implement(checkDomainGateContract).handler(({ input }) => this.client.checkDomainGate(input));
	}

	@Implement(getPublicAccessPointContract)
	getPublicAccessPoint() {
		return implement(getPublicAccessPointContract).handler(({ input }) => this.client.getPublicAccessPoint(input));
	}

	@Implement(watchPublicAccessPointContract)
	watchPublicAccessPoint() {
		return implement(watchPublicAccessPointContract).handler(({ input }) => this.client.watchPublicAccessPoint(input));
	}

	@Implement(getIngressContract)
	getIngress() {
		return implement(getIngressContract).handler(({ input }) => this.client.getIngress(input));
	}

	@Implement(updateIngressContract)
	updateIngress() {
		return implement(updateIngressContract).handler(({ input }) => this.client.updateIngress(input));
	}

	@Implement(teardownPublicEdgeContract)
	teardownPublicEdge() {
		return implement(teardownPublicEdgeContract).handler(({ input }) => this.client.teardownPublicEdge(input));
	}

	@Implement(revokeMeshMemberContract)
	revokeMeshMember() {
		return implement(revokeMeshMemberContract).handler(({ input }) => this.client.revokeMeshMember(input));
	}
}
