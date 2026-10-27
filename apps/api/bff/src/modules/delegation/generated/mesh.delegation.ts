/**
 * GENERATED — the `mesh` surface, delegated to `fleet`.
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

import { meshContract } from "@deployer/fleet-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class MeshDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("fleet", meshContract);
	}

	@Implement(meshContract.ping)
	ping() {
		return implement(meshContract.ping).handler(({ input }) => this.client.ping(input));
	}

	@Implement(meshContract.getLocalNode)
	getLocalNode() {
		return implement(meshContract.getLocalNode).handler(({ input }) => this.client.getLocalNode(input));
	}

	@Implement(meshContract.getNodeMetrics)
	getNodeMetrics() {
		return implement(meshContract.getNodeMetrics).handler(({ input }) => this.client.getNodeMetrics(input));
	}

	@Implement(meshContract.listPeers)
	listPeers() {
		return implement(meshContract.listPeers).handler(({ input }) => this.client.listPeers(input));
	}

	@Implement(meshContract.listPeerSessions)
	listPeerSessions() {
		return implement(meshContract.listPeerSessions).handler(({ input }) => this.client.listPeerSessions(input));
	}

	@Implement(meshContract.listEventStreams)
	listEventStreams() {
		return implement(meshContract.listEventStreams).handler(({ input }) => this.client.listEventStreams(input));
	}

	@Implement(meshContract.findEventStreamById)
	findEventStreamById() {
		return implement(meshContract.findEventStreamById).handler(({ input }) => this.client.findEventStreamById(input));
	}

	@Implement(meshContract.subscribeEventStream)
	subscribeEventStream() {
		return implement(meshContract.subscribeEventStream).handler(({ input }) => this.client.subscribeEventStream(input));
	}

	@Implement(meshContract.planStreamRoute)
	planStreamRoute() {
		return implement(meshContract.planStreamRoute).handler(({ input }) => this.client.planStreamRoute(input));
	}

	@Implement(meshContract.connectPeer)
	connectPeer() {
		return implement(meshContract.connectPeer).handler(({ input }) => this.client.connectPeer(input));
	}

	@Implement(meshContract.disconnectPeer)
	disconnectPeer() {
		return implement(meshContract.disconnectPeer).handler(({ input }) => this.client.disconnectPeer(input));
	}

	@Implement(meshContract.heartbeatPeer)
	heartbeatPeer() {
		return implement(meshContract.heartbeatPeer).handler(({ input }) => this.client.heartbeatPeer(input));
	}

	@Implement(meshContract.membershipSnapshot)
	membershipSnapshot() {
		return implement(meshContract.membershipSnapshot).handler(({ input }) => this.client.membershipSnapshot(input));
	}

	@Implement(meshContract.reconcileMembership)
	reconcileMembership() {
		return implement(meshContract.reconcileMembership).handler(({ input }) => this.client.reconcileMembership(input));
	}

	@Implement(meshContract.streamTopology)
	streamTopology() {
		return implement(meshContract.streamTopology).handler(({ input }) => this.client.streamTopology(input));
	}

	@Implement(meshContract.streamEvents)
	streamEvents() {
		return implement(meshContract.streamEvents).handler(({ input }) => this.client.streamEvents(input));
	}

	@Implement(meshContract.lookupResource)
	lookupResource() {
		return implement(meshContract.lookupResource).handler(({ input }) => this.client.lookupResource(input));
	}

	@Implement(meshContract.upsertResourceIndex)
	upsertResourceIndex() {
		return implement(meshContract.upsertResourceIndex).handler(({ input }) => this.client.upsertResourceIndex(input));
	}

	@Implement(meshContract.issueJoinGrant)
	issueJoinGrant() {
		return implement(meshContract.issueJoinGrant).handler(({ input }) => this.client.issueJoinGrant(input));
	}

	@Implement(meshContract.revokeJoinGrant)
	revokeJoinGrant() {
		return implement(meshContract.revokeJoinGrant).handler(({ input }) => this.client.revokeJoinGrant(input));
	}

	@Implement(meshContract.trustKeyringStatus)
	trustKeyringStatus() {
		return implement(meshContract.trustKeyringStatus).handler(({ input }) => this.client.trustKeyringStatus(input));
	}

	@Implement(meshContract.trustKeyringSecrets)
	trustKeyringSecrets() {
		return implement(meshContract.trustKeyringSecrets).handler(({ input }) => this.client.trustKeyringSecrets(input));
	}

	@Implement(meshContract.trustKeyringRotate)
	trustKeyringRotate() {
		return implement(meshContract.trustKeyringRotate).handler(({ input }) => this.client.trustKeyringRotate(input));
	}

	@Implement(meshContract.trustKeyringConvergenceStatus)
	trustKeyringConvergenceStatus() {
		return implement(meshContract.trustKeyringConvergenceStatus).handler(({ input }) => this.client.trustKeyringConvergenceStatus(input));
	}

	@Implement(meshContract.trustStrictReadiness)
	trustStrictReadiness() {
		return implement(meshContract.trustStrictReadiness).handler(({ input }) => this.client.trustStrictReadiness(input));
	}

	@Implement(meshContract.trustStrictModeSet)
	trustStrictModeSet() {
		return implement(meshContract.trustStrictModeSet).handler(({ input }) => this.client.trustStrictModeSet(input));
	}

	@Implement(meshContract.trustStrictRolloutPlan)
	trustStrictRolloutPlan() {
		return implement(meshContract.trustStrictRolloutPlan).handler(({ input }) => this.client.trustStrictRolloutPlan(input));
	}

	@Implement(meshContract.trustStrictRollback)
	trustStrictRollback() {
		return implement(meshContract.trustStrictRollback).handler(({ input }) => this.client.trustStrictRollback(input));
	}

	@Implement(meshContract.getNodeConfig)
	getNodeConfig() {
		return implement(meshContract.getNodeConfig).handler(({ input }) => this.client.getNodeConfig(input));
	}

	@Implement(meshContract.updateNodeConfig)
	updateNodeConfig() {
		return implement(meshContract.updateNodeConfig).handler(({ input }) => this.client.updateNodeConfig(input));
	}

	@Implement(meshContract.regenerateNodeConfigSecret)
	regenerateNodeConfigSecret() {
		return implement(meshContract.regenerateNodeConfigSecret).handler(({ input }) => this.client.regenerateNodeConfigSecret(input));
	}

	@Implement(meshContract.testNodeConfigDb)
	testNodeConfigDb() {
		return implement(meshContract.testNodeConfigDb).handler(({ input }) => this.client.testNodeConfigDb(input));
	}
}
