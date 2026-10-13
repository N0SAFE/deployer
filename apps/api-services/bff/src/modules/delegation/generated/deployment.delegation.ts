/**
 * GENERATED — the `deployment` surface, delegated to `runtime`.
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

import { deploymentContract } from "@deployer/runtime-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class DeploymentDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("runtime", deploymentContract);
	}

	@Implement(deploymentContract.list)
	list() {
		return implement(deploymentContract.list).handler(({ input }) => this.client.list(input));
	}

	@Implement(deploymentContract.findById)
	findById() {
		return implement(deploymentContract.findById).handler(({ input }) => this.client.findById(input));
	}

	@Implement(deploymentContract.listServicePreviews)
	listServicePreviews() {
		return implement(deploymentContract.listServicePreviews).handler(({ input }) => this.client.listServicePreviews(input));
	}

	@Implement(deploymentContract.promoteServicePreview)
	promoteServicePreview() {
		return implement(deploymentContract.promoteServicePreview).handler(({ input }) => this.client.promoteServicePreview(input));
	}

	@Implement(deploymentContract.trigger)
	trigger() {
		return implement(deploymentContract.trigger).handler(({ input }) => this.client.trigger(input));
	}

	@Implement(deploymentContract.uploadBundle)
	uploadBundle() {
		return implement(deploymentContract.uploadBundle).handler(({ input }) => this.client.uploadBundle(input));
	}

	@Implement(deploymentContract.cancel)
	cancel() {
		return implement(deploymentContract.cancel).handler(({ input }) => this.client.cancel(input));
	}

	@Implement(deploymentContract.rollback)
	rollback() {
		return implement(deploymentContract.rollback).handler(({ input }) => this.client.rollback(input));
	}

	@Implement(deploymentContract.getLogs)
	getLogs() {
		return implement(deploymentContract.getLogs).handler(({ input }) => this.client.getLogs(input));
	}

	@Implement(deploymentContract.delete)
	delete() {
		return implement(deploymentContract.delete).handler(({ input }) => this.client.delete(input));
	}

	@Implement(deploymentContract.stream)
	stream() {
		return implement(deploymentContract.stream).handler(({ input }) => this.client.stream(input));
	}

	@Implement(deploymentContract.streamInternal)
	streamInternal() {
		return implement(deploymentContract.streamInternal).handler(({ input }) => this.client.streamInternal(input));
	}

	@Implement(deploymentContract.streamService)
	streamService() {
		return implement(deploymentContract.streamService).handler(({ input }) => this.client.streamService(input));
	}

	@Implement(deploymentContract.streamQuery)
	streamQuery() {
		return implement(deploymentContract.streamQuery).handler(({ input }) => this.client.streamQuery(input));
	}

	@Implement(deploymentContract.streamsList)
	streamsList() {
		return implement(deploymentContract.streamsList).handler(({ input }) => this.client.streamsList(input));
	}

	@Implement(deploymentContract.streamFindById)
	streamFindById() {
		return implement(deploymentContract.streamFindById).handler(({ input }) => this.client.streamFindById(input));
	}

	@Implement(deploymentContract.retry)
	retry() {
		return implement(deploymentContract.retry).handler(({ input }) => this.client.retry(input));
	}

	@Implement(deploymentContract.getRollbackHistory)
	getRollbackHistory() {
		return implement(deploymentContract.getRollbackHistory).handler(({ input }) => this.client.getRollbackHistory(input));
	}

	@Implement(deploymentContract.getTemplateProvenance)
	getTemplateProvenance() {
		return implement(deploymentContract.getTemplateProvenance).handler(({ input }) => this.client.getTemplateProvenance(input));
	}

	@Implement(deploymentContract.upsertTemplateProvenance)
	upsertTemplateProvenance() {
		return implement(deploymentContract.upsertTemplateProvenance).handler(({ input }) => this.client.upsertTemplateProvenance(input));
	}

	@Implement(deploymentContract.getTemplateProvenanceByRun)
	getTemplateProvenanceByRun() {
		return implement(deploymentContract.getTemplateProvenanceByRun).handler(({ input }) => this.client.getTemplateProvenanceByRun(input));
	}

	@Implement(deploymentContract.createCompiledPlanSnapshot)
	createCompiledPlanSnapshot() {
		return implement(deploymentContract.createCompiledPlanSnapshot).handler(({ input }) => this.client.createCompiledPlanSnapshot(input));
	}

	@Implement(deploymentContract.listCompiledPlanSnapshots)
	listCompiledPlanSnapshots() {
		return implement(deploymentContract.listCompiledPlanSnapshots).handler(({ input }) => this.client.listCompiledPlanSnapshots(input));
	}

	@Implement(deploymentContract.getCompiledPlanSnapshot)
	getCompiledPlanSnapshot() {
		return implement(deploymentContract.getCompiledPlanSnapshot).handler(({ input }) => this.client.getCompiledPlanSnapshot(input));
	}

	@Implement(deploymentContract.getCompiledPlanSnapshotByRun)
	getCompiledPlanSnapshotByRun() {
		return implement(deploymentContract.getCompiledPlanSnapshotByRun).handler(({ input }) => this.client.getCompiledPlanSnapshotByRun(input));
	}

	@Implement(deploymentContract.compilePlan)
	compilePlan() {
		return implement(deploymentContract.compilePlan).handler(({ input }) => this.client.compilePlan(input));
	}

	@Implement(deploymentContract.compilePlanPreview)
	compilePlanPreview() {
		return implement(deploymentContract.compilePlanPreview).handler(({ input }) => this.client.compilePlanPreview(input));
	}

	@Implement(deploymentContract.compileRollbackEdges)
	compileRollbackEdges() {
		return implement(deploymentContract.compileRollbackEdges).handler(({ input }) => this.client.compileRollbackEdges(input));
	}

	@Implement(deploymentContract.queueEnqueueJob)
	queueEnqueueJob() {
		return implement(deploymentContract.queueEnqueueJob).handler(({ input }) => this.client.queueEnqueueJob(input));
	}

	@Implement(deploymentContract.queueClaimJobs)
	queueClaimJobs() {
		return implement(deploymentContract.queueClaimJobs).handler(({ input }) => this.client.queueClaimJobs(input));
	}

	@Implement(deploymentContract.queueHeartbeatJob)
	queueHeartbeatJob() {
		return implement(deploymentContract.queueHeartbeatJob).handler(({ input }) => this.client.queueHeartbeatJob(input));
	}

	@Implement(deploymentContract.queueCompleteJob)
	queueCompleteJob() {
		return implement(deploymentContract.queueCompleteJob).handler(({ input }) => this.client.queueCompleteJob(input));
	}

	@Implement(deploymentContract.queueFailJob)
	queueFailJob() {
		return implement(deploymentContract.queueFailJob).handler(({ input }) => this.client.queueFailJob(input));
	}

	@Implement(deploymentContract.queueFindJobById)
	queueFindJobById() {
		return implement(deploymentContract.queueFindJobById).handler(({ input }) => this.client.queueFindJobById(input));
	}

	@Implement(deploymentContract.queueListJobs)
	queueListJobs() {
		return implement(deploymentContract.queueListJobs).handler(({ input }) => this.client.queueListJobs(input));
	}

	@Implement(deploymentContract.queueListDeadLetterJobs)
	queueListDeadLetterJobs() {
		return implement(deploymentContract.queueListDeadLetterJobs).handler(({ input }) => this.client.queueListDeadLetterJobs(input));
	}

	@Implement(deploymentContract.queueFindDeadLetterJobById)
	queueFindDeadLetterJobById() {
		return implement(deploymentContract.queueFindDeadLetterJobById).handler(({ input }) => this.client.queueFindDeadLetterJobById(input));
	}

	@Implement(deploymentContract.queueReplayDeadLetterJob)
	queueReplayDeadLetterJob() {
		return implement(deploymentContract.queueReplayDeadLetterJob).handler(({ input }) => this.client.queueReplayDeadLetterJob(input));
	}

	@Implement(deploymentContract.listRetryPolicies)
	listRetryPolicies() {
		return implement(deploymentContract.listRetryPolicies).handler(({ input }) => this.client.listRetryPolicies(input));
	}

	@Implement(deploymentContract.resolveRetryPolicy)
	resolveRetryPolicy() {
		return implement(deploymentContract.resolveRetryPolicy).handler(({ input }) => this.client.resolveRetryPolicy(input));
	}

	@Implement(deploymentContract.cancelExecution)
	cancelExecution() {
		return implement(deploymentContract.cancelExecution).handler(({ input }) => this.client.cancelExecution(input));
	}

	@Implement(deploymentContract.resumeExecution)
	resumeExecution() {
		return implement(deploymentContract.resumeExecution).handler(({ input }) => this.client.resumeExecution(input));
	}

	@Implement(deploymentContract.getExecutionCheckpoint)
	getExecutionCheckpoint() {
		return implement(deploymentContract.getExecutionCheckpoint).handler(({ input }) => this.client.getExecutionCheckpoint(input));
	}

	@Implement(deploymentContract.getExecutionCheckpointByRun)
	getExecutionCheckpointByRun() {
		return implement(deploymentContract.getExecutionCheckpointByRun).handler(({ input }) => this.client.getExecutionCheckpointByRun(input));
	}

	@Implement(deploymentContract.emitNodeLifecycleEvent)
	emitNodeLifecycleEvent() {
		return implement(deploymentContract.emitNodeLifecycleEvent).handler(({ input }) => this.client.emitNodeLifecycleEvent(input));
	}

	@Implement(deploymentContract.listNodeLifecycleEvents)
	listNodeLifecycleEvents() {
		return implement(deploymentContract.listNodeLifecycleEvents).handler(({ input }) => this.client.listNodeLifecycleEvents(input));
	}

	@Implement(deploymentContract.streamNodeLifecycleEvents)
	streamNodeLifecycleEvents() {
		return implement(deploymentContract.streamNodeLifecycleEvents).handler(({ input }) => this.client.streamNodeLifecycleEvents(input));
	}

	@Implement(deploymentContract.listPhaseTransitions)
	listPhaseTransitions() {
		return implement(deploymentContract.listPhaseTransitions).handler(({ input }) => this.client.listPhaseTransitions(input));
	}

	@Implement(deploymentContract.validatePhaseTransition)
	validatePhaseTransition() {
		return implement(deploymentContract.validatePhaseTransition).handler(({ input }) => this.client.validatePhaseTransition(input));
	}

	@Implement(deploymentContract.applyPhaseTransition)
	applyPhaseTransition() {
		return implement(deploymentContract.applyPhaseTransition).handler(({ input }) => this.client.applyPhaseTransition(input));
	}
}
