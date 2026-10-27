/**
 * GENERATED — the `project` surface, delegated to `project`.
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

import { projectContract } from "@deployer/project-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class ProjectDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("project", projectContract);
	}

	@Implement(projectContract.list)
	list() {
		return implement(projectContract.list).handler(({ input }) => this.client.list(input));
	}

	@Implement(projectContract.findById)
	findById() {
		return implement(projectContract.findById).handler(({ input }) => this.client.findById(input));
	}

	@Implement(projectContract.create)
	create() {
		return implement(projectContract.create).handler(({ input }) => this.client.create(input));
	}

	@Implement(projectContract.update)
	update() {
		return implement(projectContract.update).handler(({ input }) => this.client.update(input));
	}

	@Implement(projectContract.delete)
	delete() {
		return implement(projectContract.delete).handler(({ input }) => this.client.delete(input));
	}

	@Implement(projectContract.getCollaborators)
	getCollaborators() {
		return implement(projectContract.getCollaborators).handler(({ input }) => this.client.getCollaborators(input));
	}

	@Implement(projectContract.inviteCollaborator)
	inviteCollaborator() {
		return implement(projectContract.inviteCollaborator).handler(({ input }) => this.client.inviteCollaborator(input));
	}

	@Implement(projectContract.updateCollaborator)
	updateCollaborator() {
		return implement(projectContract.updateCollaborator).handler(({ input }) => this.client.updateCollaborator(input));
	}

	@Implement(projectContract.removeCollaborator)
	removeCollaborator() {
		return implement(projectContract.removeCollaborator).handler(({ input }) => this.client.removeCollaborator(input));
	}

	@Implement(projectContract.listEnvironments)
	listEnvironments() {
		return implement(projectContract.listEnvironments).handler(({ input }) => this.client.listEnvironments(input));
	}

	@Implement(projectContract.getEnvironment)
	getEnvironment() {
		return implement(projectContract.getEnvironment).handler(({ input }) => this.client.getEnvironment(input));
	}

	@Implement(projectContract.createEnvironment)
	createEnvironment() {
		return implement(projectContract.createEnvironment).handler(({ input }) => this.client.createEnvironment(input));
	}

	@Implement(projectContract.updateEnvironment)
	updateEnvironment() {
		return implement(projectContract.updateEnvironment).handler(({ input }) => this.client.updateEnvironment(input));
	}

	@Implement(projectContract.deleteEnvironment)
	deleteEnvironment() {
		return implement(projectContract.deleteEnvironment).handler(({ input }) => this.client.deleteEnvironment(input));
	}

	@Implement(projectContract.cloneEnvironment)
	cloneEnvironment() {
		return implement(projectContract.cloneEnvironment).handler(({ input }) => this.client.cloneEnvironment(input));
	}

	@Implement(projectContract.listServiceEnvironmentLinks)
	listServiceEnvironmentLinks() {
		return implement(projectContract.listServiceEnvironmentLinks).handler(({ input }) => this.client.listServiceEnvironmentLinks(input));
	}

	@Implement(projectContract.upsertServiceEnvironmentLink)
	upsertServiceEnvironmentLink() {
		return implement(projectContract.upsertServiceEnvironmentLink).handler(({ input }) => this.client.upsertServiceEnvironmentLink(input));
	}

	@Implement(projectContract.listVariableTemplates)
	listVariableTemplates() {
		return implement(projectContract.listVariableTemplates).handler(({ input }) => this.client.listVariableTemplates(input));
	}

	@Implement(projectContract.getVariableTemplate)
	getVariableTemplate() {
		return implement(projectContract.getVariableTemplate).handler(({ input }) => this.client.getVariableTemplate(input));
	}

	@Implement(projectContract.createVariableTemplate)
	createVariableTemplate() {
		return implement(projectContract.createVariableTemplate).handler(({ input }) => this.client.createVariableTemplate(input));
	}

	@Implement(projectContract.updateVariableTemplate)
	updateVariableTemplate() {
		return implement(projectContract.updateVariableTemplate).handler(({ input }) => this.client.updateVariableTemplate(input));
	}

	@Implement(projectContract.deleteVariableTemplate)
	deleteVariableTemplate() {
		return implement(projectContract.deleteVariableTemplate).handler(({ input }) => this.client.deleteVariableTemplate(input));
	}

	@Implement(projectContract.getGeneralConfig)
	getGeneralConfig() {
		return implement(projectContract.getGeneralConfig).handler(({ input }) => this.client.getGeneralConfig(input));
	}

	@Implement(projectContract.updateGeneralConfig)
	updateGeneralConfig() {
		return implement(projectContract.updateGeneralConfig).handler(({ input }) => this.client.updateGeneralConfig(input));
	}

	@Implement(projectContract.getEnvironmentConfig)
	getEnvironmentConfig() {
		return implement(projectContract.getEnvironmentConfig).handler(({ input }) => this.client.getEnvironmentConfig(input));
	}

	@Implement(projectContract.updateEnvironmentConfig)
	updateEnvironmentConfig() {
		return implement(projectContract.updateEnvironmentConfig).handler(({ input }) => this.client.updateEnvironmentConfig(input));
	}

	@Implement(projectContract.getDeploymentConfig)
	getDeploymentConfig() {
		return implement(projectContract.getDeploymentConfig).handler(({ input }) => this.client.getDeploymentConfig(input));
	}

	@Implement(projectContract.updateDeploymentConfig)
	updateDeploymentConfig() {
		return implement(projectContract.updateDeploymentConfig).handler(({ input }) => this.client.updateDeploymentConfig(input));
	}

	@Implement(projectContract.getSecurityConfig)
	getSecurityConfig() {
		return implement(projectContract.getSecurityConfig).handler(({ input }) => this.client.getSecurityConfig(input));
	}

	@Implement(projectContract.updateSecurityConfig)
	updateSecurityConfig() {
		return implement(projectContract.updateSecurityConfig).handler(({ input }) => this.client.updateSecurityConfig(input));
	}

	@Implement(projectContract.getResourceConfig)
	getResourceConfig() {
		return implement(projectContract.getResourceConfig).handler(({ input }) => this.client.getResourceConfig(input));
	}

	@Implement(projectContract.updateResourceConfig)
	updateResourceConfig() {
		return implement(projectContract.updateResourceConfig).handler(({ input }) => this.client.updateResourceConfig(input));
	}

	@Implement(projectContract.getNotificationConfig)
	getNotificationConfig() {
		return implement(projectContract.getNotificationConfig).handler(({ input }) => this.client.getNotificationConfig(input));
	}

	@Implement(projectContract.updateNotificationConfig)
	updateNotificationConfig() {
		return implement(projectContract.updateNotificationConfig).handler(({ input }) => this.client.updateNotificationConfig(input));
	}

	@Implement(projectContract.getEnvironmentStatus)
	getEnvironmentStatus() {
		return implement(projectContract.getEnvironmentStatus).handler(({ input }) => this.client.getEnvironmentStatus(input));
	}

	@Implement(projectContract.getAllEnvironmentStatuses)
	getAllEnvironmentStatuses() {
		return implement(projectContract.getAllEnvironmentStatuses).handler(({ input }) => this.client.getAllEnvironmentStatuses(input));
	}

	@Implement(projectContract.refreshEnvironmentStatus)
	refreshEnvironmentStatus() {
		return implement(projectContract.refreshEnvironmentStatus).handler(({ input }) => this.client.refreshEnvironmentStatus(input));
	}

	@Implement(projectContract.streamQuery)
	streamQuery() {
		return implement(projectContract.streamQuery).handler(({ input }) => this.client.streamQuery(input));
	}

	@Implement(projectContract.getNetwork)
	getNetwork() {
		return implement(projectContract.getNetwork).handler(({ input }) => this.client.getNetwork(input));
	}

	@Implement(projectContract.updateNetwork)
	updateNetwork() {
		return implement(projectContract.updateNetwork).handler(({ input }) => this.client.updateNetwork(input));
	}
}
